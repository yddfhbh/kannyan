import { EmbedBuilder } from 'discord.js';

const vArchiveSongsUrl = 'https://v-archive.net/db/v2/songs.json';
const ropheTagsUrl = 'https://data.xn--2o2bk9ff9x.com/tags/new_tags.json';
const vArchiveSongPageBaseUrl = 'https://v-archive.net/db/title';
const cacheTtlMs = 6 * 60 * 60 * 1000;
const retryBackoffMs = 5 * 60 * 1000;
const requestTimeoutMs = 15_000;
const candidateLimit = 10;
const embedColor = 0x5a86d6;
const keyOrder = ['4B', '5B', '6B', '8B'];
const difficultyOrder = ['NM', 'HD', 'MX', 'SC'];
const searchStopWords = new Set(['the', 'a', 'an']);
const searchWeakWords = new Set(['of']);

const vArchiveSongCache = {
  songs: null,
  expiresAt: 0,
  nextRefreshAllowedAt: 0,
  pendingPromise: null,
};

const ropheTagCache = {
  tags: null,
  tagsByTitleId: null,
  expiresAt: 0,
  nextRefreshAllowedAt: 0,
  pendingPromise: null,
};

const vArchiveSearchIndexCache = {
  searchEntries: null,
  songsByTitleId: null,
  aliasTitleIdsByKey: null,
  sourceSongs: null,
  sourceRopheTags: null,
};

const dlcLabels = {
  R: 'RESPECT',
  RV: 'RESPECT V',
  TR: 'TRILOGY',
  CE: 'CLAZZIQUAI EDITION',
  BS: 'BLACK SQUARE',
  T1: 'TECHNIKA 1',
  T2: 'TECHNIKA 2',
  T3: 'TECHNIKA 3',
  P1: 'PORTABLE 1',
  P2: 'PORTABLE 2',
  P3: 'PORTABLE 3',
  VE: 'V EXTENSION',
  VE2: 'V EXTENSION 2',
  VE3: 'V EXTENSION 3',
  VE4: 'V EXTENSION 4',
  VE5: 'V EXTENSION 5',
  VL: 'V LIBERTY',
  VL2: 'V LIBERTY 2',
  VL3: 'V LIBERTY 3',
  VL4: 'V LIBERTY 4',
  VL5: 'V LIBERTY 5',
};

export async function fetchVArchiveSongs(options = {}) {
  const now = Date.now();
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh && Array.isArray(vArchiveSongCache.songs)) {
    if (vArchiveSongCache.expiresAt > now || vArchiveSongCache.nextRefreshAllowedAt > now) {
      return vArchiveSongCache.songs;
    }
  }

  if (vArchiveSongCache.pendingPromise) {
    return vArchiveSongCache.pendingPromise;
  }

  const fetchImpl = resolveFetch(options.fetchImpl);
  vArchiveSongCache.pendingPromise = refreshJsonArrayCache({
    cache: vArchiveSongCache,
    url: vArchiveSongsUrl,
    fetchImpl,
    cacheName: 'V-ARCHIVE songs',
    emptyFallback: null,
  }).finally(() => {
    vArchiveSongCache.pendingPromise = null;
  });

  return vArchiveSongCache.pendingPromise;
}

export async function fetchRopheTags(options = {}) {
  const now = Date.now();
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh && Array.isArray(ropheTagCache.tags)) {
    if (ropheTagCache.expiresAt > now || ropheTagCache.nextRefreshAllowedAt > now) {
      return ropheTagCache.tags;
    }
  }

  if (ropheTagCache.pendingPromise) {
    return ropheTagCache.pendingPromise;
  }

  const fetchImpl = resolveFetch(options.fetchImpl);
  ropheTagCache.pendingPromise = refreshRopheTags(fetchImpl)
    .finally(() => {
      ropheTagCache.pendingPromise = null;
    });

  return ropheTagCache.pendingPromise;
}

