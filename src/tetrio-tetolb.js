import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTetolbLeaderboardImage } from './tetrio-tetolb-renderer.js';

const tetrioApiBaseUrl = 'https://ch.tetr.io/api';
const leagueLeaderboardApiPath = '/users/by/league';
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
const userProfileRequestTimeoutMs = 3_500;
const overallTetolbTimeoutMs = 25_000;
const userFetchConcurrency = 8;
const tetolbModeAliases = new Map([
  ['40l', '40l'],
  ['40line', '40l'],
  ['40lines', '40l'],
  ['fortylines', '40l'],
  ['40라인', '40l'],
  ['블리츠', 'blitz'],
  ['blitz', 'blitz'],
]);
const tetolbModeConfig = {
  league: {
    title: 'TETRA LEAGUE',
    filenamePrefix: 'tetolb',
    fallbackValueSuffix: 'TR',
  },
  '40l': {
    title: '40 LINES',
    filenamePrefix: 'tetolb-40l',
    fallbackValueSuffix: 'SEC',
  },
  blitz: {
    title: 'BLITZ',
    filenamePrefix: 'tetolb-blitz',
    fallbackValueSuffix: 'PTS',
  },
};
const countryAliases = new Map([
  ['global', null],
  ['all', null],
  ['world', null],
  ['전체', null],
  ['전세계', null],
  ['글로벌', null],
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

function getTetolbModeConfig(mode = 'league') {
  return tetolbModeConfig[mode] ?? tetolbModeConfig.league;
}

function normalizeTetolbModeToken(value) {
  const normalized = normalizeCountryQuery(value);
  return tetolbModeAliases.get(normalized) ?? null;
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

function getScopeKey(mode, countryCode) {
  return `${mode}:${countryCode ? `country:${countryCode}` : 'global'}`;
}

function entryNeedsProfileEnrichment(entry, mode = 'league') {
  return Boolean(
    entry
    && entry.username
    && (
      entry.avatar_revision == null
      || entry.xp == null
      || (mode === 'league' && entry.league == null)
      || (entry.supporter && entry.banner_revision == null)
    )
  );
}

function entriesNeedProfileEnrichment(entries, mode = 'league') {
  return Array.isArray(entries) && entries.some((entry) => entryNeedsProfileEnrichment(entry, mode));
}

function normalizeCountryQuery(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '')
    .replace(/[()]/g, '');
}

function getUserCacheKey(username) {
  return String(username ?? '').trim().toLowerCase();
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
      scopeLabel: countryCode ?? 'global',
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

function parseTetolbQuery(input = '') {
  const trimmed = String(input ?? '').trim();

  if (!trimmed) {
    return {
      mode: 'league',
      countryCode: null,
    };
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const parsedMode = normalizeTetolbModeToken(tokens[0]);
  const mode = parsedMode ?? 'league';
  const countryInput = parsedMode ? tokens.slice(1).join(' ') : trimmed;
  const parsedCountry = parseTetolbCountryOption(countryInput);

  if (parsedCountry.errorMessage) {
    return {
      mode,
      errorMessage: parsedCountry.errorMessage,
    };
  }

  return {
    mode,
    countryCode: parsedCountry.countryCode,
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

function normalizeTetolbUserProfile(user, summaries = null) {
  return {
    _id: user?._id ?? null,
    username: user?.username ?? null,
    avatar_revision: user?.avatar_revision ?? null,
    banner_revision: user?.banner_revision ?? null,
    supporter: typeof user?.supporter === 'boolean' ? user.supporter : null,
    country: user?.country ?? null,
    xp: Number.isFinite(user?.xp) ? user.xp : null,
    league: summaries?.league && typeof summaries.league === 'object'
      ? {
        ...summaries.league,
      }
      : user?.league && typeof user.league === 'object'
      ? {
        ...user.league,
      }
      : null,
    expiresAt: Date.now() + userCacheTtlMs,
    fetchedAt: Date.now(),
  };
}

function buildTetolbCachedUserProfile(entry) {
  return {
    _id: entry?._id ?? null,
    username: entry?.username ?? null,
    avatar_revision: entry?.avatar_revision ?? null,
    banner_revision: entry?.banner_revision ?? null,
    supporter: typeof entry?.supporter === 'boolean' ? entry.supporter : null,
    country: entry?.country ?? null,
    xp: Number.isFinite(entry?.xp) ? entry.xp : null,
    league: entry?.league && typeof entry.league === 'object'
      ? {
        ...entry.league,
      }
      : null,
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
    avatar_revision: userProfile.avatar_revision ?? entry?.avatar_revision ?? null,
    banner_revision: userProfile.banner_revision ?? entry?.banner_revision ?? null,
    supporter: userProfile.supporter ?? entry?.supporter ?? false,
    country: userProfile.country ?? entry?.country ?? null,
    xp: userProfile.xp ?? entry?.xp ?? null,
    league: userProfile.league ?? entry?.league ?? null,
  };
}

async function fetchTetolbUserProfile(username, options = {}) {
  const normalizedUsername = String(username ?? '').trim();
  const cacheKey = getUserCacheKey(normalizedUsername);
  const includeUserData = options.includeUserData !== false;
  const includeLeagueData = options.includeLeagueData === true;
  if (!cacheKey) {
    return null;
  }

  if (!includeUserData && !includeLeagueData) {
    return null;
  }

  const requestKey = `${cacheKey}:${includeUserData ? 'user' : 'skip-user'}:${includeLeagueData ? 'league' : 'skip-league'}`;

  if (pendingUserRequests.has(requestKey)) {
    return pendingUserRequests.get(requestKey);
  }

  const promise = (async () => {
    const headers = {
      'User-Agent': 'kannyan discord bot; TETR.IO tetolb',
      'X-Session-ID': 'kannyan-tetolb-user',
    };
    const userPromise = includeUserData
      ? (async () => {
        const response = await fetchWithTimeout(
          `${tetrioApiBaseUrl}/users/${encodeURIComponent(normalizedUsername)}`,
          { headers },
          userProfileRequestTimeoutMs
        );
        const body = await response.json().catch(() => null);

        if (!response.ok || !body?.success || !body?.data) {
          const error = new Error(body?.error?.msg ?? `HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }

        return body.data;
      })()
      : Promise.resolve(null);
    const summariesPromise = includeLeagueData
      ? (async () => {
        const response = await fetchWithTimeout(
          `${tetrioApiBaseUrl}/users/${encodeURIComponent(normalizedUsername)}/summaries`,
          { headers },
          userProfileRequestTimeoutMs
        );
        const body = await response.json().catch(() => null);

        if (!response.ok || !body?.success || !body?.data) {
          const error = new Error(body?.error?.msg ?? `HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }

        return body.data;
      })()
      : Promise.resolve(null);
    const [userResult, summariesResult] = await Promise.allSettled([userPromise, summariesPromise]);
    const userData = userResult.status === 'fulfilled' ? userResult.value : null;
    const summariesData = summariesResult.status === 'fulfilled' ? summariesResult.value : null;

    if (!userData && !summariesData) {
      const error = userResult.status === 'rejected'
        ? userResult.reason
        : summariesResult.status === 'rejected'
        ? summariesResult.reason
        : new Error('Failed to fetch TETR.IO user profile');
      throw error;
    }

    return normalizeTetolbUserProfile(
      userData ?? { username: normalizedUsername },
      summariesData
    );
  })().finally(() => {
    pendingUserRequests.delete(requestKey);
  });

  pendingUserRequests.set(requestKey, promise);
  return promise;
}

async function enrichTetolbEntries(entries, mode = 'league') {
  const userCache = await loadUserCacheState();
  const now = Date.now();
  const result = Array.isArray(entries) ? entries.map((entry) => ({ ...entry })) : [];
  const staleEntries = [];

  for (const [index, entry] of result.entries()) {
    if (!entryNeedsProfileEnrichment(entry, mode)) {
      continue;
    }

    const cacheKey = getUserCacheKey(entry?.username);
    const cachedProfile = cacheKey ? userCache.users[cacheKey] : null;

    if (
      cachedProfile?.expiresAt > now
      && cachedProfile.xp != null
      && (mode !== 'league' || cachedProfile.league != null)
    ) {
      result[index] = mergeEntryWithUserProfile(entry, cachedProfile);
      if (!entryNeedsProfileEnrichment(result[index], mode)) {
        continue;
      }
    }

    staleEntries.push({ index, cacheKey });
  }

  if (staleEntries.length === 0) {
    return result;
  }

  let cacheDirty = false;

  await runWithConcurrencyLimit(staleEntries, userFetchConcurrency, async ({ index, cacheKey }) => {
    if (!cacheKey) {
      return;
    }

    try {
      const currentEntry = result[index];
      const profile = await fetchTetolbUserProfile(result[index]?.username, {
        includeUserData:
          currentEntry?.avatar_revision == null
          || currentEntry?.xp == null
          || currentEntry?.country == null
          || (currentEntry?.supporter && currentEntry?.banner_revision == null),
        includeLeagueData: mode === 'league' && currentEntry?.league == null,
      });
      if (!profile) {
        return;
      }

      const mergedEntry = mergeEntryWithUserProfile(currentEntry, profile);
      result[index] = mergedEntry;

      if (mergedEntry.xp != null && mergedEntry.league != null) {
        userCache.users[cacheKey] = buildTetolbCachedUserProfile(mergedEntry);
        cacheDirty = true;
      }
    } catch (error) {
      console.warn(`[TETOLB] user enrich skipped username=${cacheKey} reason=${error?.message ?? error}`);
    }
  });

  if (cacheDirty) {
    await saveUserCacheState();
  }

  return result;
}

function formatTetolb40lValue(finalTimeMs) {
  const ms = Math.round(Number(finalTimeMs));
  if (!Number.isFinite(ms) || ms < 0) {
    return '-';
  }

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const milliseconds = ms % 1000;

  if (minutes > 0) {
    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
  }

  return `${seconds}.${String(milliseconds).padStart(3, '0')}`;
}

function buildTetolbMetricFromRecord(record, mode) {
  if (mode === '40l') {
    return {
      text: formatTetolb40lValue(record?.results?.stats?.finaltime),
      suffix: 'SEC',
    };
  }

  if (mode === 'blitz') {
    const score = Number(record?.results?.stats?.score);
    return {
      text: Number.isFinite(score) ? score.toLocaleString('en-US') : '-',
      suffix: 'PTS',
    };
  }

  return {
    text: '0.00',
    suffix: 'TR',
  };
}

function normalizeTetolbRecordEntry(record, mode) {
  const user = record?.user ?? {};

  return {
    _id: user?.id ?? null,
    username: user?.username ?? null,
    avatar_revision: user?.avatar_revision ?? null,
    banner_revision: user?.banner_revision ?? null,
    supporter: Boolean(user?.supporter),
    country: user?.country ?? null,
    xp: null,
    league: null,
    tetolbMetric: buildTetolbMetricFromRecord(record, mode),
  };
}

async function fetchTetolbLeagueLeaderboard(countryCode = null) {
  const normalizedCountryCode = countryCode ? String(countryCode).trim().toUpperCase() : null;
  const scopeKey = getScopeKey('league', normalizedCountryCode);
  const loadedCache = await loadCacheState();
  const cached = loadedCache.scopes[scopeKey];
  const now = Date.now();

  if (cached?.expiresAt && cached.expiresAt > now && Array.isArray(cached.entries)) {
    const entries = entriesNeedProfileEnrichment(cached.entries, 'league')
      ? await enrichTetolbEntries(cached.entries, 'league')
      : cached.entries;

    if (entries !== cached.entries) {
      loadedCache.scopes[scopeKey].entries = entries;
      await saveCacheState();
    }

    return {
      mode: 'league',
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
    const url = new URL(`${tetrioApiBaseUrl}${leagueLeaderboardApiPath}`);
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
    const entries = await enrichTetolbEntries(rawEntries, 'league');
    const expiresAt = computeLeaderboardExpiresAt(body);

    loadedCache.scopes[scopeKey] = {
      mode: 'league',
      countryCode: normalizedCountryCode,
      entries,
      expiresAt,
      fetchedAt: Date.now(),
    };
    await saveCacheState();

    return {
      mode: 'league',
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

async function fetchTetolbRecordLeaderboard(mode, countryCode = null) {
  const normalizedCountryCode = countryCode ? String(countryCode).trim().toUpperCase() : null;
  const scopeKey = getScopeKey(mode, normalizedCountryCode);
  const loadedCache = await loadCacheState();
  const cached = loadedCache.scopes[scopeKey];
  const now = Date.now();

  if (
    cached?.expiresAt
    && cached.expiresAt > now
    && Array.isArray(cached.entries)
    && (cached.entries.length >= 50 || cached.complete === true)
  ) {
    const entries = entriesNeedProfileEnrichment(cached.entries, mode)
      ? await enrichTetolbEntries(cached.entries, mode)
      : cached.entries;

    if (entries !== cached.entries) {
      loadedCache.scopes[scopeKey].entries = entries;
      await saveCacheState();
    }

    return {
      mode,
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
    const scope = normalizedCountryCode ? `country_${normalizedCountryCode}` : 'global';
    const entries = [];
    let expiresAt = Date.now() + leaderboardCacheMinTtlMs;
    let fetchedAt = Date.now();
    let after = null;
    let complete = false;

    while (entries.length < 50 && !complete) {
      const url = new URL(`${tetrioApiBaseUrl}/records/${mode}_${scope}`);
      url.searchParams.set('limit', '50');
      if (after) {
        url.searchParams.set('after', after);
      }

      const response = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': 'kannyan discord bot; TETR.IO tetolb',
          'X-Session-ID': `kannyan-tetolb-${mode}`,
        },
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        const error = new Error(body?.error?.msg ?? `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }

      expiresAt = Math.max(expiresAt, computeLeaderboardExpiresAt(body));
      const rawBatch = Array.isArray(body?.data?.records)
        ? body.data.records
        : Array.isArray(body?.data?.entries)
          ? body.data.entries
          : [];

      if (rawBatch.length === 0) {
        complete = true;
        break;
      }

      entries.push(...rawBatch.map((record) => normalizeTetolbRecordEntry(record, mode)));

      if (entries.length >= 50) {
        entries.length = 50;
        complete = true;
        break;
      }

      const lastEntry = rawBatch.at(-1);
      if (rawBatch.length < 50 || !lastEntry?.p) {
        complete = true;
        break;
      }

      const nextAfter = `${lastEntry.p.pri}:${lastEntry.p.sec}:${lastEntry.p.ter}`;
      if (!nextAfter || nextAfter === after) {
        complete = true;
        break;
      }

      after = nextAfter;
    }
    const enrichedEntries = await enrichTetolbEntries(entries, mode);

    loadedCache.scopes[scopeKey] = {
      mode,
      countryCode: normalizedCountryCode,
      entries: enrichedEntries,
      complete,
      expiresAt,
      fetchedAt,
    };
    await saveCacheState();

    return {
      mode,
      countryCode: normalizedCountryCode,
      entries: enrichedEntries,
      fromCache: false,
      expiresAt,
      fetchedAt,
    };
  })().finally(() => {
    pendingLeaderboardRequests.delete(scopeKey);
  });

  pendingLeaderboardRequests.set(scopeKey, promise);
  return promise;
}

export async function fetchTetolbLeaderboard(mode = 'league', countryCode = null) {
  if (mode === '40l' || mode === 'blitz') {
    return fetchTetolbRecordLeaderboard(mode, countryCode);
  }

  return fetchTetolbLeagueLeaderboard(countryCode);
}

function getTetolbFallbackValue(entry, mode) {
  if (mode === '40l' || mode === 'blitz') {
    return entry?.tetolbMetric?.text ?? '-';
  }

  const tr = Number(entry?.league?.tr);
  return Number.isFinite(tr) ? tr.toFixed(2) : '0.00';
}

export function buildTetolbFallbackText(entries, countryCode = null, mode = 'league') {
  const config = getTetolbModeConfig(mode);
  const title = countryCode
    ? `${config.title} ${countryCode} TOP 10`
    : `${config.title} GLOBAL TOP 10`;
  const lines = [title];

  for (const [index, entry] of entries.slice(0, 10).entries()) {
    lines.push(
      `${index + 1}. ${entry?.username ?? 'UNKNOWN'} - ${getTetolbFallbackValue(entry, mode)} ${config.fallbackValueSuffix}`
    );
  }

  return lines.join('\n');
}

function buildTetolbFilename(mode, countryCode) {
  const config = getTetolbModeConfig(mode);
  if (countryCode) {
    return `${config.filenamePrefix}-${countryCode.toLowerCase()}.png`;
  }

  return `${config.filenamePrefix}-global.png`;
}

export async function createTetolbLeaderboardReplyData(input = '') {
  const parsed = parseTetolbQuery(input);

  if (parsed.errorMessage) {
    const error = new Error(parsed.errorMessage);
    error.code = 'INVALID_COUNTRY';
    error.mode = parsed.mode;
    throw error;
  }

  const { mode, countryCode } = parsed;
  const leaderboard = await fetchTetolbLeaderboard(mode, countryCode);

  if (!Array.isArray(leaderboard.entries) || leaderboard.entries.length === 0) {
    const error = new Error('해당 국가 리더보드에 표시할 유저가 없다냥.');
    error.code = 'NO_ENTRIES';
    error.mode = mode;
    throw error;
  }

  try {
    const image = await Promise.race([
      createTetolbLeaderboardImage({
        entries: leaderboard.entries,
        countryCode,
        mode,
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
      filename: buildTetolbFilename(mode, countryCode),
      entries: leaderboard.entries,
      countryCode,
      mode,
    };
  } catch (error) {
    error.entries = leaderboard.entries;
    error.countryCode = countryCode;
    error.mode = mode;
    throw error;
  }
}
