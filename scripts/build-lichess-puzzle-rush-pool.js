import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const child = spawn(
  process.execPath,
  [fileURLToPath(new URL('./build-lichess-puzzle-pool.js', import.meta.url))],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      LICHESS_PUZZLE_OUTPUT_PATH:
        process.env.LICHESS_PUZZLE_OUTPUT_PATH || 'data/lichess-puzzle-rush-pool.jsonl',
      LICHESS_PUZZLE_MIN_RATING:
        process.env.LICHESS_PUZZLE_MIN_RATING || '800',
      LICHESS_PUZZLE_MAX_RATING:
        process.env.LICHESS_PUZZLE_MAX_RATING || '3200',
      LICHESS_PUZZLE_POOL_SIZE:
        process.env.LICHESS_PUZZLE_POOL_SIZE || '40000',
      LICHESS_PUZZLE_MIN_MOVES:
        process.env.LICHESS_PUZZLE_MIN_MOVES || '2',
      LICHESS_PUZZLE_MAX_MOVES:
        process.env.LICHESS_PUZZLE_MAX_MOVES || '12',
      LICHESS_PUZZLE_MIN_POPULARITY:
        process.env.LICHESS_PUZZLE_MIN_POPULARITY || '50',
      LICHESS_PUZZLE_MIN_PLAYS:
        process.env.LICHESS_PUZZLE_MIN_PLAYS || '20',
    },
  }
);

const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', (code, signal) => {
    if (signal) {
      reject(new Error(`build-lichess-puzzle-rush-pool.js terminated by signal ${signal}`));
      return;
    }

    resolve(code ?? 1);
  });
});

process.exit(exitCode);
