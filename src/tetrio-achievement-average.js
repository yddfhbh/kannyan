import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTetrioAchievementCatalog } from './tetrio-achievement-card.js';
import { getTetrioLeagueUsers } from './tetrio-league-leaderboard.js';
import { fetchTetrioLeagueRankIconDataUri } from './tetrio-rankcut.js';
import {
  getTetrioHunDinFontDataUri,
  renderTetrioHunDinFontFace,
  renderTetrioNumericTextMarkup,
  renderTetrioSvgToPng,
  renderTetrioTextMarkup,
  tetrioFontFamily,
} from './tetrio-font.js';

const API_BASE = 'https://ch.tetr.io/api';
const REQUEST_HEADERS = {
  'User-Agent': 'discord-bot/1.0 TETR.IO rank achievement average',
};
const defaultDataDir = fileURLToPath(new URL('../data/', import.meta.url));
const dataDir = resolve(process.env.TETRIO_ACHIEVEMENT_AVERAGE_DATA_DIR?.trim() || defaultDataDir);
const DATA_FILE = join(dataDir, 'tetrio-achievement-average.json');
const TEMP_FILE = join(dataDir, 'tetrio-achievement-average.tmp.json');
const SAMPLE_SIZE = Math.max(1, Number(process.env.TETRIO_ACHIEVEMENT_AVERAGE_SAMPLE_SIZE) || 800);
const SNAPSHOT_ROLLOVER_HOUR_KST = 4;
const CHECK_INTERVAL_MS = Math.max(
  30_000,
  Number(process.env.TETRIO_ACHIEVEMENT_AVERAGE_CHECK_INTERVAL_MS) || 60_000
);
const FETCH_CONCURRENCY = Math.max(
  1,
  Math.min(16, Number(process.env.TETRIO_ACHIEVEMENT_AVERAGE_CONCURRENCY) || 8)
);
const FETCH_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.TETRIO_ACHIEVEMENT_AVERAGE_TIMEOUT_MS) || 15_000
);
const FETCH_RETRY_LIMIT = Math.max(
  1,
  Math.min(6, Number(process.env.TETRIO_ACHIEVEMENT_AVERAGE_RETRIES) || 3)
);
const BUILD_COOLDOWN_MS = Math.max(
  60_000,
  Number(process.env.TETRIO_ACHIEVEMENT_AVERAGE_BUILD_COOLDOWN_MS) || 10 * 60 * 1000
);
const LEAGUE_RANK_ORDER = [
  'x+',
  'x',
  'u',
  'ss',
  's+',
  's',
  's-',
  'a+',
  'a',
  'a-',
  'b+',
  'b',
  'b-',
  'c+',
  'c',
  'c-',
  'd+',
  'd',
  'd-',
  'z',
];
const RANK_LABELS = new Map(LEAGUE_RANK_ORDER.map((rank) => [rank, rank.toUpperCase()]));
const RANK_PALETTES = new Map([
  ['x+', { primary: '#f5c5ff', secondary: '#ac49cf', glow: 'rgba(172,73,207,0.24)' }],
  ['x', { primary: '#ff9ad8', secondary: '#d24393', glow: 'rgba(210,67,147,0.22)' }],
  ['u', { primary: '#ff7272', secondary: '#d13d3d', glow: 'rgba(209,61,61,0.2)' }],
  ['ss', { primary: '#ffa14f', secondary: '#cf6d1f', glow: 'rgba(207,109,31,0.2)' }],
  ['s+', { primary: '#ffd76c', secondary: '#c79b1f', glow: 'rgba(199,155,31,0.2)' }],
  ['s', { primary: '#ffe77f', secondary: '#c5ac2d', glow: 'rgba(197,172,45,0.18)' }],
  ['s-', { primary: '#d9f56b', secondary: '#96b723', glow: 'rgba(150,183,35,0.18)' }],
  ['a+', { primary: '#85ef77', secondary: '#379c2f', glow: 'rgba(55,156,47,0.2)' }],
  ['a', { primary: '#77de8e', secondary: '#2f9460', glow: 'rgba(47,148,96,0.18)' }],
  ['a-', { primary: '#7de0a8', secondary: '#388f6f', glow: 'rgba(56,143,111,0.18)' }],
  ['b+', { primary: '#64d4ff', secondary: '#1f7dca', glow: 'rgba(31,125,202,0.18)' }],
  ['b', { primary: '#67b9ff', secondary: '#2f70c8', glow: 'rgba(47,112,200,0.18)' }],
  ['b-', { primary: '#7d9fff', secondary: '#445fc6', glow: 'rgba(68,95,198,0.18)' }],
  ['c+', { primary: '#a28dff', secondary: '#654bca', glow: 'rgba(101,75,202,0.18)' }],
  ['c', { primary: '#a992ff', secondary: '#6c57bf', glow: 'rgba(108,87,191,0.17)' }],
  ['c-', { primary: '#b59cff', secondary: '#7f61b7', glow: 'rgba(127,97,183,0.17)' }],
  ['d+', { primary: '#d7a7ff', secondary: '#9267b6', glow: 'rgba(146,103,182,0.16)' }],
  ['d', { primary: '#dcb0ef', secondary: '#9a78aa', glow: 'rgba(154,120,170,0.15)' }],
  ['d-', { primary: '#dfbbe6', secondary: '#a485a5', glow: 'rgba(164,133,165,0.15)' }],
  ['z', { primary: '#e3c8df', secondary: '#988490', glow: 'rgba(152,132,144,0.14)' }],
]);

