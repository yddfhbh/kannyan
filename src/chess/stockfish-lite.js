import { fork } from 'node:child_process';
import { Chess } from 'chess.js';

const workerPath = new URL('./stockfish-process.cjs', import.meta.url);

let worker;
let nextRequestId = 1;
const pendingRequests = new Map();

function createWorker() {
  const child = fork(workerPath, [], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    windowsHide: true,
  });

  child.stderr?.on('data', (chunk) => {
    const text = String(chunk ?? '').trim();
    if (text) {
      console.error(`[Stockfish] ${text}`);
    }
  });

  child.on('message', (message) => {
    const request = pendingRequests.get(message?.id);
    if (!request) {
      return;
    }

    pendingRequests.delete(message.id);
    clearTimeout(request.timer);

    if (message.error) {
      request.reject(new Error(message.error));
      return;
    }

    request.resolve(message.result);
  });

  child.on('error', (error) => {
    rejectWorkerRequests(child, error);
  });

  child.on('exit', (code, signal) => {
    const detail = signal ? `signal ${signal}` : `code ${code}`;
    rejectWorkerRequests(child, new Error(`Stockfish process exited with ${detail}`));
  });

  child.unref();
  child.channel?.unref();
  worker = child;
  return child;
}

function rejectWorkerRequests(child, error) {
  if (worker === child) {
    worker = undefined;
  }

  for (const [id, request] of pendingRequests) {
    if (request.worker !== child) {
      continue;
    }

    pendingRequests.delete(id);
    clearTimeout(request.timer);
    request.reject(error);
  }
}

function requestAnalysis(fen, options) {
  const child = worker?.connected ? worker : createWorker();
  const id = nextRequestId++;
  const movetimeMs = Math.max(50, Number(options.movetimeMs) || 2000);
  const depth = Number.isInteger(options.depth) && options.depth > 0
    ? options.depth
    : null;
  const timeoutMs = movetimeMs + 15_000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('Stockfish analysis timed out'));
      child.kill();
    }, timeoutMs);

    pendingRequests.set(id, {
      worker: child,
      timer,
      resolve,
      reject,
    });

    child.send({
      id,
      fen,
      movetimeMs,
      depth,
    }, (error) => {
      if (!error) {
        return;
      }

      const request = pendingRequests.get(id);
      if (!request) {
        return;
      }

      pendingRequests.delete(id);
      clearTimeout(request.timer);
      reject(error);
    });
  });
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

function parsePrincipalVariationMoves(infoLine) {
  const match = infoLine?.match(/\bpv\s+(.+)$/);
  if (!match) {
    return [];
  }

  return match[1]
    .trim()
    .split(/\s+/)
    .filter((move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move));
}

export function convertPrincipalVariationToSan(fen, uciMoves, maxPlies = 8) {
  const chess = new Chess(fen);
  const variation = [];

  for (const uci of uciMoves.slice(0, Math.max(1, maxPlies))) {
    let move;
    try {
      move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4],
      });
    } catch {
      break;
    }

    if (!move) {
      break;
    }

    variation.push({
      uci,
      san: move.san,
      color: move.color,
      piece: move.piece,
      from: move.from,
      to: move.to,
      captured: move.captured ?? null,
      promotion: move.promotion ?? null,
      givesCheck: chess.isCheck(),
      givesMate: chess.isCheckmate(),
    });
  }

  return variation;
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
      principalVariation: [],
    };
  }

  const result = await requestAnalysis(fen, options);
  const bestMove = String(result?.bestMove ?? '');
  const info = String(result?.info ?? '');
  const pvMoves = parsePrincipalVariationMoves(info);
  const principalVariation = pvMoves[0] === bestMove
    ? convertPrincipalVariationToSan(fen, pvMoves)
    : convertPrincipalVariationToSan(fen, [bestMove]);

  return {
    bestMove,
    san: bestMove && bestMove !== '(none)'
      ? uciToSan(fen, bestMove)
      : '(none)',
    score: parseScore(info),
    depth: parseDepth(info),
    info,
    principalVariation,
  };
}

export function closeStockfishEngine() {
  if (!worker) {
    return;
  }

  const child = worker;
  worker = undefined;
  child.kill();
}
