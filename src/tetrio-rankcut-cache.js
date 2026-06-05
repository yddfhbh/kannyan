const tetrioApiBaseUrl = 'https://ch.tetr.io/api';
const tetrioHeaders = {
  'User-Agent': 'discord-bot/1.0 TETR.IO rank cut cache',
  'X-Session-ID': 'discord-bot-tetrio-rankcut-cache',
};
const rankCutRefreshDelayMs = 5000;
const halfHourMs = 30 * 60 * 1000;

let cachedRankCutResponse = null;
let cachedRankCutExpiresAt = 0;
let rankCutDataPromise = null;

export async function fetchCachedTetrioRankCutData() {
  const now = Date.now();
  if (cachedRankCutResponse && cachedRankCutExpiresAt > now) {
    return cachedRankCutResponse;
  }

  if (rankCutDataPromise) {
    return rankCutDataPromise;
  }

  rankCutDataPromise = fetchTetrioRankCutData()
    .then((response) => {
      cachedRankCutResponse = response;
      cachedRankCutExpiresAt = getUsableRankCutExpiryTime(response.data?.t);
      return response;
    })
    .finally(() => {
      rankCutDataPromise = null;
    });

  return rankCutDataPromise;
}

export function getCachedTetrioRankCutDataExpiresAt() {
  return cachedRankCutResponse ? cachedRankCutExpiresAt : 0;
}

export function getNextRankCutExpiryTime(value = Date.now()) {
  const baseTime = normalizeRankCutExpiryBaseTime(value);
  const nextHalfHour = Math.floor(baseTime / halfHourMs) * halfHourMs + halfHourMs;

  return nextHalfHour + rankCutRefreshDelayMs;
}

function getUsableRankCutExpiryTime(value) {
  const expiryTime = getNextRankCutExpiryTime(value);
  return expiryTime > Date.now()
    ? expiryTime
    : Date.now() + rankCutRefreshDelayMs;
}

function normalizeRankCutExpiryBaseTime(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : Date.now();
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : Date.now();
  }

  const timestamp = new Date(value);
  const time = timestamp.getTime();
  return Number.isFinite(time) ? time : Date.now();
}

async function fetchTetrioRankCutData() {
  const response = await fetch(`${tetrioApiBaseUrl}/labs/league_ranks`, {
    headers: tetrioHeaders,
  });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    const error = new Error(body?.error?.msg ?? `TETR.IO API responded with ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return body;
}
