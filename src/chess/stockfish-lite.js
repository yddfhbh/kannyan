import { createRequire } from 'node:module';
import { Chess } from 'chess.js';

const require = createRequire(import.meta.url);
const createStockfish = require('stockfish');

function matchesLine(matcher, line) {
  if (typeof matcher === 'string') {
    return line === matcher;
  }

  matcher.lastIndex = 0;
  return matcher.test(line);
}

function createEngineLineReader(engine) {
  const waiters = new Set();
  let lastInfo = '';

  engine.listener = (line) => {
    const text = String(line ?? '').trim();
    if (!text) {
      return;
    }

    if (text.startsWith('info ') && text.includes(' score ')) {
      lastInfo = text;
    }

    for (const waiter of [...waiters]) {
      if (!matchesLine(waiter.matcher, text)) {
        continue;
      }

      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(text);
    }
  };

  return {
    waitFor(matcher, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const waiter = {
          matcher,
          resolve,
          reject,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(`Stockfish timeout waiting for ${matcher}`));
          }, timeoutMs),
        };

        waiters.add(waiter);
      });
    },
    getLastInfo() {
      return lastInfo;
    },
    clearLastInfo() {
      lastInfo = '';
    },
    rejectAll(error) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject?.(error);
      }
      waiters.clear();
    },
  };
}

let sharedEnginePromise;
let analysisQueue = Promise.resolve();

async function getSharedEngine() {
  if (!sharedEnginePromise) {
    sharedEnginePromise = (async () => {
      const engine = await stockfish();
      const reader = createEngineLineReader(engine);

      const uciReady = reader.waitFor('uciok');
      engine.sendCommand('uci');
      await uciReady;

      const engineReady = reader.waitFor('readyok');
      engine.sendCommand('isready');
      await engineReady;

      return { engine, reader };
    })();
  }

  return sharedEnginePromise;
}

function uciToSan(fen, uci) {
  const chess = new Chess(fen);
  const moveInput = {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
  };

  if (uci[4]) {
    moveInput.promotion = uci[4];
  }

  const move = chess.move(moveInput);
  return move?.san ?? uci;
}

function parseScore(infoLine) {
  const match = infoLine?.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
  if (!match) {
    return null;
  }

  return {
    type: match[1],
    value: Number(match[2]),
  };
}

function parseDepth(infoLine) {
  const match = infoLine?.match(/\bdepth\s+(\d+)/);
  return match ? Number(match[1]) : null;
}

export async function analyzeFenWithStockfish(fen, options = {}) {
  const chess = new Chess(fen);
  if (chess.isGameOver()) {
    return {
      bestMove: '',
      san: '(none)',
      score: null,
      depth: null,
      info: '',
    };
  }

  const movetimeMs = Math.max(50, Number(options.movetimeMs) || 2000);
  const depth = Number.isInteger(options.depth) && options.depth > 0
    ? options.depth
    : null;

  const runAnalysis = async () => {
    const { engine, reader } = await getSharedEngine();
    reader.clearLastInfo();
    engine.sendCommand('ucinewgame');
    engine.sendCommand(`position fen ${fen}`);

    const bestMoveReady = reader.waitFor(/^bestmove\s+/, movetimeMs + 10_000);
    engine.sendCommand(depth ? `go depth ${depth}` : `go movetime ${movetimeMs}`);

    const bestMoveLine = await bestMoveReady;
    const bestMove = bestMoveLine.split(/\s+/)[1] ?? '';
    const lastInfo = reader.getLastInfo();

    return {
      bestMove,
      san: bestMove && bestMove !== '(none)'
        ? uciToSan(fen, bestMove)
        : '(none)',
      score: parseScore(lastInfo),
      depth: parseDepth(lastInfo),
      info: lastInfo,
    };
  };

  const queuedAnalysis = analysisQueue.then(runAnalysis, runAnalysis);
  analysisQueue = queuedAnalysis.catch(() => {});
  return queuedAnalysis;
}
