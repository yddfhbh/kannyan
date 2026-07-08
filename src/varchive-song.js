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

const vArchiveSongCache = {
  songs: null,
  indexedSongs: null,
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
  const normalizedQuery = normalizeSongName(trimmedQuery);

  if (!normalizedQuery) {
    const error = new Error('곡명을 입력해달라냥.');
    error.code = 'INVALID_VARCHIVE_SONG_QUERY';
    throw error;
  }

  await fetchVArchiveSongs(options);
  const indexedSongs = Array.isArray(vArchiveSongCache.indexedSongs)
    ? vArchiveSongCache.indexedSongs
    : [];

  const exactMatches = indexedSongs.filter((entry) => entry.normalizedName === normalizedQuery);
  const startsWithMatches = exactMatches.length === 0
    ? indexedSongs.filter((entry) => entry.normalizedName.startsWith(normalizedQuery))
    : [];
  const includesMatches = exactMatches.length === 0 && startsWithMatches.length === 0
    ? indexedSongs.filter((entry) => entry.normalizedName.includes(normalizedQuery))
    : [];
  const matches = exactMatches.length > 0
    ? exactMatches
    : startsWithMatches.length > 0
      ? startsWithMatches
      : includesMatches;

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
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
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
    vArchiveSongCache.indexedSongs = payload.map((song) => ({
      song,
      normalizedName: normalizeSongName(song?.name),
    }));
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
