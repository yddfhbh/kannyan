// Cost divisors follow the current 2025-03-20 30-star table used by meaegi's simulator.
const STARFORCE_COST_RULES = Object.freeze([
  {
    minStarInclusive: 0,
    maxStarInclusive: 9,
    power: 1,
    divisor: 36,
  },
  {
    minStarInclusive: 10,
    maxStarInclusive: 10,
    power: 2.7,
    divisor: 571,
  },
  {
    minStarInclusive: 11,
    maxStarInclusive: 11,
    power: 2.7,
    divisor: 314,
  },
  {
    minStarInclusive: 12,
    maxStarInclusive: 12,
    power: 2.7,
    divisor: 214,
  },
  {
    minStarInclusive: 13,
    maxStarInclusive: 13,
    power: 2.7,
    divisor: 157,
  },
  {
    minStarInclusive: 14,
    maxStarInclusive: 14,
    power: 2.7,
    divisor: 107,
  },
  {
    minStarInclusive: 15,
    maxStarInclusive: 16,
    power: 2.7,
    divisor: 200,
  },
  {
    minStarInclusive: 17,
    maxStarInclusive: 17,
    power: 2.7,
    divisor: 150,
  },
  {
    minStarInclusive: 18,
    maxStarInclusive: 18,
    power: 2.7,
    divisor: 70,
  },
  {
    minStarInclusive: 19,
    maxStarInclusive: 19,
    power: 2.7,
    divisor: 45,
  },
  {
    minStarInclusive: 20,
    maxStarInclusive: 20,
    power: 2.7,
    divisor: 200,
  },
  {
    minStarInclusive: 21,
    maxStarInclusive: 21,
    power: 2.7,
    divisor: 125,
  },
  {
    minStarInclusive: 22,
    maxStarInclusive: 29,
    power: 2.7,
    divisor: 200,
  },
]);

export function calculateStarforceCost({
  level,
  star,
  event = {},
}) {
  const rule = getStarforceCostRule(star);
  const baseCost = 1000 + (level ** 3) * ((star + 1) ** rule.power) / rule.divisor;
  const discountedBaseCost = applyStarforceDiscounts(baseCost, {
    star,
    event,
  });
  const safeguardExtraCost = shouldApplySafeguard(event, star) ? baseCost * 2 : 0;

  return roundToNearestHundred(discountedBaseCost + safeguardExtraCost);
}

export function getStarforceCostRule(star) {
  const rule = STARFORCE_COST_RULES.find((candidate) => (
    star >= candidate.minStarInclusive && star <= candidate.maxStarInclusive
  ));

  if (!rule) {
    throw new RangeError(`Unsupported star value for cost calculation: ${star}`);
  }

  return rule;
}

function shouldApplySafeguard(event, star) {
  return Boolean(event.safeguard) && star >= 15 && star <= 17;
}

function applyStarforceDiscounts(baseCost, { star, event }) {
  const eventDiscountMultiplier = event.discount30 ? 0.7 : 1;
  const regularDiscountMultiplier = star < 17
    ? (1 - getRegularDiscountRate(event) / 100)
    : 1;

  return baseCost * eventDiscountMultiplier * regularDiscountMultiplier;
}

function getRegularDiscountRate(event) {
  return Number(event.regularDiscountRate) || 0;
}

function roundToNearestHundred(value) {
  return Math.round(Number(value) / 100) * 100;
}
