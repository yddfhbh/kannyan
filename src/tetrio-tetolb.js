import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTetolbLeaderboardImage } from './tetrio-tetolb-renderer.js';

const tetrioApiBaseUrl = 'https://ch.tetr.io/api';
const leaderboardApiPath = '/users/by/league';
const dataDir = resolve(
  process.env.TETRIO_LEAGUE_DATA_DIR?.trim()
    || process.env.DATA_DIR?.trim()
    || fileURLToPath(new URL('../data/', import.meta.url))
);
const cachePath = join(dataDir, 'tetolb-cache.json');
const userCachePath = join(dataDir, 'tetolb-user-cache.json');
const leaderboardCacheMinTtlMs = 10 * 60 * 1000;
const userCacheTtlMs = 24 * 60 * 60 * 1000;
const leaderboardRequestTimeoutMs = 12_000;
const overallTetolbTimeoutMs = 25_000;
const userFetchConcurrency = 5;
const countryAliases = new Map([
  ['한국', 'KR'],
  ['대한민국', 'KR'],
  ['korea', 'KR'],
  ['southkorea', 'KR'],
  ['south-korea', 'KR'],
  ['kr', 'KR'],
  ['일본', 'JP'],
  ['japan', 'JP'],
  ['jp', 'JP'],
  ['미국', 'US'],
  ['usa', 'US'],
  ['us', 'US'],
  ['america', 'US'],
  ['중국', 'CN'],
  ['china', 'CN'],
  ['cn', 'CN'],
  ['대만', 'TW'],
  ['taiwan', 'TW'],
  ['tw', 'TW'],
  ['홍콩', 'HK'],
  ['hongkong', 'HK'],
  ['hk', 'HK'],
  ['캐나다', 'CA'],
  ['canada', 'CA'],
  ['ca', 'CA'],
  ['프랑스', 'FR'],
  ['france', 'FR'],
  ['fr', 'FR'],
  ['독일', 'DE'],
  ['germany', 'DE'],
  ['de', 'DE'],
  ['영국', 'GB'],
  ['uk', 'GB'],
  ['gb', 'GB'],
  ['unitedkingdom', 'GB'],
]);

let leaderboardCacheState = null;
let leaderboardCacheSaveQueue = Promise.resolve();
const pendingLeaderboardRequests = new Map();
let userCacheState = null;
let userCacheSaveQueue = Promise.resolve();
const pendingUserRequests = new Map();

function createEmptyCacheState() {
  return {
    scopes: {},
  };
}

function createEmptyUserCacheState() {
  return {
    users: {},
  };
}

async function loadCacheState() {
  if (leaderboardCacheState) {
    return leaderboardCacheState;
  }

  try {
    leaderboardCacheState = JSON.parse(await fs.readFile(cachePath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }

    leaderboardCacheState = createEmptyCacheState();
  }

  leaderboardCacheState.scopes ??= {};
  return leaderboardCacheState;
}

async function saveCacheState() {
  leaderboardCacheSaveQueue = leaderboardCacheSaveQueue.then(async () => {
    await fs.mkdir(dataDir, { recursive: true });
    const tempPath = `${cachePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(leaderboardCacheState, null, 2), 'utf8');
    await fs.rename(tempPath, cachePath);
  });

  return leaderboardCacheSaveQueue;
}

async function loadUserCacheState() {
  if (userCacheState) {
    return userCacheState;
  }

  try {
    userCacheState = JSON.parse(await fs.readFile(userCachePath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }

    userCacheState = createEmptyUserCacheState();
  }

  userCacheState.users ??= {};
  return userCacheState;
}

async function saveUserCacheState() {
  userCacheSaveQueue = userCacheSaveQueue.then(async () => {
    await fs.mkdir(dataDir, { recursive: true });
    const tempPath = `${userCachePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(userCacheState, null, 2), 'utf8');
    await fs.rename(tempPath, userCachePath);
  });

  return userCacheSaveQueue;
}

function getScopeKey(countryCode) {
  return countryCode ? `country:${countryCode}` : 'global';
}

function entriesNeedProfileEnrichment(entries) {
  return Array.isArray(entries) && entries.some((entry) =>
    entry
    && entry._id
    && (entry.avatar_revision == null || (entry.supporter && entry.banner_revision == null))
  );
}

function normalizeCountryQuery(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '')
    .replace(/[()]/g, '');
}

