const dangerousPropertyNames = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

const dangerousIdValues = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

const defaultLimits = Object.freeze({
  maxFiles: 10,
  maxSingleBytes: 25 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,

  // 60FPS 기준 약 9.25시간.
  // 정상 TETR.IO 게임이 이 값을 넘을 이유가 없다.
  maxFrame: 2_000_000,

  // 실제 게임판보다 훨씬 넉넉하게 잡되
  // 비정상적인 거대 배열 할당은 차단한다.
  maxBoardWidth: 100,
  maxBoardHeight: 400,

  maxEvents: 500_000,
  maxNodes: 2_000_000,
  maxDepth: 128,
});

export function validateMinomuncherReplayFiles(replays, options = {}) {
  const limits = resolveLimits(options);
  const replayFiles = normalizeReplayFiles(replays);

  if (replayFiles.length > limits.maxFiles) {
    throw createRejectedReplayError(
      null,
      `too many replay files (${replayFiles.length} > ${limits.maxFiles})`,
    );
  }

  let totalBytes = 0;

  for (const replayFile of replayFiles) {
    const byteLength = Buffer.byteLength(
      replayFile.content,
      'utf8',
    );

    totalBytes += byteLength;

    if (byteLength > limits.maxSingleBytes) {
      throw createRejectedReplayError(
        replayFile.name,
        `replay is too large (${byteLength} bytes)`,
      );
    }

    if (totalBytes > limits.maxTotalBytes) {
      throw createRejectedReplayError(
        replayFile.name,
        `combined replay input is too large (${totalBytes} bytes)`,
      );
    }

    let parsed;

    try {
      parsed = JSON.parse(replayFile.content);
    } catch (cause) {
      const error = new Error(
        `Replay JSON could not be parsed: ${replayFile.name}`,
      );

      error.code = 'MINOMUNCHER_REPLAY_PARSE_FAILED';
      error.failedReplayFiles = [replayFile.name];
      error.cause = cause;

      throw error;
    }

    inspectReplayTree(
      parsed,
      replayFile.name,
      limits,
    );
  }

  return replayFiles;
}

function inspectReplayTree(root, fileName, limits) {
  const stack = [
    {
      value: root,
      path: '$',
      depth: 0,
    },
  ];

  let visitedNodes = 0;
  let eventCount = 0;

  // 재귀 대신 stack을 사용해서
  // 의도적인 deep nesting으로 JS call stack이 터지는 것도 막는다.
  while (stack.length > 0) {
    const current = stack.pop();

    visitedNodes += 1;

    if (visitedNodes > limits.maxNodes) {
      throw createRejectedReplayError(
        fileName,
        `replay structure is too large (${visitedNodes} nodes)`,
      );
    }

    if (current.depth > limits.maxDepth) {
      throw createRejectedReplayError(
        fileName,
        `replay nesting is too deep (>${limits.maxDepth})`,
      );
    }

    if (Array.isArray(current.value)) {
      for (
        let index = current.value.length - 1;
        index >= 0;
        index -= 1
      ) {
        stack.push({
          value: current.value[index],
          path: `${current.path}[${index}]`,
          depth: current.depth + 1,
        });
      }

      continue;
    }

    if (
      !current.value ||
      typeof current.value !== 'object'
    ) {
      continue;
    }

    for (
      const [key, value]
      of Object.entries(current.value)
    ) {
      const normalizedKey = key.toLowerCase();
      const childPath =
        `${current.path}.${key}`;

      // prototype pollution 계열 property 자체 차단
      if (
        dangerousPropertyNames.has(
          normalizedKey,
        )
      ) {
        throw createRejectedReplayError(
          fileName,
          `dangerous property name at ${childPath}`,
        );
      }

      // event 폭탄 방지
      if (
        normalizedKey === 'events' &&
        Array.isArray(value)
      ) {
        eventCount += value.length;

        if (eventCount > limits.maxEvents) {
          throw createRejectedReplayError(
            fileName,
            `too many replay events (${eventCount} > ${limits.maxEvents})`,
          );
        }
      }

      // tick-loop 방지
      if (normalizedKey === 'frame') {
        const frame =
          readFiniteNumber(value);

        if (
          frame === null ||
          frame < 0 ||
          frame > limits.maxFrame
        ) {
          throw createRejectedReplayError(
            fileName,
            `invalid frame value at ${childPath}: ${formatValue(value)}`,
          );
        }
      }

      // 거대 board allocation 방지
      if (normalizedKey === 'boardwidth') {
        const boardWidth =
          readFiniteNumber(value);

        if (
          boardWidth === null ||
          boardWidth < 1 ||
          boardWidth > limits.maxBoardWidth
        ) {
          throw createRejectedReplayError(
            fileName,
            `invalid boardwidth at ${childPath}: ${formatValue(value)}`,
          );
        }
      }

      if (normalizedKey === 'boardheight') {
        const boardHeight =
          readFiniteNumber(value);

        if (
          boardHeight === null ||
          boardHeight < 1 ||
          boardHeight > limits.maxBoardHeight
        ) {
          throw createRejectedReplayError(
            fileName,
            `invalid boardheight at ${childPath}: ${formatValue(value)}`,
          );
        }
      }

      // player id 등을 object key로 쓰는 라이브러리 대비
      if (
        isIdLikeKey(normalizedKey) &&
        typeof value === 'string'
      ) {
        const normalizedId =
          value.trim().toLowerCase();

        if (
          dangerousIdValues.has(
            normalizedId,
          )
        ) {
          throw createRejectedReplayError(
            fileName,
            `dangerous id value at ${childPath}`,
          );
        }
      }

      if (
        value &&
        typeof value === 'object'
      ) {
        stack.push({
          value,
          path: childPath,
          depth: current.depth + 1,
        });
      }
    }
  }
}

