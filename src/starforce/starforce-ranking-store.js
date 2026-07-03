import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const STARFORCE_RANKING_STORE_PATH =
  fileURLToPath(new URL('../../data/starforce-rankings.json', import.meta.url));
const STARFORCE_RANKING_STORE_TEMP_PATH =
  fileURLToPath(new URL('../../data/starforce-rankings.tmp.json', import.meta.url));
const STARFORCE_RANKING_LIMIT = 50;

let loaded = false;
let rankingEntries = [];
let savePromise = Promise.resolve();

export async function ensureStarforceRankingsLoaded() {
  if (loaded) {
    return;
  }

  await mkdir(fileURLToPath(new URL('../../data/', import.meta.url)), { recursive: true });

  try {
    const raw = await readFile(STARFORCE_RANKING_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    rankingEntries = Array.isArray(parsed)
      ? parsed.map(sanitizeRankingEntry).filter(Boolean)
      : [];
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('[STARFORCE] failed to load rankings:');
      console.error(error);
    }
    rankingEntries = [];
  }

  loaded = true;
}

export async function addStarforceRankingEntry(entry) {
  await ensureStarforceRankingsLoaded();

  const sanitized = sanitizeRankingEntry(entry);
  if (!sanitized) {
    return;
  }

  rankingEntries.push(sanitized);
  await persistStarforceRankings();
}

export async function getStarforceLeaderboard(level, limit = STARFORCE_RANKING_LIMIT) {
  await ensureStarforceRankingsLoaded();

  return rankingEntries
    .filter((entry) => Number(entry.level) === Number(level))
    .sort(compareRankingEntries)
    .slice(0, Math.max(1, Math.min(Number(limit) || STARFORCE_RANKING_LIMIT, STARFORCE_RANKING_LIMIT)));
}

async function persistStarforceRankings() {
  savePromise = savePromise
    .catch(() => {
      // Keep save queue alive after a failed write.
    })
    .then(async () => {
      const payload = JSON.stringify(rankingEntries, null, 2);
      await writeFile(STARFORCE_RANKING_STORE_TEMP_PATH, payload, 'utf8');
      await rename(STARFORCE_RANKING_STORE_TEMP_PATH, STARFORCE_RANKING_STORE_PATH);
    });

  await savePromise;
}

function sanitizeRankingEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const level = Number(entry.level);
  const star = Number(entry.star);
  const mesosUsed = Number(entry.mesosUsed);
  const attempts = Number(entry.attempts);
  const ownerUserId = String(entry.ownerUserId ?? '').trim();
  const nickname = String(entry.nickname ?? '').trim();
  const finishedAtMs = Number(entry.finishedAtMs ?? Date.now());

  if (!Number.isFinite(level) || !Number.isFinite(star) || !Number.isFinite(mesosUsed) || !Number.isFinite(attempts)) {
    return null;
  }

  if (!ownerUserId || !nickname) {
    return null;
  }

  return {
    ownerUserId,
    nickname,
    level,
    star,
    mesosUsed,
    attempts,
    finishedAtMs,
  };
}

function compareRankingEntries(left, right) {
  if (right.star !== left.star) {
    return right.star - left.star;
  }

  if (left.mesosUsed !== right.mesosUsed) {
    return left.mesosUsed - right.mesosUsed;
  }

  if (left.attempts !== right.attempts) {
    return left.attempts - right.attempts;
  }

  return left.finishedAtMs - right.finishedAtMs;
}
