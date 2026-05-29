import { calculateTetrioStats } from './tetrio-stats-calculations.js';

const tetrioApiBaseUrl = 'https://ch.tetr.io/api';
const tetrioHeaders = {
  'User-Agent': 'discord-bot/1.0 TETR.IO stats card',
  'X-Session-ID': 'discord-bot-tetrio-stats',
};

export async function fetchTetrioStatsCardData(username) {
  const normalizedUsername = normalizeTetrioUsername(username);

  if (!normalizedUsername) {
    const error = new Error('TETR.IO username is required');
    error.status = 400;
    throw error;
  }

  const [userResponse, summariesResponse] = await Promise.all([
    fetchTetrioJson(`/users/${encodeURIComponent(normalizedUsername)}`),
    fetchTetrioJson(`/users/${encodeURIComponent(normalizedUsername)}/summaries`),
  ]);
  const user = userResponse.data;
  const league = summariesResponse.data?.league;

  if (!league || !hasFiniteLeagueStat(league.apm) || !hasFiniteLeagueStat(league.pps) || !hasFiniteLeagueStat(league.vs)) {
    const error = new Error('TETRA LEAGUE stats are unavailable');
    error.code = 'NO_LEAGUE_STATS';
    error.status = 404;
    throw error;
  }

  const calculatedStats = calculateTetrioStats({
    apm: league.apm,
    pps: league.pps,
    vs: league.vs,
    rd: league.rd,
    wins: league.gameswon ?? league.gamesWon ?? league.wins ?? user.gameswon,
  });

  return {
    username: user.username ?? normalizedUsername,
    stats: {
      ...calculatedStats,
      rank: league.rank,
      tr: league.tr,
      glicko: league.glicko,
      rd: league.rd,
    },
  };
}

function hasFiniteLeagueStat(value) {
  return value !== null
    && value !== undefined
    && value !== ''
    && Number.isFinite(Number(value));
}

function normalizeTetrioUsername(input) {
  const trimmed = String(input ?? '').trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/^\/u\/([^/]+)/i);
    if (match) {
      return decodeURIComponent(match[1]).trim().toLowerCase();
    }
  } catch {
    // Plain usernames are expected most of the time.
  }

  return trimmed.replace(/^@+/, '').toLowerCase();
}

async function fetchTetrioJson(path) {
  const response = await fetch(`${tetrioApiBaseUrl}${path}`, {
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