export async function searchVArchiveSong(query, options = {}) {
  const trimmedQuery = String(query ?? '').trim();
  const queryMeta = buildSongQueryMeta(trimmedQuery);

  if (!queryMeta.normalizedName) {
    const error = new Error('곡명을 입력해달라냥.');
    error.code = 'INVALID_VARCHIVE_SONG_QUERY';
    throw error;
  }

  await ensureVArchiveSongSearchIndex(options);
  const searchEntries = Array.isArray(vArchiveSearchIndexCache.searchEntries)
    ? vArchiveSearchIndexCache.searchEntries
    : [];
  const songsByTitleId = vArchiveSearchIndexCache.songsByTitleId ?? new Map();
  const aliasTitleIdsByKey = vArchiveSearchIndexCache.aliasTitleIdsByKey ?? new Map();
  const tieredMatches = [
    resolveTitleIdMatches(queryMeta, songsByTitleId),
    collectTierMatches(searchEntries, (entry) =>
      entry.nameExactKey === queryMeta.normalizedName
        ? 1_000
        : null
    ),
    resolveAliasMatches(queryMeta, aliasTitleIdsByKey, songsByTitleId),
    collectTierMatches(searchEntries, (entry) =>
      scoreStartsWith(entry.searchKeys, queryMeta.searchKeys, 820)
    ),
    collectTierMatches(searchEntries, (entry) =>
      scoreIncludes(entry.searchKeys, queryMeta.searchKeys, 720)
    ),
    collectTierMatches(searchEntries, (entry) =>
      scoreTokenCoverage(entry, queryMeta)
    ),
    collectTierMatches(searchEntries, (entry) =>
      scoreFuzzyCandidate(entry, queryMeta)
    ),
  ];
  const matches = tieredMatches.find((entries) => entries.length > 0) ?? [];

  if (matches.length === 0) {
    return {
      status: 'none',
      query: trimmedQuery,
      normalizedQuery: queryMeta.normalizedName,
      songs: [],
      totalMatches: 0,
    };
  }

  if (matches.length === 1) {
    return {
      status: 'single',
      query: trimmedQuery,
      normalizedQuery: queryMeta.normalizedName,
      song: matches[0].song,
      songs: [matches[0].song],
      totalMatches: 1,
    };
  }

  return {
    status: 'multiple',
    query: trimmedQuery,
    normalizedQuery: queryMeta.normalizedName,
    songs: matches.slice(0, candidateLimit).map((entry) => entry.song),
    totalMatches: matches.length,
  };
}

export function buildVArchiveSongEmbed(song) {
  const titleId = getSongTitleId(song);
  const pageUrl = buildVArchiveSongPageUrl(song);
  const composer = formatSongComposer(song);
  const dlcLabel = formatVArchiveSongDlc(song);

  return new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(String(song?.name ?? '알 수 없는 곡'))
    .setURL(pageUrl)
    .setDescription([
      `${composer} · ${dlcLabel}`,
      '',
      buildSongDifficultyText(song),
    ].join('\n'))
    .setFooter({
      text: `V-ARCHIVE title ID: ${titleId}`,
    });
}

export function buildSongDifficultyText(song) {
  const rows = keyOrder.map((key) => [
    key,
    ...difficultyOrder.map((difficulty) =>
      formatSongDifficultyCell(song?.patterns?.[key]?.[difficulty])
    ),
  ]);
  const columnWidths = [
    Math.max('KEY'.length, ...rows.map((row) => row[0].length)),
    ...difficultyOrder.map((difficulty, index) =>
      Math.max(
        8,
        difficulty.length,
        ...rows.map((row) => row[index + 1].length)
      )
    ),
  ];
  const header = ['KEY', ...difficultyOrder]
    .map((value, index) => value.padEnd(columnWidths[index], ' '))
    .join('  ')
    .trimEnd();
  const body = rows
    .map((row) => row.map((value, index) => value.padEnd(columnWidths[index], ' ')).join('  ').trimEnd())
    .join('\n');

  return `\`\`\`txt\n${header}\n${body}\n\`\`\``;
}

export function normalizeSongName(text) {
  return tokenizeNormalizedText(text).join('');
}

