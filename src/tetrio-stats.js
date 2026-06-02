import {
  calculateTetraRating,
  calculateTetrioStats,
} from './tetrio-stats-calculations.js';

const tetrioApiBaseUrl = 'https://ch.tetr.io/api';
const tetrioHeaders = {
  'User-Agent': 'discord-bot/1.0 TETR.IO stats card',
  'X-Session-ID': 'discord-bot-tetrio-stats',
};
const leagueRankOrder = [
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
];

export async function fetchTetrioStatsCardData(username) {
  const normalizedUsername = normalizeTetrioUsername(username);

  if (!normalizedUsername) {
    const error = new Error('TETR.IO username is required');
    error.status = 400;
    throw error;
  }

  const [userResponse, summariesResponse, rankCutResponse] = await Promise.all([
    fetchTetrioJson(`/users/${encodeURIComponent(normalizedUsername)}`),
    fetchTetrioJson(`/users/${encodeURIComponent(normalizedUsername)}/summaries`),
    fetchTetrioJson('/labs/league_ranks').catch(() => null),
  ]);
  const user = userResponse.data;
  const league = summariesResponse.data?.league;
  const displayUsername = user.username ?? normalizedUsername;

  if (isBannedTetrioUser(user)) {
    const error = new Error('TETR.IO user is banned');
    error.code = 'BANNED_TETRIO_USER';
    error.status = 403;
    error.username = displayUsername;
    throw error;
  }

  if (!league || !hasFiniteLeagueStat(league.apm) || !hasFiniteLeagueStat(league.pps) || !hasFiniteLeagueStat(league.vs)) {
    const error = new Error('TETRA LEAGUE stats are unavailable');
    error.code = 'NO_LEAGUE_STATS';
    error.status = 404;
    throw error;
  }

  const wins = league.gameswon ?? league.gamesWon ?? league.wins ?? user.gameswon;
  const calculatedStats = calculateTetrioStats({
    apm: league.apm,
    pps: league.pps,
    vs: league.vs,
    rd: league.rd,
    wins,
  });

  return {
    username: displayUsername,
    stats: {
      ...calculatedStats,
      rank: league.rank,
      standing: league.standing,
      tr: league.tr,
      glicko: league.glicko,
      rd: league.rd,
      wins,
      ...buildRankMotionVariables({ ...league, wins }, rankCutResponse?.data?.data),
    },
  };
}

function buildRankMotionVariables(tlData, rankCutData) {
  const rank = normalizeLeagueRank(tlData?.rank);
  const rankIndex = leagueRankOrder.indexOf(rank);
  const nextRank = rankIndex > 0 ? leagueRankOrder[rankIndex - 1] : null;
  const previousRank = rankIndex >= 0 ? leagueRankOrder[rankIndex] : null;
  const nextRankCutoff = getRankCutoff(rankCutData, nextRank);
  const previousRankCutoff = getRankCutoff(rankCutData, previousRank);
  const currentGlicko = toFiniteNumber(tlData?.glicko);
  const currentRd = toFiniteNumber(tlData?.rd);
  const currentWins = firstFiniteNumber(tlData?.gameswon, tlData?.gamesWon, tlData?.wins, 18);
  const nextRankTrCutoff = getTrCutoff(nextRankCutoff);
  const previousRankTrCutoff = getTrCutoff(previousRankCutoff);
  const nextRankGlickoCutoff = firstFiniteNumber(
    getGlickoCutoff(nextRankCutoff),
    estimateGlickoCutoffFromTr(nextRankTrCutoff, currentRd, currentWins),
  );
  const previousRankGlickoCutoff = firstFiniteNumber(
    getGlickoCutoff(previousRankCutoff),
    estimateGlickoCutoffFromTr(previousRankTrCutoff, currentRd, currentWins),
  );
  const glickoWinDelta = calculateGlickoWinDelta(currentGlicko, currentRd);

  return {
    promote: formatRankMotionValue(
      safeDivide(subtractFinite(nextRankGlickoCutoff, currentGlicko), glickoWinDelta),
      'win',
    ),
    demote: formatRankMotionValue(
      safeDivide(subtractFinite(currentGlicko, previousRankGlickoCutoff), glickoWinDelta),
      'lose',
    ),
    currentGlicko,
    currentRd,
    currentTr: toFiniteNumber(tlData?.tr),
    currentStanding: toFiniteNumber(tlData?.standing),
    nextRank,
    previousRank,
    nextRankGlickoCutoff,
    previousRankGlickoCutoff,
    nextRankTrCutoff,
    previousRankTrCutoff,
    glickoWinDelta,
  };
}

