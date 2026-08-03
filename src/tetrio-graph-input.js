const tetrioAverageRankTokenPattern = /^\$avg(x\+|x|u|ss|s\+|s|s-|a\+|a|a-|b\+|b|b-|c\+|c|c-|d\+|d|tl)$/i;

function parseTetrioGraphInput(input) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) {
    return { kind: 'empty', targets: null };
  }

  const metricInput = parseTetrioStatsMetricInput(trimmed);
  if (metricInput) {
    return {
      kind: 'metric',
      metricInput,
      target: null,
    };
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.every(isDecimalNumberToken)) {
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
    || Boolean(parseTetrioAverageRankToken(token))
    || Boolean(parseDiscordMentionUserId(token));
}

function isDecimalNumberToken(token) {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token);
}

function parseTetrioStatsMetricInput(input) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) {
    return null;
  }

  const tokens = trimmed.split(/[\s,]+/).filter(Boolean);
  if (tokens.length !== 3) {
    return null;
  }

  if (tokens.every(isDecimalNumberToken)) {
    const [apm, pps, vs] = tokens.map(Number);
    return { apm, pps, vs };
  }

  const labeledStats = {};
  for (const token of tokens) {
    const labeledMatch = String(token).match(/^(apm|pps|vs)(?:[:=]?)([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/i);
    if (!labeledMatch) {
      return null;
    }

    const key = labeledMatch[1].toLowerCase();
    if (Object.hasOwn(labeledStats, key)) {
      return null;
    }

    labeledStats[key] = Number(labeledMatch[2]);
  }

  if (!Object.hasOwn(labeledStats, 'apm') || !Object.hasOwn(labeledStats, 'pps') || !Object.hasOwn(labeledStats, 'vs')) {
    return null;
  }

  return {
    apm: labeledStats.apm,
    pps: labeledStats.pps,
    vs: labeledStats.vs,
  };
}

function isValidTetrioStatsMetricInput({ apm, pps, vs }) {
  return [apm, pps, vs].every((value) => Number.isFinite(value) && value > 0);
}

function parseDiscordMentionUserId(value) {
  const match = String(value ?? '').trim().match(/^<@!?(\d{17,20})>$/);
  return match?.[1] ?? null;
}

function parseTetrioAverageRankToken(value) {
  const match = String(value ?? '').trim().match(tetrioAverageRankTokenPattern);
  return match?.[1]?.toLowerCase() ?? null;
}

export {
  isDecimalNumberToken,
  isTetrioGraphTargetToken,
  isValidTetrioStatsMetricInput,
  parseTetrioAverageRankToken,
  parseDiscordMentionUserId,
  parseTetrioGraphInput,
  parseTetrioStatsMetricInput,
};