let stateCache = null;
let stateLoadPromise = null;
let stateSaveQueue = Promise.resolve();
let snapshotBuildPromise = null;
let lastBuildStartedAt = 0;
let trackerTimer = null;
let lastPreRolloverWaitLogKey = null;

export function initTetrioAchievementAverageTracker() {
  if (trackerTimer) {
    clearInterval(trackerTimer);
  }

  void ensureTodaySnapshot({
    onProgress: createSnapshotProgressLogger(),
  }).catch((error) => {
    console.error('[TETR.IO ACH AVG] initial snapshot check failed:');
    console.error(error);
  });

  trackerTimer = setInterval(() => {
    void ensureTodaySnapshot({
      onProgress: createSnapshotProgressLogger(),
    }).catch((error) => {
      console.error('[TETR.IO ACH AVG] scheduled snapshot check failed:');
      console.error(error);
    });
  }, CHECK_INTERVAL_MS);

  console.log('[TETR.IO ACH AVG] tracker enabled');
}

export async function createTetrioAchievementAverageCard(achievementQuery) {
  const state = await loadState();
  const snapshot = getLatestSnapshot(state);

  if (!snapshot) {
    const error = new Error('No achievement average snapshot available');
    error.code = 'TETRIO_ACHIEVEMENT_AVERAGE_NO_SNAPSHOT';
    throw error;
  }

  const catalog = await fetchTetrioAchievementCatalog();
  const snapshotAchievements = Object.values(snapshot.achievements ?? {});
  const definition = findBestAchievementMatch(catalog, achievementQuery)
    ?? findBestAchievementMatch(snapshotAchievements, achievementQuery);

  if (!definition) {
    const error = new Error('Achievement not found');
    error.code = 'TETRIO_ACHIEVEMENT_NOT_FOUND';
    throw error;
  }

  const snapshotEntry = snapshot.achievements?.[String(definition.k)] ?? null;
  const svg = await renderAchievementAverageCardSvg({
    achievement: normalizeAchievementInfo(definition),
    snapshot,
    snapshotEntry,
  });

  return {
    achievementName: definition.name,
    image: renderTetrioSvgToPng(svg, 2),
    snapshotDateKey: snapshot.dateKey,
    svg,
  };
}

