#!/usr/bin/env node

import readline from 'node:readline';
import { Chess } from 'chess.js';
import {
  chooseKannyaMove,
  defaultKannyaMoveSelectorConfig,
} from './kannyan-move-selector.js';
import { closeStockfishEngine } from './stockfish-lite.js';
import {
  loadLichessPlayerOpeningBookCache,
  warmLichessPlayerOpeningBook,
} from '../opening-book.js';

const UCI_MOVE_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const DEFAULT_MOVE_OVERHEAD_MS = 30;
const DEFAULT_MIN_THINK_MS = 20;
const DEFAULT_MAX_THINK_MS = 60_000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function writeLine(line) {
  process.stdout.write(`${line}\n`);
}

function writeInfoString(text) {
  writeLine(`info string ${String(text ?? '').replace(/\r?\n/g, ' ')}`);
}

function writeDebug(text) {
  process.stderr.write(`[kannyan-uci] ${text}\n`);
}

function moveToUci(move) {
  if (!move?.from || !move?.to) {
    return '';
  }

  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

function applyUciMove(chess, uci) {
  const moveText = String(uci ?? '').trim().toLowerCase();
  if (!UCI_MOVE_PATTERN.test(moveText)) {
    return null;
  }

  return chess.move({
    from: moveText.slice(0, 2),
    to: moveText.slice(2, 4),
    promotion: moveText[4],
  });
}

function parsePositionCommand(commandText) {
  const trimmed = String(commandText ?? '').trim();
  if (!trimmed) {
    return new Chess();
  }

  const tokens = trimmed.split(/\s+/);
  const movesIndex = tokens.indexOf('moves');
  const moveTokens = movesIndex >= 0 ? tokens.slice(movesIndex + 1) : [];
  const headTokens = movesIndex >= 0 ? tokens.slice(0, movesIndex) : tokens;

  let chess;

  if (headTokens[0] === 'startpos') {
    chess = new Chess();
  } else if (headTokens[0] === 'fen') {
    const fen = headTokens.slice(1).join(' ').trim();
    chess = fen ? new Chess(fen) : new Chess();
  } else {
    throw new Error(`Unsupported position command: ${trimmed}`);
  }

  for (const moveToken of moveTokens) {
    const move = applyUciMove(chess, moveToken);
    if (!move) {
      throw new Error(`Illegal position move: ${moveToken}`);
    }
  }

  return chess;
}

function parseSetOption(commandText) {
  const tokens = String(commandText ?? '').trim().split(/\s+/).filter(Boolean);
  const nameIndex = tokens.indexOf('name');
  const valueIndex = tokens.indexOf('value');

  if (nameIndex < 0) {
    return { name: '', value: '' };
  }

  const name = tokens
    .slice(nameIndex + 1, valueIndex >= 0 ? valueIndex : undefined)
    .join(' ')
    .trim();
  const value = valueIndex >= 0
    ? tokens.slice(valueIndex + 1).join(' ').trim()
    : '';

  return { name, value };
}

function normalizeOptionName(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseBoolean(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (['true', '1', 'on', 'yes'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'off', 'no'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parsePositiveInt(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return clamp(number, min, max);
}

function emitAnalysisInfo(analysis) {
  const seen = new Set();
  const infoLines = [];

  for (const candidate of Array.isArray(analysis?.candidates) ? analysis.candidates : []) {
    const info = String(candidate?.info ?? '').trim();
    if (info && !seen.has(info)) {
      seen.add(info);
      infoLines.push(info);
    }
  }

  const fallbackInfo = String(analysis?.info ?? '').trim();
  if (fallbackInfo && !seen.has(fallbackInfo)) {
    infoLines.push(fallbackInfo);
  }

  for (const infoLine of infoLines) {
    if (infoLine.startsWith('info ')) {
      writeLine(infoLine);
    } else {
      writeInfoString(infoLine);
    }
  }
}

function computeMoveTime(goParams, turn, options) {
  if (Number.isFinite(goParams.movetime) && goParams.movetime > 0) {
    return clamp(goParams.movetime - options.moveOverheadMs, options.minThinkMs, DEFAULT_MAX_THINK_MS);
  }

  const remaining = turn === 'w' ? goParams.wtime : goParams.btime;
  const increment = turn === 'w' ? goParams.winc : goParams.binc;

  if (!Number.isFinite(remaining) || remaining <= 0) {
    return Math.max(options.minThinkMs, 250);
  }

  const movesToGo = Number.isFinite(goParams.movestogo) && goParams.movestogo > 0
    ? goParams.movestogo
    : 24;
  const base = Math.floor(remaining / movesToGo);
  const bonus = Math.floor((Number.isFinite(increment) ? increment : 0) * 0.8);
  const safeCap = Math.max(options.minThinkMs, remaining - options.moveOverheadMs);
  const planned = base + bonus - options.moveOverheadMs;

  return clamp(planned, options.minThinkMs, Math.min(DEFAULT_MAX_THINK_MS, safeCap));
}

function parseGoCommand(commandText) {
  const tokens = String(commandText ?? '').trim().split(/\s+/).filter(Boolean);
  const params = {
    ponder: false,
    infinite: false,
    depth: null,
    movetime: null,
    wtime: null,
    btime: null,
    winc: 0,
    binc: 0,
    movestogo: null,
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];

    switch (token) {
      case 'ponder':
        params.ponder = true;
        break;
      case 'infinite':
        params.infinite = true;
        break;
      case 'depth':
      case 'movetime':
      case 'wtime':
      case 'btime':
      case 'winc':
      case 'binc':
      case 'movestogo': {
        const number = Number.parseInt(next, 10);
        params[token] = Number.isFinite(number) ? number : null;
        index += 1;
        break;
      }
      default:
        break;
    }
  }

  return params;
}

class KannyaUciEngine {
  constructor() {
    this.board = new Chess();
    this.search = null;
    this.options = {
      useOpeningBook: defaultKannyaMoveSelectorConfig.useOpeningBook,
      openingBookStyle: 'stronger',
      openingBookNetwork: false,
      multiPv: defaultKannyaMoveSelectorConfig.multiPv,
      maxCandidateLossCp: defaultKannyaMoveSelectorConfig.maxCandidateLossCp,
      bestMoveRate: 70,
      secondThirdRate: 20,
      moveOverheadMs: DEFAULT_MOVE_OVERHEAD_MS,
      minThinkMs: DEFAULT_MIN_THINK_MS,
      debugLog: false,
    };
    this.pendingInit = Promise.resolve();
    this.refreshPendingInit();
  }

  refreshPendingInit() {
    if (!this.options.useOpeningBook) {
      this.pendingInit = Promise.resolve();
      return;
    }

    this.pendingInit = (async () => {
      await loadLichessPlayerOpeningBookCache({
        enabled: true,
        networkEnabled: this.options.openingBookNetwork,
      });
      await warmLichessPlayerOpeningBook({
        enabled: true,
        networkEnabled: this.options.openingBookNetwork,
      });
    })();
  }

  async handleLine(line) {
    const trimmed = String(line ?? '').trim();
    if (!trimmed) {
      return;
    }

    const [command, ...restTokens] = trimmed.split(/\s+/);
    const rest = restTokens.join(' ');

    if (this.options.debugLog) {
      writeDebug(`<= ${trimmed}`);
    }

    try {
      switch (command) {
        case 'uci':
          this.handleUci();
          break;
        case 'isready':
          await this.handleIsReady();
          break;
        case 'setoption':
          this.handleSetOption(rest);
          break;
        case 'ucinewgame':
          this.handleUciNewGame();
          break;
        case 'position':
          this.handlePosition(rest);
          break;
        case 'go':
          this.handleGo(rest);
          break;
        case 'stop':
          this.handleStop();
          break;
        case 'quit':
          await this.handleQuit();
          break;
        case 'd':
          writeInfoString(this.board.fen());
          break;
        case 'debug':
          this.options.debugLog = parseBoolean(rest, false);
          break;
        case 'ponderhit':
          break;
        default:
          writeInfoString(`ignored command: ${trimmed}`);
          break;
      }
    } catch (error) {
      writeInfoString(error instanceof Error ? error.message : String(error));
    }
  }

  handleUci() {
    writeLine('id name Kannya UCI Wrapper');
    writeLine('id author CODEX + 깐냥');
    writeLine(`option name UseOpeningBook type check default ${this.options.useOpeningBook ? 'true' : 'false'}`);
    writeLine('option name OpeningBookStyle type combo default stronger var stronger var wider');
    writeLine(`option name OpeningBookNetwork type check default ${this.options.openingBookNetwork ? 'true' : 'false'}`);
    writeLine(`option name MultiPV type spin default ${this.options.multiPv} min 1 max 6`);
    writeLine(`option name MaxCandidateLossCp type spin default ${this.options.maxCandidateLossCp} min 0 max 1000`);
    writeLine(`option name BestMoveRate type spin default ${this.options.bestMoveRate} min 0 max 100`);
    writeLine(`option name SecondThirdRate type spin default ${this.options.secondThirdRate} min 0 max 100`);
    writeLine(`option name Move Overhead type spin default ${this.options.moveOverheadMs} min 0 max 5000`);
    writeLine(`option name Minimum Thinking Time type spin default ${this.options.minThinkMs} min 0 max 60000`);
    writeLine(`option name DebugLog type check default ${this.options.debugLog ? 'true' : 'false'}`);
    writeLine('uciok');
  }

  async handleIsReady() {
    try {
      await this.pendingInit;
    } catch (error) {
      writeInfoString(`opening book init failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    writeLine('readyok');
  }

  handleSetOption(rest) {
    const { name, value } = parseSetOption(rest);
    const normalizedName = normalizeOptionName(name);
    let refreshOpeningBook = false;

    switch (normalizedName) {
      case 'useopeningbook':
        this.options.useOpeningBook = parseBoolean(value, this.options.useOpeningBook);
        refreshOpeningBook = true;
        break;
      case 'openingbookstyle': {
        const next = String(value ?? '').trim().toLowerCase();
        this.options.openingBookStyle = next === 'wider' ? 'wider' : 'stronger';
        break;
      }
      case 'openingbooknetwork':
        this.options.openingBookNetwork = parseBoolean(value, this.options.openingBookNetwork);
        refreshOpeningBook = true;
        break;
      case 'multipv':
        this.options.multiPv = parsePositiveInt(value, this.options.multiPv, 1, 6);
        break;
      case 'maxcandidatelosscp':
      case 'max candidate loss cp':
        this.options.maxCandidateLossCp = parsePositiveInt(value, this.options.maxCandidateLossCp, 0, 1000);
        break;
      case 'bestmoverate':
      case 'best move rate':
        this.options.bestMoveRate = parsePositiveInt(value, this.options.bestMoveRate, 0, 100);
        break;
      case 'secondthirdrate':
      case 'second third rate':
        this.options.secondThirdRate = parsePositiveInt(value, this.options.secondThirdRate, 0, 100);
        break;
      case 'move overhead':
        this.options.moveOverheadMs = parsePositiveInt(value, this.options.moveOverheadMs, 0, 5000);
        break;
      case 'minimum thinking time':
        this.options.minThinkMs = parsePositiveInt(value, this.options.minThinkMs, 0, 60000);
        break;
      case 'debuglog':
      case 'debug log':
        this.options.debugLog = parseBoolean(value, this.options.debugLog);
        break;
      default:
        writeInfoString(`unknown option ignored: ${name}`);
        break;
    }

    if (refreshOpeningBook) {
      this.refreshPendingInit();
    }
  }

  handleUciNewGame() {
    this.stopSearch(false);
    this.board = new Chess();
  }

  handlePosition(rest) {
    this.stopSearch(false);
    this.board = parsePositionCommand(rest);
  }

  handleGo(rest) {
    this.stopSearch(false);

    const goParams = parseGoCommand(rest);
    const fallbackMove = moveToUci(this.board.moves({ verbose: true })[0]) || '0000';
    const searchId = Symbol('search');

    this.search = {
      id: searchId,
      emitted: false,
      fallbackMove,
    };

    void this.runSearch(searchId, goParams);
  }

  async runSearch(searchId, goParams) {
    try {
      try {
        await this.pendingInit;
      } catch (error) {
        writeInfoString(`opening book init failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      const board = new Chess(this.board.fen());
      const result = await chooseKannyaMove(board, {
        useOpeningBook: this.options.useOpeningBook,
        openingBookOptions: {
          enabled: this.options.useOpeningBook,
          networkEnabled: this.options.openingBookNetwork,
          style: this.options.openingBookStyle,
        },
        depth: Number.isFinite(goParams.depth) && goParams.depth > 0 ? goParams.depth : null,
        movetimeMs: goParams.infinite
          ? DEFAULT_MAX_THINK_MS
          : computeMoveTime(goParams, board.turn(), this.options),
        multiPv: this.options.multiPv,
        maxCandidateLossCp: this.options.maxCandidateLossCp,
        bestMoveRate: this.options.bestMoveRate,
        secondThirdRate: this.options.secondThirdRate,
        logger: {
          log(message) {
            writeInfoString(message);
          },
          warn(message, error) {
            writeInfoString(message);
            if (error) {
              writeInfoString(error instanceof Error ? error.message : String(error));
            }
          },
        },
      });

      if (!this.search || this.search.id !== searchId || this.search.emitted) {
        return;
      }

      if (result.analysis) {
        emitAnalysisInfo(result.analysis);
      }

      this.emitBestMove(result.selectedUci || this.search.fallbackMove);
    } catch (error) {
      if (!this.search || this.search.id !== searchId || this.search.emitted) {
        return;
      }

      writeInfoString(`search failed: ${error instanceof Error ? error.message : String(error)}`);
      this.emitBestMove(this.search.fallbackMove || '0000');
    }
  }

  handleStop() {
    this.stopSearch(true);
  }

  stopSearch(emitFallback) {
    if (!this.search || this.search.emitted) {
      closeStockfishEngine();
      return;
    }

    const fallbackMove = this.search.fallbackMove;
    this.search.emitted = true;
    closeStockfishEngine();

    if (emitFallback) {
      this.emitBestMove(fallbackMove || '0000');
    }
  }

  emitBestMove(uci) {
    const move = UCI_MOVE_PATTERN.test(String(uci ?? '').trim().toLowerCase())
      ? String(uci).trim().toLowerCase()
      : '0000';

    if (this.search) {
      this.search.emitted = true;
      this.search = null;
    }

    writeLine(`bestmove ${move}`);
  }

  async handleQuit() {
    this.stopSearch(false);
    closeStockfishEngine();
    process.exit(0);
  }
}

const engine = new KannyaUciEngine();
const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on('line', (line) => {
  void engine.handleLine(line);
});

rl.on('close', () => {
  closeStockfishEngine();
});
