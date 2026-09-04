import { buildVArchiveJacketUrl } from './varchive-grade.js';
import { fetchVArchiveSongs } from './varchive-song.js';
import {
  normalizeVArchiveNickname,
  parseVArchiveButtonToken,
} from './varchive-link-store.js';
import {
  extractVArchiveBoardPageEntries,
  fetchVArchiveBoardPageHtml,
} from './varchive-board.js';

const validDifficulties = new Set(['NM', 'HD', 'MX', 'SC']);
const varchiveBoardPageCount = 17;

export function parseVArchiveLevelPerformanceToken(value) {
  const trimmed = String(value ?? '').trim();
  const match = trimmed.match(/^(nm|hd|mx|sc)(\d+)$/i);

  if (!match) {
    const error = new Error('난이도는 `sc14`, `mx13`, `hd12`, `nm10`처럼 입력해달라냥.');
    error.code = 'INVALID_VARCHIVE_LEVEL_PERFORMANCE_LEVEL';
    throw error;
  }

  return {
    difficulty: match[1].toUpperCase(),
    level: Number.parseInt(match[2], 10),
  };
}

export function parseVArchiveLevelPerformanceMessageInput(input, fallbackNickname = null) {
  const trimmed = String(input ?? '').trim();
  const normalizedFallbackNickname = fallbackNickname
    ? normalizeVArchiveNickname(fallbackNickname)
    : null;

  if (!trimmed) {
    return {
      difficulty: null,
      level: null,
      button: null,
      nickname: normalizedFallbackNickname,
      usedFallbackNickname: Boolean(normalizedFallbackNickname),
    };
  }

  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 2) {
    const error = new Error(getVArchiveLevelPerformanceUsageMessage());
    error.code = 'INVALID_VARCHIVE_LEVEL_PERFORMANCE_INPUT';
    throw error;
  }

  const { difficulty, level } = parseVArchiveLevelPerformanceToken(tokens[0]);
  const button = parseVArchiveButtonToken(tokens[1]);

  if (button === null) {
    const error = new Error('버튼 수는 4, 5, 6, 8만 지원한다냥.');
    error.code = 'INVALID_VARCHIVE_LEVEL_PERFORMANCE_BUTTON';
    throw error;
  }

  const nicknameText = tokens.slice(2).join(' ').trim();

  return {
    difficulty,
    level,
    button,
    nickname: nicknameText
      ? normalizeVArchiveNickname(nicknameText)
      : normalizedFallbackNickname,
    usedFallbackNickname: !nicknameText && Boolean(normalizedFallbackNickname),
  };
}

export async function createVArchiveLevelPerformanceLookup(
  nickname,
  difficulty,
  level,
  button,
  options = {},
) {
  const normalizedDifficulty = normalizeDifficulty(difficulty);
  const normalizedLevel = normalizeLevel(level);
  const normalizedButton = normalizeButton(button);
  const normalizedNickname = normalizeVArchiveNickname(nickname);
  const songs = options.songs ?? await fetchVArchiveSongs(options);
  const entries = findVArchiveLevelPerformanceEntries(
    songs,
    normalizedDifficulty,
    normalizedLevel,
    normalizedButton,
  );

  if (entries.length === 0) {
    const error = new Error('해당 레벨의 패턴을 찾지 못했다냥.');
    error.code = 'NO_VARCHIVE_LEVEL_PERFORMANCE_ENTRIES';
    throw error;
  }

  const performanceEntries = await fetchVArchiveLevelPerformanceEntries(
    normalizedNickname,
    entries,
    {
      fetchImpl: options.fetchImpl,
      boardPageCount: options.boardPageCount,
    },
  );

  return {
    nickname: normalizedNickname,
    difficulty: normalizedDifficulty,
    level: normalizedLevel,
    button: normalizedButton,
    key: `${normalizedButton}B`,
    entries: performanceEntries,
  };
}

export function findVArchiveLevelPerformanceEntries(songs, difficulty, level, button) {
  const normalizedDifficulty = normalizeDifficulty(difficulty);
  const normalizedLevel = normalizeLevel(level);
  const normalizedButton = normalizeButton(button);
  const key = `${normalizedButton}B`;
  const entries = [];

  for (const song of Array.isArray(songs) ? songs : []) {
    const pattern = song?.patterns?.[key]?.[normalizedDifficulty];
    if (!pattern) {
      continue;
    }

    if (Number(pattern.level) !== normalizedLevel) {
      continue;
    }

    const titleId = normalizeSongTitleId(song?.title);
    entries.push({
      titleId,
      songName: String(song?.name ?? '').trim() || 'Unknown Song',
      difficulty: normalizedDifficulty,
      level: normalizedLevel,
      button: normalizedButton,
      key,
      floorName: String(pattern?.floorName ?? '').trim(),
      rating: Number.isFinite(Number(pattern?.rating)) ? Number(pattern.rating) : null,
      dlcCode: String(song?.dlcCode ?? '').trim(),
      jacketUrl: buildVArchiveJacketUrl(titleId),
    });
  }

  return entries.sort(compareLevelPerformanceEntries);
}

