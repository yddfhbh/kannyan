import { EmbedBuilder } from 'discord.js';

const vArchiveSongsUrl = 'https://v-archive.net/db/v2/songs.json';
const vArchiveSongPageBaseUrl = 'https://v-archive.net/db/title';
const vArchiveSongCacheTtlMs = 6 * 60 * 60 * 1000;
const vArchiveSongRetryBackoffMs = 5 * 60 * 1000;
const vArchiveSongRequestTimeoutMs = 15_000;
const vArchiveSongCandidateLimit = 10;
const vArchiveSongEmbedColor = 0x5a86d6;
const vArchiveKeyOrder = ['4B', '5B', '6B', '8B'];
const vArchiveDifficultyOrder = ['NM', 'HD', 'MX', 'SC'];
const vArchiveSongSearchStopWords = new Set(['the', 'a', 'an']);
const vArchiveSongSearchWeakWords = new Set(['of']);
const vArchiveSongAliasTitleIds = {
  다이인: [553],
  디인: [553],
};

const vArchiveSongCache = {
  songs: null,
  searchEntries: null,
  songsByTitleId: null,
  aliasTitleIdsByKey: null,
  expiresAt: 0,
  nextRefreshAllowedAt: 0,
  pendingPromise: null,
};

const vArchiveDlcLabels = {
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
    if (vArchiveSongCache.expiresAt > now) {
      return vArchiveSongCache.songs;
    }

    if (vArchiveSongCache.nextRefreshAllowedAt > now) {
      return vArchiveSongCache.songs;
    }
  }

  if (vArchiveSongCache.pendingPromise) {
    return vArchiveSongCache.pendingPromise;
  }

  const fetchImpl = resolveFetch(options.fetchImpl);
  vArchiveSongCache.pendingPromise = refreshVArchiveSongs(fetchImpl)
    .finally(() => {
      vArchiveSongCache.pendingPromise = null;
    });

  return vArchiveSongCache.pendingPromise;
}

export async function searchVArchiveSong(query, options = {}) {
  const trimmedQuery = String(query ?? '').trim();
  const queryMeta = buildSongQueryMeta(trimmedQuery);
  const normalizedQuery = queryMeta.normalizedName;

  if (!normalizedQuery) {
    const error = new Error('곡명을 입력해달라냥.');
    error.code = 'INVALID_VARCHIVE_SONG_QUERY';
    throw error;
  }

  await fetchVArchiveSongs(options);
  const searchEntries = Array.isArray(vArchiveSongCache.searchEntries)
    ? vArchiveSongCache.searchEntries
    : [];
  const songsByTitleId = vArchiveSongCache.songsByTitleId ?? new Map();
  const aliasTitleIdsByKey = vArchiveSongCache.aliasTitleIdsByKey ?? new Map();
  const tieredMatches = [
    resolveTitleIdMatches(queryMeta, songsByTitleId),
    resolveAliasMatches(queryMeta, aliasTitleIdsByKey, songsByTitleId),
    collectTierMatches(searchEntries, (entry) =>
      entry.normalizedName === queryMeta.normalizedName
        ? 1_000
        : null
    ),
    collectTierMatches(searchEntries, (entry) =>
      entry.searchKeys.some((key) => queryMeta.searchKeys.includes(key))
        ? 900 - scoreSearchKeyExact(entry, queryMeta)
        : null
    ),
    collectTierMatches(searchEntries, (entry) =>
      scoreSearchKeyPrefix(entry, queryMeta)
    ),
    collectTierMatches(searchEntries, (entry) =>
      scoreSearchKeyIncludes(entry, queryMeta)
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
      normalizedQuery,
      songs: [],
      totalMatches: 0,
    };
  }

  if (matches.length === 1) {
    return {
      status: 'single',
      query: trimmedQuery,
      normalizedQuery,
      song: matches[0].song,
      songs: [matches[0].song],
      totalMatches: 1,
    };
  }

  return {
    status: 'multiple',
    query: trimmedQuery,
    normalizedQuery,
    songs: matches.slice(0, vArchiveSongCandidateLimit).map((entry) => entry.song),
    totalMatches: matches.length,
  };
}

