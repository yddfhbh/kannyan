import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateTetrioStats } from './tetrio-stats-calculations.js';

const API_BASE = 'https://ch.tetr.io/api';

const DATA_FILE = fileURLToPath(new URL('../data/tetrio-league-cache.json', import.meta.url));
const TEMP_FILE = fileURLToPath(new URL('../data/tetrio-league-cache.tmp.json', import.meta.url));

const REQUEST_DELAY_MS = 1000;
const REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

let activeData = {
  generatedAt: null,
  userCount: 0,
  users: [],
};

let refreshPromise = null;
let lastRefreshStartedAt = 0;

const STAT_CONFIG = {
  apm: { label: 'APM', key: 'apm', digits: 2 },
  pps: { label: 'PPS', key: 'pps', digits: 2 },
  vs: { label: 'VS', key: 'vs', digits: 2 },
  glicko: { label: 'Glicko', key: 'glicko', digits: 2 },
  rd: { label: 'RD', key: 'rd', digits: 2 },
  tr: { label: 'TR', key: 'tr', digits: 2 },

  app: { label: 'APP', key: 'app', digits: 4 },
  dspiece: { label: 'DS/Piece', key: 'dsPiece', digits: 4 },
  ds: { label: 'DS/Piece', key: 'dsPiece', digits: 4 },
  dssecond: { label: 'DS/Sec', key: 'dsSecond', digits: 4 },
  esttr: { label: 'Est.TR', key: 'estimatedTr', digits: 2 },
  estglicko: { label: 'Est.Glicko', key: 'estimatedGlicko', digits: 2 },
  statrank: { label: 'Stat Rank', key: 'statRank', digits: 2 },
  srarea: { label: 'Style Area', key: 'styleArea', digits: 2 },
  sr: { label: 'Style Stat Rank', key: 'styleStatRank', digits: 2 },
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasNumber(value) {
  return Number.isFinite(value);
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeRank(value) {
  const rank = String(value ?? '').trim().toLowerCase();

  if (!rank || rank === 'all' || rank === '전체') {
    return null;
  }

  return rank;
}

function formatPrisecter(p) {
  if (!p) return null;

  if (typeof p === 'string') {
    return p;
  }

  if (
    p.pri !== undefined
    && p.sec !== undefined
    && p.ter !== undefined
  ) {
    return `${p.pri}:${p.sec}:${p.ter}`;
  }

  return null;
}

async function fetchLeaguePage({ after, sessionId }) {
  const url = new URL(`${API_BASE}/users/by/league`);
  url.searchParams.set('limit', '100');

  if (after) {
    url.searchParams.set('after', after);
  }

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'kannyan discord bot; TETR.IO league leaderboard cache',
      'X-Session-ID': sessionId,
    },
  });

  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    const message = body?.error?.msg ?? `HTTP ${response.status}`;
    throw new Error(`TETR.IO league fetch failed: ${message}`);
  }

  return body.data?.entries ?? body.data?.users ?? [];
}

function convertEntry(entry, tlRank) {
  const league = entry.league ?? {};

  const apm = toFiniteNumber(league.apm);
  const pps = toFiniteNumber(league.pps);
  const vs = toFiniteNumber(league.vs);
  const glicko = toFiniteNumber(league.glicko);
  const rd = toFiniteNumber(league.rd);
  const tr = toFiniteNumber(league.tr ?? league.rating);
  const gamesWon = toFiniteNumber(league.gameswon ?? league.gamesWon);
  const gamesPlayed = toFiniteNumber(league.gamesplayed ?? league.gamesPlayed);

  const derived = calculateTetrioStats({
    apm,
    pps,
    vs,
    rd,
    wins: gamesWon,
    gamesWon,
  });

  return {
    id: entry._id ?? entry.id ?? null,
    username: entry.username,
    country: entry.country ?? null,

    // 원래 TETRA LEAGUE 순위
    tlRank,

    // TETRA LEAGUE 기본값
    rank: String(league.rank ?? 'z').toLowerCase(),
    bestRank: league.bestrank ?? league.bestRank ?? null,
    tr,
    glicko,
    rd,
    apm,
    pps,
    vs,
    gamesWon,
    gamesPlayed,
    gxe: toFiniteNumber(league.gxe),
    decaying: Boolean(league.decaying),

    // 파생값
    app: derived.app,
    dsSecond: derived.dsSecond,
    dsPiece: derived.dsPiece,
    appDsPiece: derived.appDsPiece,
    vsApm: derived.vsApm,
    vsPps: derived.vsPps,
    cheeseIndex: derived.cheeseIndex,
    garbageEffi: derived.garbageEffi,
    area: derived.area,
    weightedApp: derived.weightedApp,
    estimatedGlicko: derived.estimatedGlicko,
    estimatedTr: derived.estimatedTr,
    statRank: derived.statRank,
    styleArea: derived.styleArea,
    styleStatRank: derived.styleStatRank,
    playstyle: derived.playstyle,
  };
}

export async function loadTetrioLeagueCache() {
  try {
    const text = await readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed.users)) {
      activeData = parsed;
      console.log(`[TETR.IO LB] loaded ${activeData.users.length} users`);
    }
  } catch {
    console.log('[TETR.IO LB] no saved cache yet');
  }
}

export function getTetrioLeagueRefreshStatus() {
  return {
    refreshing: Boolean(refreshPromise),
    generatedAt: activeData.generatedAt,
    userCount: activeData.users.length,
  };
}

