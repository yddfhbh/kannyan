'use strict';

const createStockfish = require('stockfish');

let sharedEnginePromise;
let analysisQueue = Promise.resolve();

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
  let infoLines = [];

  engine.listener = (line) => {
    const text = String(line ?? '').trim();
    if (!text) {
      return;
    }

    if (text.startsWith('info ') && text.includes(' score ')) {
      lastInfo = text;
      infoLines.push(text);
      if (infoLines.length > 300) {
        infoLines = infoLines.slice(-200);
      }
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
    getInfoForBestMove(bestMove) {
      const pvPattern = new RegExp(`\\bpv\\s+${bestMove}(?:\\s|$)`);
      return [...infoLines].reverse().find((line) => pvPattern.test(line)) ?? lastInfo;
    },
    clearLastInfo() {
      lastInfo = '';
      infoLines = [];
    },
  };
}

async function getSharedEngine() {
  if (!sharedEnginePromise) {
    sharedEnginePromise = (async () => {
      const engine = await createStockfish('lite-single');
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

async function runAnalysis({ fen, movetimeMs, depth }) {
  const { engine, reader } = await getSharedEngine();
  reader.clearLastInfo();
  engine.sendCommand('ucinewgame');
  engine.sendCommand(`position fen ${fen}`);

  const bestMoveReady = reader.waitFor(
    /^bestmove\s+/,
    Math.max(50, Number(movetimeMs) || 2000) + 10_000
  );
  engine.sendCommand(
    Number.isInteger(depth) && depth > 0
      ? `go depth ${depth}`
      : `go movetime ${Math.max(50, Number(movetimeMs) || 2000)}`
  );

  const bestMoveLine = await bestMoveReady;
  const bestMove = bestMoveLine.split(/\s+/)[1] ?? '';
  return {
    bestMove,
    info: reader.getInfoForBestMove(bestMove),
  };
}

process.on('message', (message) => {
  if (!message?.id || !message.fen) {
    return;
  }

  const task = async () => {
    try {
      const result = await runAnalysis(message);
      process.send?.({ id: message.id, result });
    } catch (error) {
      process.send?.({
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const queuedTask = analysisQueue.then(task, task);
  analysisQueue = queuedTask.catch(() => {});
});

process.on('disconnect', () => {
  process.exit(0);
});