export function buildVArchiveSongEmbed(song) {
  const titleId = getSongTitleId(song);
  const pageUrl = buildVArchiveSongPageUrl(song);
  const composer = formatSongComposer(song);
  const dlcLabel = formatVArchiveSongDlc(song);

  return new EmbedBuilder()
    .setColor(vArchiveSongEmbedColor)
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
  const rows = vArchiveKeyOrder.map((key) => [
    key,
    ...vArchiveDifficultyOrder.map((difficulty) =>
      formatSongDifficultyCell(song?.patterns?.[key]?.[difficulty])
    ),
  ]);
  const columnWidths = [
    Math.max('KEY'.length, ...rows.map((row) => row[0].length)),
    ...vArchiveDifficultyOrder.map((difficulty, index) =>
      Math.max(
        8,
        difficulty.length,
        ...rows.map((row) => row[index + 1].length)
      )
    ),
  ];
  const header = ['KEY', ...vArchiveDifficultyOrder]
    .map((value, index) => value.padEnd(columnWidths[index], ' '))
    .join('  ')
    .trimEnd();
  const body = rows
    .map((row) => row.map((value, index) => value.padEnd(columnWidths[index], ' ')).join('  ').trimEnd())
    .join('\n');

  return `\`\`\`txt\n${header}\n${body}\n\`\`\``;
}

export function normalizeSongName(text) {
  return normalizeSongWords(text).join('');
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
    .setColor(vArchiveSongEmbedColor)
    .setTitle(`서열표 검색 결과: ${String(query ?? '').trim() || '-'}`)
    .setDescription(descriptionLines.join('\n'))
    .setFooter({
      text: footerText,
    });
}

