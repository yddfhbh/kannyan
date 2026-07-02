export const STARFORCE_MAX_STAR = 30;
export const STARFORCE_FLOOR_STARS = new Set([10, 15, 20]);

// Base success/destroy values follow the current 2025-03-20 30-star table
// used by meaegi's simulator. Destroy is stored here as the final rolled chance.
export const STARFORCE_BASE_RATES = Object.freeze([
  { success: 0.95, fail: 0.05, destroy: 0 },
  { success: 0.90, fail: 0.10, destroy: 0 },
  { success: 0.85, fail: 0.15, destroy: 0 },
  { success: 0.85, fail: 0.15, destroy: 0 },
  { success: 0.80, fail: 0.20, destroy: 0 },
  { success: 0.75, fail: 0.25, destroy: 0 },
  { success: 0.70, fail: 0.30, destroy: 0 },
  { success: 0.65, fail: 0.35, destroy: 0 },
  { success: 0.60, fail: 0.40, destroy: 0 },
  { success: 0.55, fail: 0.45, destroy: 0 },
  { success: 0.50, fail: 0.50, destroy: 0 },
  { success: 0.45, fail: 0.55, destroy: 0 },
  { success: 0.40, fail: 0.60, destroy: 0 },
  { success: 0.35, fail: 0.65, destroy: 0 },
  { success: 0.30, fail: 0.70, destroy: 0 },
  { success: 0.30, fail: 0.679, destroy: 0.021 },
  { success: 0.30, fail: 0.679, destroy: 0.021 },
  { success: 0.15, fail: 0.782, destroy: 0.068 },
  { success: 0.15, fail: 0.782, destroy: 0.068 },
  { success: 0.15, fail: 0.765, destroy: 0.085 },
  { success: 0.30, fail: 0.595, destroy: 0.105 },
  { success: 0.15, fail: 0.7225, destroy: 0.1275 },
  { success: 0.15, fail: 0.68, destroy: 0.17 },
  { success: 0.10, fail: 0.72, destroy: 0.18 },
  { success: 0.10, fail: 0.72, destroy: 0.18 },
  { success: 0.10, fail: 0.72, destroy: 0.18 },
  { success: 0.07, fail: 0.744, destroy: 0.186 },
  { success: 0.05, fail: 0.76, destroy: 0.19 },
  { success: 0.03, fail: 0.776, destroy: 0.194 },
  { success: 0.01, fail: 0.792, destroy: 0.198 },
]);

export function getBaseStarforceRates(star) {
  if (!Number.isInteger(star) || star < 0 || star >= STARFORCE_BASE_RATES.length) {
    throw new RangeError(`Unsupported star value: ${star}`);
  }

  return STARFORCE_BASE_RATES[star];
}

export function buildStarforceRates({
  star,
  event = {},
  chanceTime = false,
}) {
  if (chanceTime) {
    return {
      success: 1,
      fail: 0,
      destroy: 0,
    };
  }

  if (event.fiveTenFifteen && (star === 5 || star === 10 || star === 15)) {
    return {
      success: 1,
      fail: 0,
      destroy: 0,
    };
  }

  let { success, fail, destroy } = getBaseStarforceRates(star);

  if (event.destroyReduction && star <= 21 && destroy > 0) {
    const reducedDestroy = destroy * 0.7;
    fail += destroy - reducedDestroy;
    destroy = reducedDestroy;
  }

  if (event.safeguard && star >= 15 && star <= 17 && destroy > 0) {
    fail += destroy;
    destroy = 0;
  }

  if (event.starCatch) {
    const boostedSuccess = Math.min(1, success * 1.05);
    const remainingBefore = fail + destroy;
    const remainingAfter = Math.max(0, 1 - boostedSuccess);
    const scale = remainingBefore > 0 ? remainingAfter / remainingBefore : 0;

    success = boostedSuccess;
    fail *= scale;
    destroy *= scale;
  }

  return normalizeRates({
    success,
    fail,
    destroy,
  });
}

function normalizeRates(rates) {
  const success = Number(rates.success) || 0;
  const fail = Number(rates.fail) || 0;
  const destroy = Number(rates.destroy) || 0;
  const total = success + fail + destroy;

  if (total <= 0) {
    return {
      success: 0,
      fail: 1,
      destroy: 0,
    };
  }

  return {
    success: success / total,
    fail: fail / total,
    destroy: destroy / total,
  };
}