function resolveLimits(options) {
  return {
    maxFiles:
      readPositiveInteger(
        options.maxFiles,
        process.env.MINOMUNCHER_VALIDATION_MAX_FILES,
        defaultLimits.maxFiles,
      ),

    maxSingleBytes:
      readPositiveInteger(
        options.maxSingleBytes,
        process.env.MINOMUNCHER_VALIDATION_MAX_SINGLE_BYTES,
        defaultLimits.maxSingleBytes,
      ),

    maxTotalBytes:
      readPositiveInteger(
        options.maxTotalBytes,
        process.env.MINOMUNCHER_VALIDATION_MAX_TOTAL_BYTES,
        defaultLimits.maxTotalBytes,
      ),

    maxFrame:
      readPositiveInteger(
        options.maxFrame,
        process.env.MINOMUNCHER_VALIDATION_MAX_FRAME,
        defaultLimits.maxFrame,
      ),

    maxBoardWidth:
      readPositiveInteger(
        options.maxBoardWidth,
        process.env.MINOMUNCHER_VALIDATION_MAX_BOARD_WIDTH,
        defaultLimits.maxBoardWidth,
      ),

    maxBoardHeight:
      readPositiveInteger(
        options.maxBoardHeight,
        process.env.MINOMUNCHER_VALIDATION_MAX_BOARD_HEIGHT,
        defaultLimits.maxBoardHeight,
      ),

    maxEvents:
      readPositiveInteger(
        options.maxEvents,
        process.env.MINOMUNCHER_VALIDATION_MAX_EVENTS,
        defaultLimits.maxEvents,
      ),

    maxNodes:
      readPositiveInteger(
        options.maxNodes,
        process.env.MINOMUNCHER_VALIDATION_MAX_NODES,
        defaultLimits.maxNodes,
      ),

    maxDepth:
      readPositiveInteger(
        options.maxDepth,
        process.env.MINOMUNCHER_VALIDATION_MAX_DEPTH,
        defaultLimits.maxDepth,
      ),
  };
}

function normalizeReplayFiles(replays) {
  return (
    Array.isArray(replays)
      ? replays
      : []
  )
    .map((replay, index) => ({
      name:
        String(
          replay?.name ??
          `replay-${index + 1}.ttrm`,
        ).trim() ||
        `replay-${index + 1}.ttrm`,

      content:
        String(
          replay?.content ?? '',
        ),
    }))
    .filter(
      (replay) => replay.content,
    );
}

function readPositiveInteger(...values) {
  for (const value of values) {
    const number = Number(value);

    if (
      Number.isSafeInteger(number) &&
      number > 0
    ) {
      return number;
    }
  }

  return 1;
}

function readFiniteNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value
      : null;
  }

  if (
    typeof value === 'string' &&
    value.trim()
  ) {
    const number = Number(value);

    return Number.isFinite(number)
      ? number
      : null;
  }

  return null;
}

function isIdLikeKey(key) {
  return (
    key === 'id' ||
    key === '_id' ||
    key.endsWith('id')
  );
}

function formatValue(value) {
  const text = String(value);

  return text.length <= 80
    ? text
    : `${text.slice(0, 77)}...`;
}

function createRejectedReplayError(
  fileName,
  reason,
) {
  const error = new Error(
    fileName
      ? `Unsafe MinoMuncher replay rejected: ${fileName}: ${reason}`
      : `Unsafe MinoMuncher replay rejected: ${reason}`,
  );

  error.code =
    'MINOMUNCHER_REPLAY_REJECTED';

  error.fileName =
    fileName ?? null;

  error.reason =
    reason;

  return error;
}