async function refreshVArchiveSongs(fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), vArchiveSongRequestTimeoutMs);

  try {
    const response = await fetchImpl(vArchiveSongsUrl, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      const error = new Error(`Failed to fetch V-ARCHIVE songs: ${response.status}`);
      error.code = 'VARCHIVE_SONG_FETCH_FAILED';
      error.status = response.status;
      throw error;
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      const error = new Error('Unexpected V-ARCHIVE songs payload.');
      error.code = 'VARCHIVE_SONG_FETCH_FAILED';
      throw error;
    }

    vArchiveSongCache.songs = payload;
    vArchiveSongCache.searchEntries = payload.map((song) => buildSongSearchEntry(song));
    vArchiveSongCache.songsByTitleId = new Map(
      payload.map((song) => [getSongTitleId(song), song])
    );
    vArchiveSongCache.aliasTitleIdsByKey = buildAliasTitleIdsByKey();
    vArchiveSongCache.expiresAt = Date.now() + vArchiveSongCacheTtlMs;
    vArchiveSongCache.nextRefreshAllowedAt = 0;

    return vArchiveSongCache.songs;
  } catch (error) {
    if (error?.name === 'AbortError') {
      error = Object.assign(new Error('V-ARCHIVE songs request timed out.'), {
        code: 'VARCHIVE_SONG_TIMEOUT',
      });
    }

    if (Array.isArray(vArchiveSongCache.songs)) {
      vArchiveSongCache.nextRefreshAllowedAt = Date.now() + vArchiveSongRetryBackoffMs;
      console.warn('Failed to refresh V-ARCHIVE songs cache, using stale cache instead:');
      console.warn(error);
      return vArchiveSongCache.songs;
    }

    if (!error.code) {
      error.code = 'VARCHIVE_SONG_FETCH_FAILED';
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildVArchiveSongPageUrl(song) {
  return `${vArchiveSongPageBaseUrl}/${encodeURIComponent(getSongTitleId(song))}`;
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

export function formatVArchiveSongDlc(song) {
  const code = String(song?.dlcCode ?? '').trim();
  if (!code) {
    return 'DLC 미상';
  }

  return vArchiveDlcLabels[code] ?? code;
}

function getSongTitleId(song) {
  const titleId = song?.title;
  return Number.isFinite(Number(titleId))
    ? String(Number(titleId))
    : String(titleId ?? '-');
}

function resolveFetch(fetchImpl) {
  const targetFetch = fetchImpl ?? globalThis.fetch;
  if (typeof targetFetch !== 'function') {
    throw new Error('현재 실행 환경에서 fetch를 사용할 수 없다냥.');
  }

  return targetFetch;
}

function buildSongSearchEntry(song) {
  const words = normalizeSongWords(song?.name);
  const normalizedName = words.join('');
  const withoutStopWords = removeStopWords(words);
  const withoutWeakWords = removeWeakWords(withoutStopWords);
  const searchKeys = getUniqueSearchKeys([
    normalizedName,
    withoutStopWords.join(''),
    withoutWeakWords.join(''),
  ]);

  return {
    song,
    normalizedName,
    words,
    searchKeys,
  };
}

function buildSongQueryMeta(query) {
  const words = normalizeSongWords(query);
  const normalizedName = words.join('');
  const wordsWithoutStopWords = removeStopWords(words);
  const wordsWithoutWeakWords = removeWeakWords(wordsWithoutStopWords);
  const searchKeys = getUniqueSearchKeys([
    normalizedName,
    wordsWithoutStopWords.join(''),
    wordsWithoutWeakWords.join(''),
  ]);
  const primarySearchKey = searchKeys[0] ?? normalizedName;
  const tokenWords = wordsWithoutStopWords.length > 0 ? wordsWithoutStopWords : words;
  const coreTokens = wordsWithoutWeakWords.length > 0 ? wordsWithoutWeakWords : tokenWords;

  return {
    rawQuery: String(query ?? ''),
    normalizedName,
    words,
    wordsWithoutStopWords,
    wordsWithoutWeakWords,
    tokenWords,
    coreTokens,
    searchKeys,
    primarySearchKey,
    titleId: /^\d+$/.test(String(query ?? '').trim()) ? String(Number(query)) : null,
    aliasKey: normalizeSongName(query),
  };
}

function normalizeSongWords(text) {
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

function removeStopWords(words) {
  return words.filter((word) => !vArchiveSongSearchStopWords.has(word));
}

function removeWeakWords(words) {
  return words.filter((word) => !vArchiveSongSearchWeakWords.has(word));
}

function getUniqueSearchKeys(values) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

function buildAliasTitleIdsByKey() {
  const aliasEntries = new Map();

  for (const [alias, titleIds] of Object.entries(vArchiveSongAliasTitleIds)) {
    const normalizedAlias = normalizeSongName(alias);
    if (!normalizedAlias) {
      continue;
    }

    aliasEntries.set(normalizedAlias, [...new Set(
      (Array.isArray(titleIds) ? titleIds : [titleIds])
        .map((titleId) => String(Number(titleId)))
        .filter((titleId) => /^\d+$/.test(titleId))
    )]);
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
  const titleIds = aliasTitleIdsByKey.get(queryMeta.aliasKey);
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

    const titleId = getSongTitleId(entry.song);
    if (seen.has(titleId)) {
      continue;
    }

    seen.add(titleId);
    results.push({
      song: entry.song,
      score,
    });
  }

  return results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return formatVArchiveSongCandidate(a.song).localeCompare(formatVArchiveSongCandidate(b.song), 'en');
  });
}

function scoreSearchKeyExact(entry, queryMeta) {
  for (const queryKey of queryMeta.searchKeys) {
    const index = entry.searchKeys.indexOf(queryKey);
    if (index !== -1) {
      return index;
    }
  }

  return Number.POSITIVE_INFINITY;
}

function scoreSearchKeyPrefix(entry, queryMeta) {
  let bestScore = null;

  for (const queryKey of queryMeta.searchKeys) {
    if (!queryKey) {
      continue;
    }

    for (const entryKey of entry.searchKeys) {
      if (!entryKey.startsWith(queryKey)) {
        continue;
      }

      const score = 800 - (entryKey.length - queryKey.length);
      bestScore = bestScore === null ? score : Math.max(bestScore, score);
    }
  }

  return bestScore;
}

function scoreSearchKeyIncludes(entry, queryMeta) {
  let bestScore = null;

  for (const queryKey of queryMeta.searchKeys) {
    if (!queryKey) {
      continue;
    }

    for (const entryKey of entry.searchKeys) {
      const matchIndex = entryKey.indexOf(queryKey);
      if (matchIndex === -1) {
        continue;
      }

      const score = 700 - matchIndex * 2 - (entryKey.length - queryKey.length);
      bestScore = bestScore === null ? score : Math.max(bestScore, score);
    }
  }

  return bestScore;
}

function scoreTokenCoverage(entry, queryMeta) {
  const tokens = queryMeta.coreTokens.length > 0
    ? queryMeta.coreTokens
    : queryMeta.tokenWords;

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

  return 500 + score;
}

function scoreTokenAgainstEntry(token, entry) {
  let bestScore = null;

  for (const word of entry.words) {
    if (word === token) {
      bestScore = Math.max(bestScore ?? -Infinity, 50);
      continue;
    }

    if (word.startsWith(token)) {
      bestScore = Math.max(bestScore ?? -Infinity, 40 - (word.length - token.length));
      continue;
    }

    if (word.includes(token)) {
      bestScore = Math.max(bestScore ?? -Infinity, 28 - Math.max(0, word.indexOf(token)));
    }
  }

  return bestScore;
}

function scoreFuzzyCandidate(entry, queryMeta) {
  const queryKey = queryMeta.primarySearchKey;
  const entryKey = entry.searchKeys[0] ?? entry.normalizedName;

  if (!queryKey || !entryKey) {
    return null;
  }

  const similarity = computeDiceCoefficient(queryKey, entryKey);
  const partialTokenHits = queryMeta.coreTokens.filter((token) =>
    entry.words.some((word) => word.startsWith(token) || token.startsWith(word) || word.includes(token))
  ).length;
  const minPartialHits = queryMeta.coreTokens.length >= 2 ? 2 : 1;

  if (partialTokenHits < minPartialHits && similarity < 0.5) {
    return null;
  }

  const score = Math.round(similarity * 100) + partialTokenHits * 20;
  return score >= 45 ? score : null;
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