export function buildVArchiveSongSearchResultsEmbed(query, songs, totalMatches = songs?.length ?? 0) {
  const safeSongs = Array.isArray(songs) ? songs : [];
  const descriptionLines = safeSongs.map((song, index) =>
    `${index + 1}. ${formatVArchiveSongCandidate(song)}`
  );
  const footerText = totalMatches > safeSongs.length
    ? `총 ${totalMatches}개 중 상위 ${safeSongs.length}개`
    : `총 ${safeSongs.length}개`;

  return new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`서열표 검색 결과: ${String(query ?? '').trim() || '-'}`)
    .setDescription(descriptionLines.join('\n'))
    .setFooter({
      text: footerText,
    });
}

export function buildVArchiveSongPageUrl(song) {
  return `${vArchiveSongPageBaseUrl}/${encodeURIComponent(getSongTitleId(song))}`;
}

export function formatVArchiveSongDlc(song) {
  const code = String(song?.dlcCode ?? '').trim();
  if (!code) {
    return 'DLC 미상';
  }

  return dlcLabels[code] ?? code;
}

async function ensureVArchiveSongSearchIndex(options = {}) {
  const [songs, ropheTags] = await Promise.all([
    fetchVArchiveSongs(options),
    fetchRopheTags(options),
  ]);

  if (
    vArchiveSearchIndexCache.sourceSongs === songs
    && vArchiveSearchIndexCache.sourceRopheTags === ropheTags
    && Array.isArray(vArchiveSearchIndexCache.searchEntries)
  ) {
    return;
  }

  const songsByTitleId = new Map(
    (Array.isArray(songs) ? songs : []).map((song) => [getSongTitleId(song), song])
  );
  const ropheTagsByTitleId = ropheTagCache.tagsByTitleId ?? buildRopheTagsByTitleId(ropheTags);
  const searchEntries = (Array.isArray(songs) ? songs : [])
    .map((song) => buildSongSearchEntry(song, ropheTagsByTitleId.get(getSongTitleId(song))))
    .filter(Boolean);

  vArchiveSearchIndexCache.searchEntries = searchEntries;
  vArchiveSearchIndexCache.songsByTitleId = songsByTitleId;
  vArchiveSearchIndexCache.aliasTitleIdsByKey = buildAliasTitleIdsByKey(searchEntries);
  vArchiveSearchIndexCache.sourceSongs = songs;
  vArchiveSearchIndexCache.sourceRopheTags = ropheTags;
}

async function refreshJsonArrayCache({ cache, url, fetchImpl, cacheName, emptyFallback }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      const error = new Error(`Failed to fetch ${cacheName}: ${response.status}`);
      error.code = 'VARCHIVE_SONG_FETCH_FAILED';
      error.status = response.status;
      throw error;
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      const error = new Error(`Unexpected ${cacheName} payload.`);
      error.code = 'VARCHIVE_SONG_FETCH_FAILED';
      throw error;
    }

    cache.songs = payload;
    cache.expiresAt = Date.now() + cacheTtlMs;
    cache.nextRefreshAllowedAt = 0;
    return cache.songs;
  } catch (error) {
    if (error?.name === 'AbortError') {
      error = Object.assign(new Error(`${cacheName} request timed out.`), {
        code: 'VARCHIVE_SONG_TIMEOUT',
      });
    }

    if (Array.isArray(cache.songs)) {
      cache.nextRefreshAllowedAt = Date.now() + retryBackoffMs;
      console.warn(`Failed to refresh ${cacheName} cache, using stale cache instead:`);
      console.warn(error);
      return cache.songs;
    }

    if (emptyFallback !== null) {
      console.warn(`Failed to fetch ${cacheName}, using empty fallback instead:`);
      console.warn(error);
      cache.songs = emptyFallback;
      cache.expiresAt = 0;
      cache.nextRefreshAllowedAt = Date.now() + retryBackoffMs;
      return cache.songs;
    }

    if (!error.code) {
      error.code = 'VARCHIVE_SONG_FETCH_FAILED';
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshRopheTags(fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetchImpl(ropheTagsUrl, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      const error = new Error(`Failed to fetch Rophe tags: ${response.status}`);
      error.code = 'ROPHE_TAG_FETCH_FAILED';
      error.status = response.status;
      throw error;
    }

    const payload = await response.json();
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.items)
        ? payload.items
        : [];

    ropheTagCache.tags = items;
    ropheTagCache.tagsByTitleId = buildRopheTagsByTitleId(items);
    ropheTagCache.expiresAt = Date.now() + cacheTtlMs;
    ropheTagCache.nextRefreshAllowedAt = 0;
    return ropheTagCache.tags;
  } catch (error) {
    if (error?.name === 'AbortError') {
      error = Object.assign(new Error('Rophe tags request timed out.'), {
        code: 'ROPHE_TAG_TIMEOUT',
      });
    }

    if (Array.isArray(ropheTagCache.tags)) {
      ropheTagCache.nextRefreshAllowedAt = Date.now() + retryBackoffMs;
      console.warn('Failed to refresh Rophe tags cache, using stale cache instead:');
      console.warn(error);
      return ropheTagCache.tags;
    }

    console.warn('Failed to fetch Rophe tags, using empty fallback instead:');
    console.warn(error);
    ropheTagCache.tags = [];
    ropheTagCache.tagsByTitleId = new Map();
    ropheTagCache.expiresAt = 0;
    ropheTagCache.nextRefreshAllowedAt = Date.now() + retryBackoffMs;
    return ropheTagCache.tags;
  } finally {
    clearTimeout(timeout);
  }
}