export async function fetchVArchiveLevelPerformanceEntries(nickname, entries, options = {}) {
  const normalizedNickname = normalizeVArchiveNickname(nickname);
  const safeEntries = Array.isArray(entries) ? entries : [];

  if (safeEntries.length === 0) {
    return [];
  }

  const button = normalizeButton(safeEntries[0].button);
  if (safeEntries.some((entry) => normalizeButton(entry.button) !== button)) {
    throw new Error('All level performance entries must use the same button.');
  }

  const fetchImpl = resolveFetch(options.fetchImpl);
  const pageCount = Number.isInteger(options.boardPageCount) && options.boardPageCount > 0
    ? options.boardPageCount
    : varchiveBoardPageCount;
  const pageEntries = await Promise.all(
    Array.from({ length: pageCount }, (_, index) => index + 1)
      .map(async (boardNo) => ({
        boardNo,
        entries: extractVArchiveBoardPageEntries(
          await fetchVArchiveBoardPageHtml(normalizedNickname, button, boardNo, { fetchImpl }),
          button,
        ),
      })),
  );

  return safeEntries.map((entry) => {
    const lookupKey = `${entry.titleId}:${entry.difficulty}`;

    for (const pageEntry of pageEntries) {
      const matched = pageEntry.entries.get(lookupKey);
      if (matched) {
        return {
          ...entry,
          nickname: normalizedNickname,
          boardNo: pageEntry.boardNo,
          scoreText: matched.scoreText ?? '-',
          scoreKind: matched.scoreKind ?? 'none',
        };
      }
    }

    return {
      ...entry,
      nickname: normalizedNickname,
      boardNo: null,
      scoreText: '-',
      scoreKind: 'none',
    };
  });
}

export function buildVArchiveLevelPerformanceFocusUrl(lookup) {
  const nickname = normalizeVArchiveNickname(lookup?.nickname ?? '');
  const button = normalizeButton(lookup?.button);
  const withScore = lookup?.entries?.find((entry) => entry?.boardNo && entry?.scoreText && entry.scoreText !== '-');
  const fallback = lookup?.entries?.find((entry) => entry?.boardNo);
  const target = withScore ?? fallback;

  if (!target) {
    return `https://v-archive.net/archive/${encodeURIComponent(nickname)}/board/${button}/1`;
  }

  return `https://v-archive.net/archive/${encodeURIComponent(nickname)}/board/${button}/${target.boardNo}#focus_${target.titleId}-${button}-${target.difficulty}`;
}

export function getVArchiveLevelPerformanceUsageMessage() {
  return '사용법은 `%레벨성과 <난이도레벨> <버튼수> [닉네임]`이다냥. 예: `%레벨성과 sc14 4`, `%레벨성과 mx13 6 KanNyan0713`';
}

function normalizeDifficulty(value) {
  const difficulty = String(value ?? '').trim().toUpperCase();
  if (validDifficulties.has(difficulty)) {
    return difficulty;
  }

  throw new Error(`Unsupported difficulty: ${value}`);
}

function normalizeLevel(value) {
  const level = Number.parseInt(String(value ?? '').trim(), 10);
  if (Number.isInteger(level) && level >= 0) {
    return level;
  }

  throw new Error(`Unsupported level: ${value}`);
}

function normalizeButton(value) {
  const button = parseVArchiveButtonToken(value);
  if (button !== null) {
    return button;
  }

  throw new Error(`Unsupported button: ${value}`);
}

function compareLevelPerformanceEntries(left, right) {
  const scoreOrder = String(left?.songName ?? '').localeCompare(
    String(right?.songName ?? ''),
    'ko',
    { sensitivity: 'base', numeric: true },
  );
  if (scoreOrder !== 0) {
    return scoreOrder;
  }

  return String(left?.titleId ?? '').localeCompare(
    String(right?.titleId ?? ''),
    'en',
    { numeric: true },
  );
}

function normalizeSongTitleId(value) {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text)
    ? String(Number(text))
    : text;
}

function resolveFetch(fetchImpl) {
  const targetFetch = fetchImpl ?? globalThis.fetch;
  if (typeof targetFetch !== 'function') {
    throw new Error('현재 실행 환경에서 fetch를 사용할 수 없다냥.');
  }

  return targetFetch;
}