export async function createTetrioAchievementAveragePreviewCard({ achievement, snapshot }) {
  const normalizedAchievement = normalizeAchievementInfo(achievement);
  const snapshotEntry = snapshot?.achievements?.[String(normalizedAchievement.k)] ?? {
    ...normalizedAchievement,
    ranks: {},
  };
  const normalizedSnapshot = {
    achievements: {
      [String(normalizedAchievement.k)]: snapshotEntry,
    },
    createdAt: snapshot?.createdAt ?? new Date().toISOString(),
    dateKey: snapshot?.dateKey ?? getKstDateInfo().dateKey,
    failedUsers: Number(snapshot?.failedUsers ?? 0),
    processedUsers: Number(snapshot?.processedUsers ?? 0),
    sampleSize: Number(snapshot?.sampleSize ?? SAMPLE_SIZE),
    sampledUsers: Number(snapshot?.sampledUsers ?? 0),
    source: snapshot?.source ?? 'preview',
    userPoolCount: Number(snapshot?.userPoolCount ?? 0),
  };
  const svg = await renderAchievementAverageCardSvg({
    achievement: normalizedAchievement,
    snapshot: normalizedSnapshot,
    snapshotEntry,
  });

  return {
    achievementName: normalizedAchievement.name,
    image: renderTetrioSvgToPng(svg, 2),
    snapshotDateKey: normalizedSnapshot.dateKey,
    svg,
  };
}

async function ensureTodaySnapshot({ onProgress } = {}) {
  const currentKst = getKstDateInfo();
  const dateKey = getAchievementSnapshotDateInfo().dateKey;
  const state = await loadState();

  const existingSnapshot = state.snapshots?.[dateKey];
  if (existingSnapshot) {
    return existingSnapshot;
  }

  if (currentKst.hour < SNAPSHOT_ROLLOVER_HOUR_KST) {
    const waitLogKey = `${currentKst.dateKey}:${dateKey}`;
    if (lastPreRolloverWaitLogKey !== waitLogKey) {
      lastPreRolloverWaitLogKey = waitLogKey;
      console.log(
        `[TETR.IO ACH AVG] waiting for ${String(SNAPSHOT_ROLLOVER_HOUR_KST).padStart(2, '0')}:00 KST rollover target=${dateKey}`
      );
    }
    return null;
  }

  lastPreRolloverWaitLogKey = null;

  return refreshTetrioAchievementAverageSnapshot({
    force: true,
    dateKey,
    onProgress,
  });
}

async function refreshTetrioAchievementAverageSnapshot({ force = false, dateKey = null, onProgress } = {}) {
  if (snapshotBuildPromise) {
    return snapshotBuildPromise;
  }

  const now = Date.now();
  if (!force && now - lastBuildStartedAt < BUILD_COOLDOWN_MS) {
    const error = new Error('achievement average snapshot is on cooldown');
    error.code = 'TETRIO_ACHIEVEMENT_AVERAGE_COOLDOWN';
    throw error;
  }

  lastBuildStartedAt = now;
  snapshotBuildPromise = buildAndPersistSnapshot(dateKey ?? getAchievementSnapshotDateInfo().dateKey, onProgress)
    .finally(() => {
      snapshotBuildPromise = null;
    });

  return snapshotBuildPromise;
}