function buildRopheTagsByTitleId(tags) {
  const entries = new Map();

  for (const item of Array.isArray(tags) ? tags : []) {
    const titleId = normalizeTitleId(item?.song_title);
    if (!titleId) {
      continue;
    }

    entries.set(titleId, item);
  }

  return entries;
}

function buildSongSearchEntry(song, rophe = null) {
  const titleId = getSongTitleId(song);
  const songName = String(song?.name ?? '').trim();
  const composer = formatSongComposer(song);
  const dlcCode = String(song?.dlcCode ?? '').trim();
  const ropheTags = getStringArray(rophe?.tags);
  const ropheAka = getStringArray(rophe?.aka);
  const ropheGenres = getStringArray(rophe?.genres);
  const ropheBpmText = String(rophe?.bpm?.text ?? '').trim();
  const rophePatternTagNames = collectRophePatternTagNames(rophe?.pattern_tags);
  const aliasKeys = getUniqueNormalizedKeys([...ropheTags, ...ropheAka]);
  const searchMeta = buildSearchMeta([
    songName,
    composer,
    dlcCode,
    formatVArchiveSongDlc(song),
    ...ropheTags,
    ...ropheAka,
    ...ropheGenres,
    ropheBpmText,
    ...rophePatternTagNames,
  ]);

  return {
    song,
    titleId,
    rophe,
    nameExactKey: normalizeSongName(songName),
    aliasKeys,
    searchKeys: searchMeta.searchKeys,
    primarySearchKey: searchMeta.primarySearchKey,
    tokenSet: searchMeta.tokenSet,
  };
}

function buildSongQueryMeta(query) {
  const searchMeta = buildSearchMeta([query]);
  const queryTokens = tokenizeNormalizedText(query);
  const tokensWithoutStopWords = removeStopWords(queryTokens);
  const tokensWithoutWeakWords = removeWeakWords(tokensWithoutStopWords);

  return {
    normalizedName: normalizeSongName(query),
    searchKeys: searchMeta.searchKeys,
    primarySearchKey: searchMeta.primarySearchKey,
    tokens: queryTokens,
    coreTokens: tokensWithoutWeakWords.length > 0
      ? tokensWithoutWeakWords
      : tokensWithoutStopWords.length > 0
        ? tokensWithoutStopWords
        : queryTokens,
    titleId: normalizeTitleId(query),
  };
}

