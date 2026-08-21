import { fork } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  validateMinomuncherReplayFiles,
} from './minomuncher-replay-validation.js';

const workerPath =
  fileURLToPath(
    new URL(
      './minomuncher-analysis-worker.js',
      import.meta.url,
    ),
  );

const workerTimeoutMs =
  readPositiveInteger(
    process.env.MINOMUNCHER_WORKER_TIMEOUT_MS,
    30_000,
  );

// V8 자체 OOM까지 도달하기 전에
// 아래 RSS watchdog이 먼저 worker를 죽이도록
// heap limit은 RSS limit보다 조금 크게 둔다.
const workerHeapMb =
  readPositiveInteger(
    process.env.MINOMUNCHER_WORKER_HEAP_MB,
    1024,
  );

const workerRssLimitMb =
  readPositiveInteger(
    process.env.MINOMUNCHER_WORKER_RSS_LIMIT_MB,
    768,
  );

const maxConcurrency =
  readPositiveInteger(
    process.env.MINOMUNCHER_MAX_CONCURRENCY,
    1,
  );

const workerRssPollMs =
  Math.max(
    50,
    readPositiveInteger(
      process.env.MINOMUNCHER_WORKER_RSS_POLL_MS,
      100,
    ),
  );

const workerStderrMaxChars =
  32_000;

let activeAnalysisCount = 0;

export async function createMinomuncherAnalysis(
  options = {},
) {
  // 가장 먼저 메인 프로세스에서 가벼운 구조 검증.
  // 여기서 비정상 frame / board / prototype 입력을 차단한다.
  const replayFiles =
    validateMinomuncherReplayFiles(
      options.replays,
    );

  // 공격자가 여러 worker를 동시에 띄워
  // VM 전체 RAM을 압박하는 것도 막는다.
  if (
    activeAnalysisCount >=
    maxConcurrency
  ) {
    const error =
      new Error(
        'MinoMuncher worker is busy',
      );

    error.code =
      'MINOMUNCHER_BUSY';

    throw error;
  }

  activeAnalysisCount += 1;

  try {
    return await runMinomuncherWorker({
      replays: replayFiles,

      targetUsername:
        normalizeTargetUsername(
          options.targetUsername,
        ),
    });
  } finally {
    activeAnalysisCount -= 1;
  }
}

export function filterMinomuncherStatsByUsername(
  stats,
  targetUsername,
) {
  const normalizedTargetUsername =
    normalizeTargetUsername(
      targetUsername,
    );

  if (!normalizedTargetUsername) {
    return stats;
  }

  return Object.fromEntries(
    Object.entries(
      stats ?? {},
    ).filter(
      ([, player]) =>
        normalizeTargetUsername(
          player?.username,
        ) ===
        normalizedTargetUsername,
    ),
  );
}