async function buildAndPersistSnapshot(dateKey, onProgress) {
  const catalog = await fetchTetrioAchievementCatalog();
  const catalogById = new Map(catalog.map((achievement) => [Number(achievement.k), normalizeAchievementInfo(achievement)]));
  const leagueUsers = getTetrioLeagueUsers();

  if (!Array.isArray(leagueUsers) || leagueUsers.length === 0) {
    const error = new Error('TETR.IO league cache is empty');
    error.code = 'TETRIO_ACHIEVEMENT_AVERAGE_NO_LEAGUE_USERS';
    throw error;
  }

  const sampledUsers = selectRankSamples(leagueUsers);
  console.log(
    `[TETR.IO ACH AVG] snapshot build started date=${dateKey} leagueUsers=${leagueUsers.length} sampled=${sampledUsers.length} concurrency=${Math.min(FETCH_CONCURRENCY, sampledUsers.length)}`
  );
  const accumulators = new Map();
  let cursor = 0;
  let processedUsers = 0;
  let failedUsers = 0;

  const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, sampledUsers.length) }, async () => {
    while (cursor < sampledUsers.length) {
      const currentIndex = cursor;
      cursor += 1;
      const sampledUser = sampledUsers[currentIndex];

      try {
        const achievements = await fetchUserAchievements(sampledUser.username);
        processedUsers += 1;
        mergeUserAchievementsIntoSnapshot(accumulators, achievements, catalogById, sampledUser.rank);
      } catch (error) {
        failedUsers += 1;
        console.error(`[TETR.IO ACH AVG] failed to fetch achievements for ${sampledUser.username}:`);
        console.error(error);
      }

      onProgress?.({
        completedUsers: processedUsers + failedUsers,
        failedUsers,
        processedUsers,
        sampledUsers: sampledUsers.length,
        totalUsers: leagueUsers.length,
        username: sampledUser.username,
      });
    }
  });

  await Promise.all(workers);

  const snapshot = finalizeSnapshot({
    accumulators,
    catalogById,
    createdAt: new Date().toISOString(),
    dateKey,
    failedUsers,
    leagueUsers,
    processedUsers,
    sampledUsers,
  });

  const state = await loadState();
  state.snapshots ??= {};
  state.snapshots[dateKey] = snapshot;
  state.latestDateKey = dateKey;
  pruneOldSnapshots(state, 7);
  await saveState();

  console.log(
    `[TETR.IO ACH AVG] snapshot complete date=${dateKey} processed=${processedUsers} failed=${failedUsers} sampled=${sampledUsers.length}`
  );

  return snapshot;
}

function createSnapshotProgressLogger() {
  let lastLoggedPercent = -1;
  let lastLoggedAt = 0;

  return ({ completedUsers = 0, failedUsers = 0, sampledUsers = 0 }) => {
    const completed = Number(completedUsers) || 0;
    const total = Number(sampledUsers) || 0;
    const percent = total > 0 ? Math.floor((completed / total) * 100) : 0;
    const now = Date.now();
    const shouldLog = completed === 1
      || completed >= total
      || percent >= lastLoggedPercent + 5
      || now - lastLoggedAt >= 60_000;

    if (!shouldLog) {
      return;
    }

    lastLoggedPercent = percent;
    lastLoggedAt = now;
    console.log(
      `[TETR.IO ACH AVG] progress completed=${completed}/${total} percent=${Math.min(100, percent)}% failed=${Number(failedUsers) || 0}`
    );
  };
}

function selectRankSamples(leagueUsers) {
  const byRank = new Map(LEAGUE_RANK_ORDER.map((rank) => [rank, []]));

  for (const user of leagueUsers) {
    const rank = normalizeLeagueRank(user?.rank);
    const username = String(user?.username ?? '').trim();

    if (!rank || !username) {
      continue;
    }

    if (!byRank.has(rank)) {
      byRank.set(rank, []);
    }

    byRank.get(rank).push({
      rank,
      username,
    });
  }

  const selected = [];

  for (const rank of LEAGUE_RANK_ORDER) {
    const users = byRank.get(rank) ?? [];
    if (users.length === 0) {
      continue;
    }

    const shuffled = users.slice();
    fisherYatesShuffle(shuffled);

    for (const user of shuffled.slice(0, Math.min(SAMPLE_SIZE, shuffled.length))) {
      selected.push(user);
    }
  }

  return selected;
}