function buildSearchMeta(values) {
  const texts = [];
  const normalizedFieldKeys = [];
  const tokenSet = new Set();

  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text) {
      continue;
    }

    texts.push(text);

    const normalizedKey = normalizeSongName(text);
    if (normalizedKey) {
      normalizedFieldKeys.push(normalizedKey);
    }

    for (const token of tokenizeNormalizedText(text)) {
      tokenSet.add(token);
    }
  }

  const allTokens = [...tokenSet];
  const tokensWithoutStopWords = removeStopWords(allTokens);
  const tokensWithoutWeakWords = removeWeakWords(tokensWithoutStopWords);
  const combinedKey = normalizeSongName(texts.join(' '));
  const searchKeys = getUniqueSearchKeys([
    ...normalizedFieldKeys,
    combinedKey,
    tokensWithoutStopWords.join(''),
    tokensWithoutWeakWords.join(''),
    ...allTokens,
    ...tokensWithoutStopWords,
    ...tokensWithoutWeakWords,
  ]);

  return {
    searchKeys,
    primarySearchKey: searchKeys[0] ?? combinedKey,
    tokenSet,
  };
}

function tokenizeNormalizedText(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/&/g, ' and ')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function getUniqueSearchKeys(values) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

function getUniqueNormalizedKeys(values) {
  return getUniqueSearchKeys(values.map((value) => normalizeSongName(value)));
}

function getStringArray(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

function collectRophePatternTagNames(patternTags) {
  const names = [];

  for (const entries of Object.values(patternTags ?? {})) {
    for (const tag of Array.isArray(entries) ? entries : []) {
      const name = String(tag?.name ?? '').trim();
      if (name) {
        names.push(name);
      }
    }
  }

  return [...new Set(names)];
}

function buildAliasTitleIdsByKey(searchEntries) {
  const aliasEntries = new Map();

  for (const entry of Array.isArray(searchEntries) ? searchEntries : []) {
    for (const aliasKey of entry.aliasKeys) {
      aliasEntries.set(aliasKey, [
        ...new Set([
          ...(aliasEntries.get(aliasKey) ?? []),
          entry.titleId,
        ]),
      ]);
    }
  }

  return aliasEntries;
}

function resolveTitleIdMatches(queryMeta, songsByTitleId) {
  if (!queryMeta.titleId) {
    return [];
  }

  const song = songsByTitleId.get(queryMeta.titleId);
  return song ? [{ song, score: Number.POSITIVE_INFINITY }] : [];
}

function resolveAliasMatches(queryMeta, aliasTitleIdsByKey, songsByTitleId) {
  const titleIds = aliasTitleIdsByKey.get(queryMeta.normalizedName);
  if (!Array.isArray(titleIds) || titleIds.length === 0) {
    return [];
  }

  return titleIds
    .map((titleId) => songsByTitleId.get(titleId))
    .filter(Boolean)
    .map((song, index) => ({
      song,
      score: Number.POSITIVE_INFINITY - index - 1,
    }));
}

function collectTierMatches(searchEntries, scoreResolver) {
  const results = [];
  const seen = new Set();

  for (const entry of searchEntries) {
    const score = scoreResolver(entry);
    if (!Number.isFinite(score)) {
      continue;
    }

    if (seen.has(entry.titleId)) {
      continue;
    }

    seen.add(entry.titleId);
    results.push({
      song: entry.song,
      score,
    });
  }

  return results.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return formatVArchiveSongCandidate(left.song).localeCompare(formatVArchiveSongCandidate(right.song), 'en');
  });
}

function scoreStartsWith(entryKeys, queryKeys, baseScore) {
  let bestScore = null;

  for (const queryKey of queryKeys) {
    if (!queryKey) {
      continue;
    }

    for (const entryKey of entryKeys) {
      if (!entryKey.startsWith(queryKey)) {
        continue;
      }

      const score = baseScore - (entryKey.length - queryKey.length);
      bestScore = bestScore === null ? score : Math.max(bestScore, score);
    }
  }

  return bestScore;
}

function scoreIncludes(entryKeys, queryKeys, baseScore) {
  let bestScore = null;

  for (const queryKey of queryKeys) {
    if (!queryKey) {
      continue;
    }

    for (const entryKey of entryKeys) {
      const index = entryKey.indexOf(queryKey);
      if (index === -1) {
        continue;
      }

      const score = baseScore - index * 2 - (entryKey.length - queryKey.length);
      bestScore = bestScore === null ? score : Math.max(bestScore, score);
    }
  }

  return bestScore;
}