export function parseTetolbCountryOption(input) {
  const trimmed = String(input ?? '').trim();

  if (!trimmed) {
    return {
      countryCode: null,
      scopeLabel: 'global',
    };
  }

  const normalized = normalizeCountryQuery(trimmed);

  if (countryAliases.has(normalized)) {
    const countryCode = countryAliases.get(normalized);
    return {
      countryCode,
      scopeLabel: countryCode,
    };
  }

  if (/^[a-z]{2}$/i.test(trimmed)) {
    const countryCode = trimmed.toUpperCase();
    return {
      countryCode,
      scopeLabel: countryCode,
    };
  }

  return {
    errorMessage: '국가는 KR, JP, US 같은 2글자 코드나 한국/일본/미국처럼 입력해달라냥.',
  };
}

function computeLeaderboardExpiresAt(responseBody) {
  const defaultExpiresAt = Date.now() + leaderboardCacheMinTtlMs;
  const candidateValue = responseBody?.cache?.cached_until ?? responseBody?.cached_until ?? null;

  if (!candidateValue) {
    return defaultExpiresAt;
  }

  const parsedMs = new Date(candidateValue).getTime();
  if (!Number.isFinite(parsedMs)) {
    return defaultExpiresAt;
  }

  return Math.max(defaultExpiresAt, parsedMs);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = leaderboardRequestTimeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function runWithConcurrencyLimit(items, limit, handler) {
  const queue = Array.from(items ?? []);
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      await handler(item);
    }
  });
  await Promise.all(workers);
}

function normalizeTetolbUserProfile(user) {
  return {
    _id: user?._id ?? null,
    username: user?.username ?? null,
    avatar_revision: user?.avatar_revision ?? null,
    banner_revision: user?.banner_revision ?? null,
    supporter: Boolean(user?.supporter),
    country: user?.country ?? null,
    expiresAt: Date.now() + userCacheTtlMs,
    fetchedAt: Date.now(),
  };
}

function mergeEntryWithUserProfile(entry, userProfile) {
  if (!userProfile) {
    return entry;
  }

  return {
    ...entry,
    _id: userProfile._id ?? entry?._id ?? null,
    username: userProfile.username ?? entry?.username ?? null,
    avatar_revision: userProfile.avatar_revision ?? null,
    banner_revision: userProfile.banner_revision ?? null,
    supporter: userProfile.supporter ?? entry?.supporter ?? false,
    country: userProfile.country ?? entry?.country ?? null,
  };
}