async function fetchUserAchievements(username) {
  const url = `${API_BASE}/users/${encodeURIComponent(username)}/summaries`;

  for (let attempt = 0; attempt < FETCH_RETRY_LIMIT; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: REQUEST_HEADERS,
        signal: controller.signal,
      });

      if (response.status === 404) {
        return [];
      }

      if (!response.ok) {
        const error = new Error(`TETR.IO summaries request failed with ${response.status}`);
        error.status = response.status;
        throw error;
      }

      const payload = await response.json();
      return Array.isArray(payload?.data?.achievements)
        ? payload.data.achievements.filter((achievement) => !achievement?.stub && Number(achievement?.rank) !== 0)
        : [];
    } catch (error) {
      const shouldRetry = error?.name === 'AbortError'
        || [429, 500, 502, 503, 504].includes(Number(error?.status));

      if (!shouldRetry || attempt === FETCH_RETRY_LIMIT - 1) {
        throw error;
      }

      await sleep(300 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  return [];
}

function mergeUserAchievementsIntoSnapshot(accumulators, achievements, catalogById, sampledRank) {
  const foundAchievementIds = new Set();

  for (const achievement of achievements) {
    const id = Number(achievement?.k);
    if (!Number.isSafeInteger(id) || id < 1) {
      continue;
    }

    foundAchievementIds.add(id);
    let accumulator = accumulators.get(id);
    if (!accumulator) {
      accumulator = {
        info: normalizeAchievementInfo(achievement ?? catalogById.get(id)),
        ranks: new Map(),
      };
      accumulators.set(id, accumulator);
    }

    let rankAccumulator = accumulator.ranks.get(sampledRank);
    if (!rankAccumulator) {
      rankAccumulator = createRankAccumulator();
      accumulator.ranks.set(sampledRank, rankAccumulator);
    }

    rankAccumulator.observedCount += 1;
    const value = toFiniteNumber(achievement?.v);
    if (Number.isFinite(value)) {
      rankAccumulator.valueSum += value;
      rankAccumulator.valueCount += 1;
    }
  }

  for (const [id, accumulator] of accumulators.entries()) {
    if (!foundAchievementIds.has(id)) {
      continue;
    }

    if (!accumulator.ranks.has(sampledRank)) {
      accumulator.ranks.set(sampledRank, createRankAccumulator());
    }
  }
}

function createRankAccumulator() {
  return {
    observedCount: 0,
    valueCount: 0,
    valueSum: 0,
  };
}

function finalizeSnapshot({
  accumulators,
  catalogById,
  createdAt,
  dateKey,
  failedUsers,
  leagueUsers,
  processedUsers,
  sampledUsers,
}) {
  const sampledCountByRank = getSampledCountByRank(sampledUsers);
  const achievements = {};

  for (const [id, accumulator] of [...accumulators.entries()].sort((left, right) => left[0] - right[0])) {
    const catalogEntry = catalogById.get(id);
    const entry = {
      ...normalizeAchievementInfo(accumulator.info ?? catalogEntry),
      ranks: {},
    };

    for (const rank of LEAGUE_RANK_ORDER) {
      const sampledCount = sampledCountByRank.get(rank) ?? 0;
      if (sampledCount === 0) {
        continue;
      }

      const rankAccumulator = accumulator.ranks.get(rank) ?? createRankAccumulator();
      entry.ranks[rank] = {
        averageValue: rankAccumulator.valueCount > 0
          ? rankAccumulator.valueSum / rankAccumulator.valueCount
          : null,
        completionRate: sampledCount > 0
          ? rankAccumulator.observedCount / sampledCount
          : null,
        sampledCount,
        solvedCount: rankAccumulator.observedCount,
      };
    }

    achievements[String(id)] = entry;
  }

  return {
    achievements,
    createdAt,
    dateKey,
    failedUsers,
    processedUsers,
    sampleSize: SAMPLE_SIZE,
    sampledUsers: sampledUsers.length,
    source: 'league-rank-sample',
    userPoolCount: leagueUsers.length,
  };
}

function getSampledCountByRank(sampledUsers) {
  const result = new Map();

  for (const { rank } of sampledUsers) {
    result.set(rank, (result.get(rank) ?? 0) + 1);
  }

  return result;
}

async function renderAchievementAverageCardSvg({ achievement, snapshot, snapshotEntry }) {
  const visibleRanks = LEAGUE_RANK_ORDER.filter((rank) => Number(snapshotEntry?.ranks?.[rank]?.sampledCount ?? 0) > 0);
  const width = 540;
  const rowHeight = 50;
  const firstRowY = 86;
  const lastRowBottom = visibleRanks.length > 0
    ? firstRowY + (visibleRanks.length - 1) * rowHeight + 47
    : 70;
  const height = Math.max(200, lastRowBottom + 48);
  const fontDataUri = await getTetrioHunDinFontDataUri();
  const maxAverageValue = Math.max(
    0,
    ...visibleRanks.map((rank) => Math.abs(Number(snapshotEntry?.ranks?.[rank]?.averageValue)))
      .filter(Number.isFinite)
  );
  const rankIconEntries = await Promise.all(visibleRanks.map(async (rank) => [
    rank,
    await fetchTetrioLeagueRankIconDataUri(rank),
  ]));
  const rankIcons = new Map(rankIconEntries);
  const rankGradientDefs = visibleRanks.map((rank, index) => {
    const palette = RANK_PALETTES.get(rank) ?? RANK_PALETTES.get('z');
    return `<linearGradient id="rank-row-${index}" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${palette.secondary}" stop-opacity="0.92"/>
      <stop offset="52%" stop-color="${palette.primary}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${palette.secondary}" stop-opacity="0.88"/>
    </linearGradient>`;
  }).join('\n    ');
  const title = String(achievement?.name ?? '').trim() || 'Achievement';
  const updatedLine = `Updated ${formatSnapshotDate(snapshot)}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#26272d"/>
      <stop offset="1" stop-color="#1f2026"/>
    </linearGradient>
    ${rankGradientDefs}
  </defs>
  <style>
    ${renderTetrioHunDinFontFace(fontDataUri)}
    text { font-family: ${tetrioFontFamily}; }
    .title { font-family: "Noto Sans CJK KR", Arial; font-size: 27px; font-weight: 800; fill: #edf1ef; }
    .main { font-size: 29px; font-weight: 900; fill: #edf1ef; }
    .meta { font-family: "Noto Sans CJK KR", Arial; font-size: 12px; font-weight: 700; fill: #d6d8de; }
    .muted { font-family: "Noto Sans CJK KR", Arial; font-size: 11px; font-weight: 700; fill: #a8acb8; }
  </style>
  <rect x="0" y="0" width="${width}" height="${height}" rx="14" fill="url(#bg)"/>
  <rect x="4" y="4" width="${width - 8}" height="${height - 8}" rx="12" fill="none" stroke="#2fd0a3" stroke-opacity="0.45" stroke-width="2"/>
  <rect x="18" y="14" width="${width - 36}" height="56" rx="10" fill="#2a2b33" stroke="#454951" stroke-opacity="0.9" stroke-width="1"/>
  <text x="${width / 2}" y="51" text-anchor="middle" class="title">${escapeXml(title)}</text>
  ${visibleRanks.map((rank, index) => renderLeagueRankAverageRow({
    achievement,
    rank,
    rowIndex: index,
    snapshotEntry,
    rankIconDataUri: rankIcons.get(rank),
    gradientId: `rank-row-${index}`,
    lineWidth: width - 36,
    maxAverageValue,
    y: firstRowY + index * rowHeight,
  })).join('\n  ')}
  <text x="18" y="${height - 22}" class="meta">${escapeXml(updatedLine)}</text>
</svg>`;
}

function renderLeagueRankAverageRow({ achievement, rank, rowIndex, snapshotEntry, rankIconDataUri, gradientId, lineWidth, maxAverageValue, y }) {
  const palette = RANK_PALETTES.get(rank) ?? RANK_PALETTES.get('z');
  const rankEntry = snapshotEntry?.ranks?.[rank] ?? null;
  const averageValueText = formatAverageAchievementValue(achievement, rankEntry?.averageValue);
  const averageValue = Math.abs(Number(rankEntry?.averageValue));
  const valueRatio = maxAverageValue > 0 && Number.isFinite(averageValue)
    ? Math.min(1, averageValue / maxAverageValue)
    : 0;
  const barWidth = Math.max(8, 420 * valueRatio);
  const rankMarkup = rankIconDataUri
    ? `<image href="${rankIconDataUri}" x="0" y="0" width="64" height="46" preserveAspectRatio="xMinYMid meet"/>`
    : `<text x="0" y="32" fill="${palette.primary}" class="main">${escapeXml(RANK_LABELS.get(rank) ?? rank.toUpperCase())}</text>`;

  return `<g transform="translate(18 ${y})">
    ${rankMarkup}
    <rect x="76" y="2" width="${barWidth}" height="40" rx="9" fill="url(#${gradientId})" stroke="${palette.primary}" stroke-opacity="0.28" stroke-width="1"/>
    <text x="90" y="32" class="main">${renderTetrioNumericTextMarkup(averageValueText)}</text>
    <line x1="0" y1="47" x2="${lineWidth}" y2="47" stroke="#7a808a" stroke-opacity="0.24" stroke-width="1"/>
  </g>`;
}

function formatAverageAchievementValue(achievement, averageValue) {
  const vt = Number(achievement?.vt);
  const deci = Math.max(0, Math.min(3, Number(achievement?.deci) || 0));

  if (!Number.isFinite(averageValue)) {
    return '-';
  }

  if (vt === 2 || vt === 3) {
    return formatAchievementTime(Math.abs(averageValue));
  }

  if (vt === 4) {
    return formatAchievementNumber(Math.abs(averageValue), Math.max(deci, 1));
  }

  return formatAchievementNumber(Math.abs(averageValue), deci);
}

function normalizeAchievementInfo(source) {
  const value = source ?? {};
  return {
    art: Number.isFinite(Number(value?.art)) ? Number(value.art) : 0,
    deci: Number.isFinite(Number(value?.deci)) ? Number(value.deci) : 0,
    desc: String(value?.desc ?? '').trim(),
    k: Number(value?.k),
    n: String(value?.n ?? value?.name ?? '').trim(),
    name: String(value?.name ?? '').trim(),
    object: String(value?.object ?? '').trim(),
    rt: Number.isFinite(Number(value?.rt)) ? Number(value.rt) : 0,
    vt: Number.isFinite(Number(value?.vt)) ? Number(value.vt) : 0,
  };
}

function formatAchievementNumber(value, precision = 0) {
  return Number(value).toLocaleString('en-US', {
    maximumFractionDigits: precision,
    minimumFractionDigits: precision,
  });
}

function formatAchievementTime(milliseconds) {
  const totalMilliseconds = Math.max(0, Number(milliseconds) || 0);
  const totalSeconds = totalMilliseconds / 1000;

  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
  }

  return totalSeconds.toFixed(3);
}

