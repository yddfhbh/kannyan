import { calculateStarforceCost } from './starforce-cost.js';
import { STARFORCE_DEFAULT_ITEM_ICON_PATH } from './starforce-card.js';
import { buildStarforceRates } from './starforce-rates.js';

export const STARFORCE_SUPPORTED_LEVELS = Object.freeze([
  80,
  90,
  100,
  110,
  120,
  130,
  140,
  150,
  160,
  200,
  250,
]);

export const STARFORCE_MAX_STAR = 30;
export const STARFORCE_RECENT_LOG_LIMIT = 8;

export function isSupportedStarforceLevel(level) {
  return STARFORCE_SUPPORTED_LEVELS.includes(level);
}

export function parseStarforceLevelInput(input) {
  const normalized = String(input ?? '').trim();

  if (!normalized) {
    return {
      ok: false,
      error: 'usage',
    };
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length !== 1 || !/^\d+$/.test(tokens[0])) {
    return {
      ok: false,
      error: 'usage',
    };
  }

  const level = Number(tokens[0]);
  if (!isSupportedStarforceLevel(level)) {
    return {
      ok: false,
      error: 'unsupported_level',
      level,
    };
  }

  return {
    ok: true,
    level,
  };
}

export function getStarforceMaxStarForLevel(level) {
  if (level <= 94) {
    return 5;
  }

  if (level <= 107) {
    return 8;
  }

  if (level <= 117) {
    return 10;
  }

  if (level <= 127) {
    return 15;
  }

  if (level <= 137) {
    return 20;
  }

  return STARFORCE_MAX_STAR;
}

export function createStarforceSessionState({
  sessionId,
  ownerUserId,
  level,
  now = Date.now(),
}) {
  return {
    sessionId,
    ownerUserId,
    level,
    equipLevel: level,
    maxStar: getStarforceMaxStarForLevel(level),
    currentStar: 0,
    totalMesos: 0,
    mesoUsed: 0,
    attemptCount: 0,
    attempts: 0,
    destroyCount: 0,
    destroyed: 0,
    recentLogs: [],
    event: {
      name: '없음',
      discount30: false,
      fiveTenFifteen: false,
      destroyReduction: false,
      safeguard: false,
      starCatch: false,
    },
    itemIconPath: STARFORCE_DEFAULT_ITEM_ICON_PATH,
    status: 'active',
    startedAtMs: now,
    updatedAtMs: now,
    expiresAtMs: now,
    channelId: '',
    messageId: '',
    statusText: '',
  };
}

export function resetStarforceSessionState(session, now = Date.now()) {
  session.currentStar = 0;
  session.totalMesos = 0;
  session.mesoUsed = 0;
  session.attemptCount = 0;
  session.attempts = 0;
  session.destroyCount = 0;
  session.destroyed = 0;
  session.recentLogs = [];
  session.status = 'active';
  session.updatedAtMs = now;
  session.statusText = '';

  return session;
}

export function performStarforceAttempt(session, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const randomValue = normalizeRandomValue(options.randomValue);

  session.updatedAtMs = now;

  if (session.currentStar >= session.maxStar) {
    return {
      type: 'maxed',
      session,
      log: `이미 최대 성수(${session.maxStar}성)다냥.`,
    };
  }

  const beforeStar = session.currentStar;
  const targetStar = beforeStar + 1;
  const rates = buildStarforceRates({
    star: beforeStar,
    event: session.event,
    chanceTime: false,
  });
  const cost = calculateStarforceCost({
    level: session.equipLevel ?? session.level,
    star: beforeStar,
    event: session.event,
  });

  session.totalMesos += cost;
  session.mesoUsed = session.totalMesos;
  session.attemptCount += 1;
  session.attempts = session.attemptCount;

  let resultType = 'fail';
  let log = `${beforeStar} → ${targetStar} 실패`;

  if (randomValue < rates.success) {
    session.currentStar = targetStar;
    resultType = 'success';
    log = `${beforeStar} → ${targetStar} 성공`;
  } else if (randomValue >= rates.success + rates.fail) {
    session.currentStar = 12;
    session.destroyCount += 1;
    session.destroyed = session.destroyCount;
    resultType = 'destroy';
    log = `${beforeStar} → ${targetStar} 파괴! 흔적 복구로 12성 복구`;
  }

  appendStarforceRecentLog(session, log);

  return {
    type: resultType,
    session,
    log,
    beforeStar,
    targetStar,
    cost,
    rates,
  };
}

export function appendStarforceRecentLog(session, logLine) {
  session.recentLogs.push(String(logLine ?? '').trim());

  if (session.recentLogs.length > STARFORCE_RECENT_LOG_LIMIT) {
    session.recentLogs = session.recentLogs.slice(-STARFORCE_RECENT_LOG_LIMIT);
  }
}

function normalizeRandomValue(randomValue) {
  if (!Number.isFinite(randomValue)) {
    return Math.random();
  }

  if (randomValue <= 0) {
    return 0;
  }

  if (randomValue >= 1) {
    return 0.999999999999;
  }

  return randomValue;
}