export async function refreshTetrioLeagueCache({ force = false, onProgress } = {}) {
  if (refreshPromise) {
    return refreshPromise;
  }

  const now = Date.now();

  if (!force && now - lastRefreshStartedAt < REFRESH_COOLDOWN_MS) {
    const remain = Math.ceil((REFRESH_COOLDOWN_MS - (now - lastRefreshStartedAt)) / 1000);
    throw new Error(`refresh cooldown: ${remain}s left`);
  }

  lastRefreshStartedAt = now;

  refreshPromise = crawlAndSwapCache({ onProgress })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

async function crawlAndSwapCache({ onProgress } = {}) {
  const sessionId = `kannyan-lb-refresh-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  let after = null;
  let page = 0;
  const users = [];

  while (true) {
    const entries = await fetchLeaguePage({ after, sessionId });

    if (!entries.length) {
      break;
    }

    for (const entry of entries) {
      users.push(convertEntry(entry, users.length + 1));
    }

    page += 1;

    onProgress?.({
      page,
      users: users.length,
      lastUsername: entries.at(-1)?.username,
    });

    after = formatPrisecter(entries.at(-1)?.p);

    if (!after || entries.length < 100) {
      break;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const nextData = {
    generatedAt: new Date().toISOString(),
    userCount: users.length,
    users,
  };

  await mkdir(dirname(DATA_FILE), { recursive: true });

  // 크롤링 중에는 기존 파일 유지
  await writeFile(TEMP_FILE, JSON.stringify(nextData, null, 2));

  // 끝까지 성공했을 때만 교체
  await rename(TEMP_FILE, DATA_FILE);

  activeData = nextData;

  return {
    generatedAt: nextData.generatedAt,
    userCount: nextData.userCount,
  };
}

export function parseTetrioLeaderboardCommand(content) {
  const tokens = String(content ?? '').trim().split(/\s+/);
  const command = tokens[0];

  if (command !== '%lb' && command !== '%rlb') {
    return null;
  }

  const reverse = command === '%rlb';

  const statInput = String(tokens[1] ?? '').toLowerCase();
  const stat = STAT_CONFIG[statInput] ? statInput : null;
  const limit = clampInt(tokens[2], 1, 50, 10);

  let page = 1;
  let rank = null;

  for (const token of tokens.slice(3)) {
    if (/^\d+$/.test(token)) {
      page = clampInt(token, 1, 9999, 1);
    } else {
      rank = normalizeRank(token);
    }
  }

  return {
    command,
    reverse,
    stat,
    limit,
    page,
    rank,
  };
}

function formatUpdatedAt(value) {
  if (!value) return 'unknown';

  return new Date(value).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
  });
}

function chunkLeaderboardMessage(headerLines, bodyLines, maxLength = 1900) {
  const chunks = [];
  let current = [...headerLines, '```'];

  for (const line of bodyLines) {
    const next = [...current, line, '```'].join('\n');

    if (next.length > maxLength) {
      current.push('```');
      chunks.push(current.join('\n'));
      current = ['```', line];
    } else {
      current.push(line);
    }
  }

  current.push('```');
  chunks.push(current.join('\n'));

  return chunks;
}

export function formatTetrioLeaderboard(parsed = {}) {
  const {
    reverse = false,
    stat,
    limit = 10,
    page = 1,
    rank = null,
  } = parsed;

  const cfg = STAT_CONFIG[stat];

  if (!cfg) {
    return [
      [
        '사용법:',
        '`%lb apm 10` → APM 높은 순 10명',
        '`%rlb apm 10` → APM 낮은 순 10명',
        '`%lb pps 50 2` → PPS 높은 순 51~100등',
        '`%lb glicko 20 x` → X랭크 안에서 Glicko 높은 순 20명',
        '',
        `가능한 값: ${Object.keys(STAT_CONFIG).join(', ')}`,
      ].join('\n'),
    ];
  }

  if (!activeData.users.length) {
    return ['아직 리더보드 데이터가 없음. `%refresh`로 먼저 데이터를 받아와야 함.'];
  }

  const normalizedRank = normalizeRank(rank);

  const rows = activeData.users
    .filter(user => hasNumber(user[cfg.key]))
    .filter(user => !normalizedRank || user.rank === normalizedRank)
    .sort((a, b) => {
      const av = a[cfg.key];
      const bv = b[cfg.key];

      // %lb  = 큰 값부터
      // %rlb = 작은 값부터
      return reverse ? av - bv : bv - av;
    });

  const start = (page - 1) * limit;
  const sliced = rows.slice(start, start + limit);

  if (!sliced.length) {
    return [
      `${cfg.label} 리더보드에 표시할 데이터가 없음. page=${page}, rank=${normalizedRank ?? 'all'}`,
    ];
  }

  const titleRank = normalizedRank ? ` ${normalizedRank.toUpperCase()}` : '';
  const directionLabel = reverse ? 'Reverse ' : '';
  const modeLabel = reverse ? 'RLB' : 'LB';

  const headerLines = [
    `${directionLabel}${cfg.label}${titleRank} Leaderboard:`,
    `mode: ${modeLabel} / page: ${page} / updated: ${formatUpdatedAt(activeData.generatedAt)} / users: ${activeData.users.length}`,
  ];

  const bodyLines = sliced.map((user, index) => {
    const place = start + index + 1;
    const value = user[cfg.key].toFixed(cfg.digits);
    const rankText = user.rank ? user.rank.toUpperCase() : '?';

    return `#${place}: ${user.username} (TL #${user.tlRank}, ${rankText}): ${value}`;
  });

  return chunkLeaderboardMessage(headerLines, bodyLines);
}