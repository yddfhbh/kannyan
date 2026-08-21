import {
  createMinomuncherAnalysis as createMinomuncherAnalysisCore,
} from './minomuncher-analysis-core.js';

let started = false;

process.on(
  'message',
  async (message) => {
    if (
      started ||
      message?.type !== 'minomuncher-run'
    ) {
      return;
    }

    started = true;

    try {
      const result =
        await createMinomuncherAnalysisCore(
          message.payload ?? {},
        );

      sendResultAndExit(
        {
          type: 'minomuncher-result',
          ok: true,
          result,
        },
        0,
      );
    } catch (error) {
      sendResultAndExit(
        {
          type: 'minomuncher-result',
          ok: false,
          error: serializeError(error),
        },
        1,
      );
    }
  },
);

function sendResultAndExit(
  message,
  exitCode,
) {
  if (
    !process.connected ||
    typeof process.send !== 'function'
  ) {
    process.exit(exitCode);
    return;
  }

  process.send(
    message,
    (error) => {
      if (error) {
        console.error(
          'Failed to send MinoMuncher worker result:',
        );
        console.error(error);

        process.exit(1);
        return;
      }

      process.exit(exitCode);
    },
  );
}

function serializeError(error) {
  return {
    message:
      String(
        error?.message ??
        'MinoMuncher worker failed',
      ),

    code:
      error?.code ?? null,

    status:
      error?.status ?? null,

    fileName:
      error?.fileName ?? null,

    reason:
      error?.reason ?? null,

    failedReplayFiles:
      Array.isArray(
        error?.failedReplayFiles,
      )
        ? error.failedReplayFiles.map(
            (value) => String(value),
          )
        : null,

    stack:
      String(
        error?.stack ?? '',
      ).slice(0, 20_000),
  };
}