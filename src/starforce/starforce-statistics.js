import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const STARFORCE_STATISTICS_PATH = fileURLToPath(
  new URL('../../data/starforce-statistics/classic-none.json', import.meta.url)
);

let loadPromise = null;
let statisticsIndex = new Map();

export async function ensureStarforceStatisticsLoaded() {
  if (!loadPromise) {
    loadPromise = loadStarforceStatistics();
  }

  await loadPromise;
}

export async function getStarforceStatisticsEntry(level, star, eventName = 'none') {
  await ensureStarforceStatisticsLoaded();
  return statisticsIndex.get(buildStarforceStatisticsKey(level, eventName, star)) ?? null;
}

export async function evaluateStarforceLuck({
  level,
  currentStar,
  mesoUsed,
  eventName = 'none',
}) {
  const normalizedStar = Number(currentStar);
  if (!Number.isFinite(normalizedStar) || normalizedStar <= 0) {
    return null;
  }

  const entry = await getStarforceStatisticsEntry(level, normalizedStar, eventName);
  if (!entry) {
    return null;
  }

  const mesoValue = Number(mesoUsed);
  if (!Number.isFinite(mesoValue) || mesoValue < 0) {
    return null;
  }

  const percentile = estimatePercentile(entry, mesoValue);
  const roundedPercentile = roundToOneDecimal(percentile);
  const topSide = roundedPercentile <= 50;
  const displayedPercent = topSide
    ? roundedPercentile
    : roundToOneDecimal(100 - roundedPercentile);
  const averageCost = Number(entry.average) || 0;
  const averageDelta = mesoValue - averageCost;

  return {
    level: Number(level),
    currentStar: normalizedStar,
    mesoUsed: mesoValue,
    averageCost,
    averageDelta,
    percentile: roundedPercentile,
    displayedPercent,
    direction: topSide ? 'top' : 'bottom',
    samples: Number(entry.samples) || 0,
    eventName,
    key: buildStarforceStatisticsKey(level, eventName, normalizedStar),
  };
}

function buildStarforceStatisticsKey(level, eventName, star) {
  return `${Number(level)}|${String(eventName ?? 'none')}|${Number(star)}`;
}

async function loadStarforceStatistics() {
  statisticsIndex = new Map();

  let raw;
  try {
    raw = await readFile(STARFORCE_STATISTICS_PATH, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('[STARFORCE] failed to load statistics table:');
      console.error(error);
    }
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('[STARFORCE] invalid statistics table JSON:');
    console.error(error);
    return;
  }

  const entries = parsed?.entries && typeof parsed.entries === 'object'
    ? Object.entries(parsed.entries)
    : [];

  for (const [key, value] of entries) {
    const sanitized = sanitizeStatisticsEntry(key, value);
    if (!sanitized) {
      continue;
    }

    statisticsIndex.set(key, sanitized);
  }
}

function sanitizeStatisticsEntry(key, entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const percentiles = entry.percentiles && typeof entry.percentiles === 'object'
    ? entry.percentiles
    : {};
  const normalizedPercentiles = {};

  for (const [percentText, cost] of Object.entries(percentiles)) {
    const numericPercent = Number(percentText);
    const numericCost = Number(cost);
    if (!Number.isFinite(numericPercent) || !Number.isFinite(numericCost)) {
      continue;
    }
    normalizedPercentiles[String(Math.trunc(numericPercent))] = numericCost;
  }

  if (!Object.keys(normalizedPercentiles).length) {
    return null;
  }

  const samples = Number(entry.samples);
  const average = Number(entry.average);
  const min = Number(entry.min);
  const max = Number(entry.max);

  if (!Number.isFinite(samples) || !Number.isFinite(average)) {
    return null;
  }

  return {
    key,
    level: Number(entry.level),
    targetStar: Number(entry.targetStar),
    eventName: String(entry.eventName ?? 'none'),
    samples,
    average,
    median: Number(entry.median),
    min: Number.isFinite(min) ? min : normalizedPercentiles['0'],
    max: Number.isFinite(max) ? max : normalizedPercentiles['100'],
    percentiles: normalizedPercentiles,
  };
}

function estimatePercentile(entry, mesoUsed) {
  const percentiles = entry.percentiles ?? {};
  const percentilePoints = [];

  for (let percent = 0; percent <= 100; percent += 1) {
    const value = Number(percentiles[String(percent)]);
    if (Number.isFinite(value)) {
      percentilePoints.push([percent, value]);
    }
  }

  if (!percentilePoints.length) {
    return 50;
  }

  if (mesoUsed <= percentilePoints[0][1]) {
    return percentilePoints[0][0];
  }

  for (let index = 1; index < percentilePoints.length; index += 1) {
    const [upperPercent, upperValue] = percentilePoints[index];
    const [lowerPercent, lowerValue] = percentilePoints[index - 1];

    if (mesoUsed > upperValue) {
      continue;
    }

    if (upperValue <= lowerValue) {
      return upperPercent;
    }

    const ratio = (mesoUsed - lowerValue) / (upperValue - lowerValue);
    return lowerPercent + (upperPercent - lowerPercent) * ratio;
  }

  return percentilePoints[percentilePoints.length - 1][0];
}

function roundToOneDecimal(value) {
  return Math.round(Number(value) * 10) / 10;
}