async function fetchTetolbUserProfile(username) {
  const normalizedUsername = String(username ?? '').trim();
  if (!normalizedUsername) {
    return null;
  }

  if (pendingUserRequests.has(normalizedUsername)) {
    return pendingUserRequests.get(normalizedUsername);
  }

  const promise = (async () => {
    const url = `${tetrioApiBaseUrl}/users/${encodeURIComponent(normalizedUsername)}`;
    const response = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'kannyan discord bot; TETR.IO tetolb',
        'X-Session-ID': 'kannyan-tetolb-user',
      },
    });
    const body = await response.json().catch(() => null);

    if (!response.ok || !body?.success || !body?.data) {
      const error = new Error(body?.error?.msg ?? `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return normalizeTetolbUserProfile(body.data);
  })().finally(() => {
    pendingUserRequests.delete(normalizedUsername);
  });

  pendingUserRequests.set(normalizedUsername, promise);
  return promise;
}

async function enrichTetolbEntries(entries) {
  const userCache = await loadUserCacheState();
  const now = Date.now();
  const result = Array.isArray(entries) ? entries.map((entry) => ({ ...entry })) : [];
  const staleEntries = [];

  for (const [index, entry] of result.entries()) {
    const cacheKey = String(entry?.username ?? '').trim();
    const cachedProfile = cacheKey ? userCache.users[cacheKey] : null;

    if (cachedProfile?.expiresAt > now) {
      result[index] = mergeEntryWithUserProfile(entry, cachedProfile);
      continue;
    }

    staleEntries.push({ index, entry, cacheKey });
  }

  if (staleEntries.length === 0) {
    return result;
  }

  let cacheDirty = false;

  await runWithConcurrencyLimit(staleEntries, userFetchConcurrency, async ({ index, entry, cacheKey }) => {
    if (!cacheKey) {
      return;
    }

    try {
      const profile = await fetchTetolbUserProfile(cacheKey);
      if (!profile) {
        return;
      }

      userCache.users[cacheKey] = profile;
      result[index] = mergeEntryWithUserProfile(entry, profile);
      cacheDirty = true;
    } catch (error) {
      console.warn(`[TETOLB] user enrich skipped username=${cacheKey} reason=${error?.message ?? error}`);
    }
  });

  if (cacheDirty) {
    await saveUserCacheState();
  }

  return result;
}

export async function fetchTetolbLeaderboard(countryCode = null) {
  const normalizedCountryCode = countryCode ? String(countryCode).trim().toUpperCase() : null;
  const scopeKey = getScopeKey(normalizedCountryCode);
  const loadedCache = await loadCacheState();
  const cached = loadedCache.scopes[scopeKey];
  const now = Date.now();

  if (cached?.expiresAt && cached.expiresAt > now && Array.isArray(cached.entries)) {
    const entries = entriesNeedProfileEnrichment(cached.entries)
      ? await enrichTetolbEntries(cached.entries)
      : cached.entries;

    if (entries !== cached.entries) {
      loadedCache.scopes[scopeKey].entries = entries;
      await saveCacheState();
    }

    return {
      countryCode: normalizedCountryCode,
      entries,
      fromCache: true,
      expiresAt: cached.expiresAt,
      fetchedAt: cached.fetchedAt ?? null,
    };
  }

  if (pendingLeaderboardRequests.has(scopeKey)) {
    return pendingLeaderboardRequests.get(scopeKey);
  }

  const promise = (async () => {
    const url = new URL(`${tetrioApiBaseUrl}${leaderboardApiPath}`);
    url.searchParams.set('limit', '50');

    if (normalizedCountryCode) {
      url.searchParams.set('country', normalizedCountryCode);
    }

    const response = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'kannyan discord bot; TETR.IO tetolb',
        'X-Session-ID': 'kannyan-tetolb',
      },
    });
    const body = await response.json().catch(() => null);

    if (!response.ok || !body?.success) {
      const error = new Error(body?.error?.msg ?? `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const rawEntries = Array.isArray(body?.data?.entries)
      ? body.data.entries
      : Array.isArray(body?.data?.users)
        ? body.data.users
        : [];
    const entries = await enrichTetolbEntries(rawEntries);
    const expiresAt = computeLeaderboardExpiresAt(body);

    loadedCache.scopes[scopeKey] = {
      countryCode: normalizedCountryCode,
      entries,
      expiresAt,
      fetchedAt: Date.now(),
    };
    await saveCacheState();

    return {
      countryCode: normalizedCountryCode,
      entries,
      fromCache: false,
      expiresAt,
      fetchedAt: loadedCache.scopes[scopeKey].fetchedAt,
    };
  })().finally(() => {
    pendingLeaderboardRequests.delete(scopeKey);
  });

  pendingLeaderboardRequests.set(scopeKey, promise);
  return promise;
}

export function buildTetolbFallbackText(entries, countryCode = null) {
  const title = countryCode
    ? `TETRA LEAGUE ${countryCode} TOP 10`
    : 'TETRA LEAGUE GLOBAL TOP 10';
  const lines = [title];

  for (const [index, entry] of entries.slice(0, 10).entries()) {
    const tr = Number(entry?.league?.tr);
    lines.push(`${index + 1}. ${entry?.username ?? 'UNKNOWN'} - ${Number.isFinite(tr) ? tr.toFixed(2) : '0.00'} TR`);
  }

  return lines.join('\n');
}

export async function createTetolbLeaderboardReplyData(input = '') {
  const parsed = parseTetolbCountryOption(input);

  if (parsed.errorMessage) {
    const error = new Error(parsed.errorMessage);
    error.code = 'INVALID_COUNTRY';
    throw error;
  }

  const { countryCode } = parsed;
  const leaderboard = await fetchTetolbLeaderboard(countryCode);

  if (!Array.isArray(leaderboard.entries) || leaderboard.entries.length === 0) {
    const error = new Error('해당 국가 리더보드에 표시할 유저가 없다냥.');
    error.code = 'NO_ENTRIES';
    throw error;
  }

  try {
    const image = await Promise.race([
      createTetolbLeaderboardImage({
        entries: leaderboard.entries,
        countryCode,
      }),
      new Promise((_, reject) => {
        setTimeout(() => {
          const error = new Error('tetolb render timeout');
          error.code = 'TETOLB_TIMEOUT';
          reject(error);
        }, overallTetolbTimeoutMs);
      }),
    ]);

    return {
      image,
      filename: countryCode
        ? `tetolb-${countryCode.toLowerCase()}.png`
        : 'tetolb-global.png',
      entries: leaderboard.entries,
      countryCode,
    };
  } catch (error) {
    error.entries = leaderboard.entries;
    error.countryCode = countryCode;
    throw error;
  }
}
