function parseTetrioGraphInput(input) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) {
    return { kind: 'empty', targets: null };
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.every(isDecimalNumberToken)) {
    if (tokens.length === 3) {
      const [apm, pps, vs] = tokens.map(Number);
      return {
        kind: 'metric',
        metricInput: { apm, pps, vs },
        target: null,
      };
    }

    if (tokens.length >= 4) {
      return { kind: 'invalid' };
    }

    return { kind: 'targets', targets: tokens };
  }

  if (tokens.every(isTetrioGraphTargetToken)) {
    if (tokens.length >= 16) {
      return { kind: 'invalid' };
    }

    return { kind: 'targets', targets: tokens };
  }

  return { kind: 'invalid' };
}

function isTetrioGraphTargetToken(token) {
  return /^[A-Za-z0-9_-]+$/.test(String(token ?? ''))
    || Boolean(parseDiscordMentionUserId(token));
}

function isDecimalNumberToken(token) {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token);
}

function isValidTetrioStatsMetricInput({ apm, pps, vs }) {
  return [apm, pps, vs].every((value) => Number.isFinite(value) && value > 0);
}

function parseDiscordMentionUserId(value) {
  const match = String(value ?? '').trim().match(/^<@!?(\d{17,20})>$/);
  return match?.[1] ?? null;
}

export {
  isDecimalNumberToken,
  isTetrioGraphTargetToken,
  isValidTetrioStatsMetricInput,
  parseDiscordMentionUserId,
  parseTetrioGraphInput,
};