function runMinomuncherWorker(payload) {
  return new Promise(
    (resolve, reject) => {
      let settled = false;
      let stderrText = '';

      let timeoutId = null;
      let rssIntervalId = null;

      const child = fork(
        workerPath,
        [],
        {
          // 테스트 러너나 inspector 플래그는 상속하지 않고
          // worker heap 제한만 명시적으로 적용한다.
          execArgv: [
            `--max-old-space-size=${workerHeapMb}`,
          ],

          env: {
            ...process.env,
            MINOMUNCHER_ISOLATED_WORKER:
              '1',
          },

          stdio: [
            'ignore',
            'ignore',
            'pipe',
            'ipc',
          ],

          // Buffer를 JSON 배열로 터뜨리지 않고
          // IPC structured clone으로 전달한다.
          serialization: 'advanced',
        },
      );

      const finish = (
        error,
        result,
      ) => {
        if (settled) {
          return;
        }

        settled = true;

        clearTimeout(timeoutId);
        clearInterval(rssIntervalId);

        if (error) {
          if (
            stderrText &&
            !error.workerStderr
          ) {
            error.workerStderr =
              stderrText.slice(
                -workerStderrMaxChars,
              );
          }

          reject(error);
          return;
        }

        resolve(result);
      };

      const terminate = (error) => {
        if (
          !settled &&
          child.pid
        ) {
          // SIGABRT가 아니라 SIGKILL로 직접 종료해서
          // runaway worker가 본체까지 붙잡지 못하게 한다.
          child.kill('SIGKILL');
        }

        finish(error);
      };

      child.stderr?.on(
        'data',
        (chunk) => {
          stderrText =
            `${stderrText}${String(chunk)}`
              .slice(
                -workerStderrMaxChars,
              );
        },
      );

      child.once(
        'error',
        (cause) => {
          const error =
            new Error(
              'Failed to start MinoMuncher worker',
            );

          error.code =
            'MINOMUNCHER_WORKER_CRASH';

          error.cause = cause;

          finish(error);
        },
      );

      child.once(
        'exit',
        (code, signal) => {
          if (settled) {
            return;
          }

          const error =
            new Error(
              `MinoMuncher worker exited before returning a result (code=${code}, signal=${signal})`,
            );

          error.code =
            'MINOMUNCHER_WORKER_CRASH';

          error.exitCode =
            code;

          error.signal =
            signal;

          finish(error);
        },
      );

      child.on(
        'message',
        (message) => {
          if (
            settled ||
            message?.type !==
              'minomuncher-result'
          ) {
            return;
          }

          if (message.ok) {
            finish(
              null,
              message.result,
            );

            return;
          }

          finish(
            deserializeWorkerError(
              message.error,
            ),
          );
        },
      );

      // CPU 무한루프 / tick-loop 방어
      timeoutId =
        setTimeout(
          () => {
            const error =
              new Error(
                `MinoMuncher analysis exceeded ${workerTimeoutMs}ms`,
              );

            error.code =
              'MINOMUNCHER_WORKER_TIMEOUT';

            error.timeoutMs =
              workerTimeoutMs;

            terminate(error);
          },
          workerTimeoutMs,
        );

      // Linux VM에서 실제 RSS를 감시.
      //
      // Node V8 heap OOM으로 SIGABRT가 나기 전에
      // parent가 SIGKILL해버리는 것이 목적.
      if (
        process.platform === 'linux' &&
        child.pid
      ) {
        rssIntervalId =
          setInterval(
            () => {
              const rssBytes =
                readLinuxProcessRssBytes(
                  child.pid,
                );

              if (
                rssBytes === null
              ) {
                return;
              }

              const limitBytes =
                workerRssLimitMb *
                1024 *
                1024;

              if (
                rssBytes <= limitBytes
              ) {
                return;
              }

              const error =
                new Error(
                  `MinoMuncher worker exceeded RSS limit (${rssBytes} > ${limitBytes})`,
                );

              error.code =
                'MINOMUNCHER_WORKER_RESOURCE_LIMIT';

              error.rssBytes =
                rssBytes;

              error.rssLimitBytes =
                limitBytes;

              terminate(error);
            },
            workerRssPollMs,
          );

        rssIntervalId.unref?.();
      }

      child.send(
        {
          type:
            'minomuncher-run',

          payload,
        },
        (sendError) => {
          if (
            !sendError ||
            settled
          ) {
            return;
          }

          const error =
            new Error(
              'Failed to send work to MinoMuncher worker',
            );

          error.code =
            'MINOMUNCHER_WORKER_CRASH';

          error.cause =
            sendError;

          terminate(error);
        },
      );
    },
  );
}

function readLinuxProcessRssBytes(pid) {
  try {
    const status =
      fs.readFileSync(
        `/proc/${pid}/status`,
        'utf8',
      );

    const match =
      status.match(
        /^VmRSS:\s+(\d+)\s+kB$/m,
      );

    return match
      ? Number(match[1]) * 1024
      : null;
  } catch {
    return null;
  }
}

function deserializeWorkerError(
  serialized,
) {
  const error =
    new Error(
      serialized?.message ||
      'MinoMuncher worker failed',
    );

  error.code =
    serialized?.code ||
    'MINOMUNCHER_WORKER_FAILED';

  for (
    const key of [
      'status',
      'fileName',
      'reason',
      'failedReplayFiles',
    ]
  ) {
    if (
      serialized?.[key] !==
      undefined
    ) {
      error[key] =
        serialized[key];
    }
  }

  if (serialized?.stack) {
    error.workerStack =
      serialized.stack;
  }

  return error;
}

function normalizeTargetUsername(
  value,
) {
  const normalized =
    String(
      value ?? '',
    )
      .trim()
      .toLowerCase();

  return normalized || null;
}

function readPositiveInteger(
  ...values
) {
  for (const value of values) {
    const number =
      Number(value);

    if (
      Number.isSafeInteger(number) &&
      number > 0
    ) {
      return number;
    }
  }

  return 1;
}