function estimateGlickoCutoffFromTr(trCutoff, rd, wins) {
  const targetTr = toFiniteNumber(trCutoff);
  const normalizedRd = toFiniteNumber(rd);
  const normalizedWins = firstFiniteNumber(wins, 18);

  if (![targetTr, normalizedRd, normalizedWins].every(Number.isFinite)) {
    return null;
  }

  let low = 0;
  let high = 4000;
  const lowTr = calculateTetraRating(low, normalizedRd, normalizedWins);
  const highTr = calculateTetraRating(high, normalizedRd, normalizedWins);

  if (!Number.isFinite(lowTr) || !Number.isFinite(highTr) || targetTr < lowTr || targetTr > highTr) {
    return null;
  }

  for (let index = 0; index < 64; index += 1) {
    const mid = (low + high) / 2;
    const midTr = calculateTetraRating(mid, normalizedRd, normalizedWins);

    if (!Number.isFinite(midTr)) {
      return null;
    }

    if (midTr < targetTr) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
}

function calculateGlickoWinDelta(glicko, rd) {
  const result = rateGlicko2(glicko, rd, 0.06, [[glicko, rd, 1]], {});
  const nextGlicko = Array.isArray(result) ? toFiniteNumber(result[0]) : null;
  const currentGlicko = toFiniteNumber(glicko);

  return subtractFinite(nextGlicko, currentGlicko);
}

function rateGlicko2(rating, rd, volatility, matches, options = {}) {
  const normalizedRating = toFiniteNumber(rating);
  const normalizedRd = toFiniteNumber(rd);
  const normalizedVolatility = toFiniteNumber(volatility);
  const tau = firstFiniteNumber(options.tau, 0.5);
  const epsilon = firstFiniteNumber(options.epsilon, 0.000001);
  const scale = 173.7178;

  if (![normalizedRating, normalizedRd, normalizedVolatility, tau, epsilon].every(Number.isFinite)) {
    return [null, null, null];
  }

  const mu = (normalizedRating - 1500) / scale;
  const phi = normalizedRd / scale;
  const normalizedMatches = Array.isArray(matches) ? matches : [];

  if (normalizedMatches.length === 0) {
    const phiStar = Math.sqrt(phi ** 2 + normalizedVolatility ** 2);
    return [1500 + scale * mu, scale * phiStar, normalizedVolatility];
  }

  const matchStats = normalizedMatches
    .map(([opponentRating, opponentRd, score]) => {
      const opponentMu = (toFiniteNumber(opponentRating) - 1500) / scale;
      const opponentPhi = toFiniteNumber(opponentRd) / scale;
      const normalizedScore = toFiniteNumber(score);

      if (![opponentMu, opponentPhi, normalizedScore].every(Number.isFinite)) {
        return null;
      }

      const g = 1 / Math.sqrt(1 + (3 * opponentPhi ** 2) / Math.PI ** 2);
      const expected = 1 / (1 + Math.exp(-g * (mu - opponentMu)));
      return { g, expected, score: normalizedScore };
    })
    .filter(Boolean);

  if (matchStats.length === 0) {
    return [normalizedRating, normalizedRd, normalizedVolatility];
  }

  const varianceDenominator = matchStats.reduce(
    (sum, match) => sum + match.g ** 2 * match.expected * (1 - match.expected),
    0,
  );
  if (varianceDenominator <= 0) {
    return [normalizedRating, normalizedRd, normalizedVolatility];
  }

  const variance = 1 / varianceDenominator;
  const delta = variance * matchStats.reduce(
    (sum, match) => sum + match.g * (match.score - match.expected),
    0,
  );
  const nextVolatility = calculateNextGlicko2Volatility(
    phi,
    normalizedVolatility,
    delta,
    variance,
    tau,
    epsilon,
  );
  const phiStar = Math.sqrt(phi ** 2 + nextVolatility ** 2);
  const nextPhi = 1 / Math.sqrt((1 / phiStar ** 2) + (1 / variance));
  const nextMu = mu + nextPhi ** 2 * matchStats.reduce(
    (sum, match) => sum + match.g * (match.score - match.expected),
    0,
  );

  return [
    1500 + scale * nextMu,
    scale * nextPhi,
    nextVolatility,
  ];
}

function calculateNextGlicko2Volatility(phi, volatility, delta, variance, tau, epsilon) {
  const alpha = Math.log(volatility ** 2);
  const phiSquared = phi ** 2;
  const deltaSquared = delta ** 2;

  const f = (x) => {
    const expX = Math.exp(x);
    return (
      (expX * (deltaSquared - phiSquared - variance - expX))
      / (2 * (phiSquared + variance + expX) ** 2)
    ) - ((x - alpha) / tau ** 2);
  };

  let a = alpha;
  let b;

  if (deltaSquared > phiSquared + variance) {
    b = Math.log(deltaSquared - phiSquared - variance);
  } else {
    let k = 1;
    while (f(alpha - k * tau) < 0) {
      k += 1;
    }
    b = alpha - k * tau;
  }

  let fa = f(a);
  let fb = f(b);

  while (Math.abs(b - a) > epsilon) {
    const c = a + ((a - b) * fa) / (fb - fa);
    const fc = f(c);

    if (fc * fb <= 0) {
      a = b;
      fa = fb;
    } else {
      fa /= 2;
    }

    b = c;
    fb = fc;
  }

  return Math.exp(a / 2);
}

function formatRankMotionValue(value, suffix) {
  const number = toFiniteNumber(value);
  if (!Number.isFinite(number)) {
    return '-';
  }

  return `${number.toFixed(2)} ${suffix}`;
}

function normalizeLeagueRank(value) {
  return String(value ?? '').trim().toLowerCase();
}

function getRankCutoff(rankCutData, rank) {
  if (!rank || !rankCutData || typeof rankCutData !== 'object') {
    return null;
  }

  return rankCutData[rank] ?? null;
}

function getGlickoCutoff(cutoff) {
  return firstFiniteNumber(
    cutoff?.glicko,
    cutoff?.glickoCutoff,
    cutoff?.glicko_cutoff,
  );
}

function getTrCutoff(cutoff) {
  return firstFiniteNumber(
    cutoff?.tr,
    cutoff?.trCutoff,
    cutoff?.tr_cutoff,
  );
}

function isBannedTetrioUser(user) {
  return String(user?.role ?? '').toLowerCase() === 'banned';
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

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = toFiniteNumber(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }

  return null;
}

function subtractFinite(a, b) {
  const first = toFiniteNumber(a);
  const second = toFiniteNumber(b);

  return Number.isFinite(first) && Number.isFinite(second)
    ? first - second
    : null;
}

function safeDivide(numerator, denominator) {
  const normalizedNumerator = toFiniteNumber(numerator);
  const normalizedDenominator = toFiniteNumber(denominator);

  return Number.isFinite(normalizedNumerator)
    && Number.isFinite(normalizedDenominator)
    && normalizedDenominator !== 0
    ? normalizedNumerator / normalizedDenominator
    : null;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
