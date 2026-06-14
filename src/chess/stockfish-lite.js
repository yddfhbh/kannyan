cat > src/chess/stockfish-lite.js <<'EOF'
import { spawn } from 'node:child_process';
import { Chess } from 'chess.js';

const STOCKFISH_PATH = process.env.STOCKFISH_PATH || '/usr/games/stockfish';
const STOCKFISH_THREADS = Math.max(1, Number(process.env.STOCKFISH_THREADS) || 1);
const STOCKFISH_HASH_MB = Math.max(1, Number(process.env.STOCKFISH_HASH_MB) || 16);
const STOCKFISH_TIMEOUT_MS = Math.max(1000, Number(process.env.STOCKFISH_TIMEOUT_MS) || 8000);

let analysisQueue = Promise.resolve();

function matchesLine(matcher, line) {
  if (typeof matcher === 'string') return line === matcher;
  matcher.lastIndex = 0;
  return matcher.test(line);
}

function collectLines(stream, lines) {
  let buffer = '';
  stream.setEncoding('utf8');

  stream.on('data', (chunk) => {
    buffer += chunk;

    while (true) {
      const match = buffer.match(/\r?\n/);
      if (!match) break;

      const index = match.index;
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + match[0].length);

      if (line) lines.push(line);
    }
  });
}

function waitForLine(lines, matcher, timeoutMs, getExited) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const timer = setInterval(() => {
      const found = lines.find((line) => matchesLine(matcher, line));
      if (found) {
        clearInterval(timer);
        resolve(found);
        return;
      }

      const exited = getExited();
      if (exited) {
        clearInterval(timer);
        reject(new Error(`Stockfish exited before ${matcher}: code=${exited.code} signal=${exited.signal}`));
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Stockfish timeout waiting for ${matcher}`));
      }
    }, 20);
  });
}

function uciToSan(fen, uci) {
  if (!uci || uci === '(none)') return '(none)';

  const chess = new Chess(fen);
  const moveInput = {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
  };

  if (uci[4]) moveInput.promotion = uci[4];

  const move = chess.move(moveInput);
  return move?.san ?? uci;
}

function parseScore(infoLine) {
  const match = infoLine?.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
  if (!match) return null;

  return {
    type: match[1],
    value: Number(match[2]),
  };
}

function parseDepth(infoLine) {
  const match = infoLine?.match(/\bdepth\s+(\d+)/);
  return match ? Number(match[1]) : null;
}

async function runStockfish(fen, options = {}) {
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

  const movetimeMs = Math.max(
    50,
    Number(options.movetimeMs)
      || Number(process.env.CHESS_STOCKFISH_MOVETIME_MS)
      || Number(process.env.STOCKFISH_MOVETIME_MS)
      || 1200,
  );

  const envDepth = Number(process.env.STOCKFISH_DEPTH);
  const depth = Number.isInteger(options.depth) && options.depth > 0
    ? options.depth
    : Number.isInteger(envDepth) && envDepth > 0
      ? envDepth
      : null;

  const lines = [];
  const errLines = [];
  let exited = null;

  const child = spawn(STOCKFISH_PATH, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  collectLines(child.stdout, lines);
  collectLines(child.stderr, errLines);

  child.on('exit', (code, signal) => {
    exited = { code, signal };
  });

  const send = (command) => {
    if (!child.stdin.destroyed) {
      child.stdin.write(`${command}\n`);
    }
  };

  try {
    send('uci');
    await waitForLine(lines, 'uciok', STOCKFISH_TIMEOUT_MS, () => exited);

    send(`setoption name Threads value ${STOCKFISH_THREADS}`);
    send(`setoption name Hash value ${STOCKFISH_HASH_MB}`);

    send('isready');
    await waitForLine(lines, 'readyok', STOCKFISH_TIMEOUT_MS, () => exited);

    send('ucinewgame');
    send(`position fen ${fen}`);

    const startIndex = lines.length;
    const bestMovePromise = waitForLine(
      lines,
      /^bestmove\s+/,
      movetimeMs + STOCKFISH_TIMEOUT_MS,
      () => exited,
    );

    send(depth ? `go depth ${depth}` : `go movetime ${movetimeMs}`);

    const bestMoveLine = await bestMovePromise;
    const bestMove = bestMoveLine.split(/\s+/)[1] ?? '';

    const analysisLines = lines.slice(startIndex);
    const lastInfo = analysisLines
      .filter((line) => line.startsWith('info ') && line.includes(' score '))
      .at(-1) ?? '';

    return {
      bestMove,
      san: bestMove ? uciToSan(fen, bestMove) : '(none)',
      score: parseScore(lastInfo),
      depth: parseDepth(lastInfo),
      info: lastInfo,
    };
  } finally {
    try {
      send('quit');
    } catch {}

    setTimeout(() => {
      try {
        if (!child.killed) child.kill('SIGTERM');
      } catch {}
    }, 500);
  }
}

export async function analyzeFenWithStockfish(fen, options = {}) {
  const runAnalysis = async () => {
    try {
      return await runStockfish(fen, options);
    } catch (error) {
      console.error(`Failed to analyze chess FEN ${fen}:`);
      console.error(error);

      return {
        bestMove: '',
        san: '(engine unavailable)',
        score: null,
        depth: null,
        info: '',
      };
    }
  };

  const queuedAnalysis = analysisQueue.then(runAnalysis, runAnalysis);
  analysisQueue = queuedAnalysis.catch(() => {});
  return queuedAnalysis;
}
EOF