function getLatestSnapshot(state) {
  const latestDateKey = state?.latestDateKey;
  if (latestDateKey && state?.snapshots?.[latestDateKey]) {
    return state.snapshots[latestDateKey];
  }

  const dateKeys = Object.keys(state?.snapshots ?? {}).sort();
  if (dateKeys.length === 0) {
    return null;
  }

  return state.snapshots[dateKeys.at(-1)];
}

function pruneOldSnapshots(state, keepCount) {
  const dateKeys = Object.keys(state.snapshots ?? {}).sort();
  if (dateKeys.length <= keepCount) {
    return;
  }

  for (const dateKey of dateKeys.slice(0, dateKeys.length - keepCount)) {
    delete state.snapshots[dateKey];
  }

  state.latestDateKey = Object.keys(state.snapshots).sort().at(-1) ?? null;
}

async function loadState() {
  if (stateCache) {
    return stateCache;
  }

  if (stateLoadPromise) {
    return stateLoadPromise;
  }

  stateLoadPromise = (async () => {
    try {
      const text = await readFile(DATA_FILE, 'utf8');
      const parsed = JSON.parse(text);
      stateCache = normalizeState(parsed);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.error('[TETR.IO ACH AVG] failed to read state, creating a fresh file:');
        console.error(error);
      }
      stateCache = createEmptyState();
    } finally {
      stateLoadPromise = null;
    }

    return stateCache;
  })();

  return stateLoadPromise;
}