function scoreTokenCoverage(entry, queryMeta) {
  const tokens = queryMeta.coreTokens;
  if (tokens.length === 0) {
    return null;
  }

  let score = 0;

  for (const token of tokens) {
    const tokenScore = scoreTokenAgainstEntry(token, entry);
    if (!Number.isFinite(tokenScore)) {
      return null;
    }

    score += tokenScore;
  }

  return 520 + score;
}

function scoreTokenAgainstEntry(token, entry) {
  if (entry.tokenSet.has(token)) {
    return 40;
  }

  let bestScore = null;

  for (const key of entry.searchKeys) {
    if (key.startsWith(token)) {
      bestScore = Math.max(bestScore ?? -Infinity, 30 - (key.length - token.length));
      continue;
    }

    if (key.includes(token)) {
      bestScore = Math.max(bestScore ?? -Infinity, 20 - Math.max(0, key.indexOf(token)));
    }
  }

  return bestScore;
}

function scoreFuzzyCandidate(entry, queryMeta) {
  const queryKey = queryMeta.primarySearchKey;
  if (!queryKey) {
    return null;
  }

  let bestSimilarity = 0;
  for (const entryKey of entry.searchKeys) {
    bestSimilarity = Math.max(bestSimilarity, computeDiceCoefficient(queryKey, entryKey));
  }

  const tokenHits = queryMeta.coreTokens.filter((token) => scoreTokenAgainstEntry(token, entry) !== null).length;
  const minimumTokenHits = queryMeta.coreTokens.length >= 2 ? 2 : 1;

  if (tokenHits < minimumTokenHits && bestSimilarity < 0.55) {
    return null;
  }

  const score = Math.round(bestSimilarity * 100) + tokenHits * 18;
  return score >= 48 ? score : null;
}

function computeDiceCoefficient(left, right) {
  const leftBigrams = buildBigrams(left);
  const rightBigrams = buildBigrams(right);

  if (leftBigrams.length === 0 || rightBigrams.length === 0) {
    return left === right ? 1 : 0;
  }

  const rightCounts = new Map();
  for (const bigram of rightBigrams) {
    rightCounts.set(bigram, (rightCounts.get(bigram) ?? 0) + 1);
  }

  let overlap = 0;
  for (const bigram of leftBigrams) {
    const count = rightCounts.get(bigram) ?? 0;
    if (count <= 0) {
      continue;
    }

    overlap += 1;
    rightCounts.set(bigram, count - 1);
  }

  return (2 * overlap) / (leftBigrams.length + rightBigrams.length);
}

function buildBigrams(value) {
  const text = String(value ?? '').trim();
  if (text.length < 2) {
    return text ? [text] : [];
  }

  return Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2));
}

function removeStopWords(words) {
  return words.filter((word) => !searchStopWords.has(word));
}

function removeWeakWords(words) {
  return words.filter((word) => !searchWeakWords.has(word));
}

function formatVArchiveSongCandidate(song) {
  return [
    String(song?.name ?? '알 수 없는 곡'),
    formatSongComposer(song),
    formatVArchiveSongDlc(song),
    `ID ${getSongTitleId(song)}`,
  ].join(' / ');
}

function formatSongDifficultyCell(pattern) {
  const level = Number(pattern?.level);
  if (!Number.isFinite(level)) {
    return '-';
  }

  const floorName = String(pattern?.floorName ?? '').trim();
  if (!floorName) {
    return String(level);
  }

  return `${level} ${floorName}F`;
}

function formatSongComposer(song) {
  const composer = String(song?.composer ?? '').trim();
  return composer || '작곡가 미상';
}

function normalizeTitleId(value) {
  return /^\d+$/.test(String(value ?? '').trim())
    ? String(Number(value))
    : null;
}

function getSongTitleId(song) {
  return normalizeTitleId(song?.title) ?? String(song?.title ?? '-');
}

function resolveFetch(fetchImpl) {
  const targetFetch = fetchImpl ?? globalThis.fetch;
  if (typeof targetFetch !== 'function') {
    throw new Error('현재 실행 환경에서 fetch를 사용할 수 없다냥.');
  }

  return targetFetch;
}