async function saveState() {
  if (!stateCache) {
    return;
  }

  stateSaveQueue = stateSaveQueue.then(async () => {
    await mkdir(dirname(DATA_FILE), { recursive: true });
    await writeFile(TEMP_FILE, JSON.stringify(stateCache, null, 2));
    await rename(TEMP_FILE, DATA_FILE);
  });

  return stateSaveQueue;
}

function normalizeState(value) {
  const state = value && typeof value === 'object' ? value : {};
  return {
    latestDateKey: typeof state.latestDateKey === 'string' ? state.latestDateKey : null,
    snapshots: state.snapshots && typeof state.snapshots === 'object'
      ? state.snapshots
      : {},
  };
}

function createEmptyState() {
  return {
    latestDateKey: null,
    snapshots: {},
  };
}

function findBestAchievementMatch(achievements = [], query) {
  const normalizedQuery = normalizeAchievementSearchText(query);
  if (!normalizedQuery) {
    return null;
  }

  const exactName = achievements.find((achievement) =>
    normalizeAchievementSearchText(achievement?.name) === normalizedQuery);
  if (exactName) {
    return exactName;
  }

  const exactInternal = achievements.find((achievement) =>
    normalizeAchievementSearchText(achievement?.n) === normalizedQuery);
  if (exactInternal) {
    return exactInternal;
  }

  const prefixName = achievements.find((achievement) =>
    normalizeAchievementSearchText(achievement?.name).startsWith(normalizedQuery));
  if (prefixName) {
    return prefixName;
  }

  return achievements.find((achievement) =>
    normalizeAchievementSearchText(achievement?.name).includes(normalizedQuery)
    || normalizeAchievementSearchText(achievement?.n).includes(normalizedQuery)
  ) ?? null;
}

function normalizeAchievementSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim()
    .replaceAll(/\s+/g, ' ');
}

function normalizeLeagueRank(value) {
  const rank = String(value ?? '').trim().toLowerCase();
  return LEAGUE_RANK_ORDER.includes(rank) ? rank : null;
}

function fisherYatesShuffle(values) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [values[index], values[randomIndex]] = [values[randomIndex], values[index]];
  }
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getKstDateInfo(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    dateKey: kst.toISOString().slice(0, 10),
    hour: kst.getUTCHours(),
    minute: kst.getUTCMinutes(),
  };
}

function getAchievementSnapshotDateInfo(date = new Date()) {
  const current = getKstDateInfo(date);
  if (current.hour >= SNAPSHOT_ROLLOVER_HOUR_KST) {
    return current;
  }

  const previousDate = new Date(`${current.dateKey}T00:00:00.000Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);

  return {
    ...current,
    dateKey: previousDate.toISOString().slice(0, 10),
  };
}

function formatSnapshotDate(snapshot) {
  const dateKey = String(snapshot?.dateKey ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return dateKey;
  }

  const createdAt = new Date(snapshot?.createdAt ?? 0);
  if (Number.isNaN(createdAt.getTime())) {
    return '-';
  }

  return getKstDateInfo(createdAt).dateKey;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
