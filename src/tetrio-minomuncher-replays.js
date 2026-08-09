import { randomUUID } from 'node:crypto';

const tetrioApiBaseUrl = process.env.TETRIO_API_BASE_URL || 'https://ch.tetr.io/api';
const minomuncherReplayApiBaseUrl = process.env.MINOMUNCHER_REPLAY_API_BASE_URL || 'https://inoue.szy.lol/api/replay';
const minomuncherRecentReplayTargetCount = normalizeInteger(
  process.env.MINOMUNCHER_RECENT_REPLAY_TARGET_COUNT,
  10,
  1,
  10,
);
const minomuncherRecentReplayCandidateCount = normalizeInteger(
  process.env.MINOMUNCHER_RECENT_REPLAY_CANDIDATE_COUNT,
  18,
  minomuncherRecentReplayTargetCount,
  20,
);
const minomuncherRecentReplayFetchConcurrency = normalizeInteger(
  process.env.MINOMUNCHER_RECENT_REPLAY_FETCH_CONCURRENCY,
  2,
  1,
  3,
);
const minomuncherRecentReplayTimeoutMs = normalizeInteger(
  process.env.MINOMUNCHER_RECENT_REPLAY_TIMEOUT_MS,
  10_000,
  1_000,
  60_000,
);
const tetrioHeaders = {
  'User-Agent': 'discord-bot/1.0 TETR.IO minomuncher replay fetcher',
};

export {
  minomuncherReplayApiBaseUrl,
  minomuncherRecentReplayCandidateCount,
  minomuncherRecentReplayFetchConcurrency,
  minomuncherRecentReplayTargetCount,
  minomuncherRecentReplayTimeoutMs,
};

export async function fetchRecentTetrioLeagueReplayFiles(username, options = {}) {
  const normalizedUsername = normalizeTetrioUsername(username);
  if (!normalizedUsername) {
    const error = new Error('TETR.IO username is required');
    error.status = 400;
    throw error;
  }

  const targetCount = normalizeInteger(
    options.targetCount,
    minomuncherRecentReplayTargetCount,
    1,
    10,
  );
  const candidateCount = normalizeInteger(
    options.candidateCount,
    Math.max(targetCount, minomuncherRecentReplayCandidateCount),
    targetCount,
    20,
  );
  const concurrency = normalizeInteger(
    options.concurrency,
    minomuncherRecentReplayFetchConcurrency,
    1,
    3,
  );
  const timeoutMs = normalizeInteger(
    options.timeoutMs,
    minomuncherRecentReplayTimeoutMs,
    1_000,
    60_000,
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch implementation is required');
  }

  const entries = await fetchRecentLeagueEntries(normalizedUsername, candidateCount, {
    fetchImpl,
    tetrioApiBaseUrl: options.tetrioApiBaseUrl ?? tetrioApiBaseUrl,
  });
  const replayCandidates = extractReplayCandidates(entries).slice(0, candidateCount);
  const downloadResults = await mapWithConcurrency(
    replayCandidates,
    concurrency,
    (candidate) => downloadReplayCandidate(candidate, {
      fetchImpl,
      replayApiBaseUrl: options.replayApiBaseUrl ?? minomuncherReplayApiBaseUrl,
      timeoutMs,
      username: normalizedUsername,
    }),
  );
  const successfulDownloads = downloadResults
    .filter((result) => result.ok)
    .sort(compareReplayDownloads)
    .slice(0, targetCount);
  const failedDownloads = downloadResults.filter((result) => !result.ok);

  return {
    username: normalizedUsername,
    targetCount,
    candidateCount,
    recentMatchCount: entries.length,
    replayCandidateCount: replayCandidates.length,
    replays: successfulDownloads.map((result, index) => ({
      name: formatReplayFileName(normalizedUsername, index, result.replayId),
      content: result.content,
      replayId: result.replayId,
      playedAt: result.playedAt,
    })),
    failures: failedDownloads.map((result) => ({
      replayId: result.replayId,
      playedAt: result.playedAt,
      reason: result.reason,
      status: result.status ?? null,
    })),
  };
}

async function fetchRecentLeagueEntries(username, limit, options) {
  const sessionId = createTetrioApiSessionId('minomuncher-recent');
  const fallbackSessionId = createTetrioApiSessionId('minomuncher-recent-fallback');
  const [primaryEntries, fallbackEntries] = await Promise.all([
    fetchLeagueRecentEntriesSnapshot(username, limit, sessionId, options),
    fetchLeagueRecentEntriesSnapshot(username, limit, fallbackSessionId, options),
  ]);

  return mergeLeagueRecentEntries([primaryEntries, fallbackEntries], limit);
}

async function fetchLeagueRecentEntriesSnapshot(username, limit, sessionId, options) {
  const searchParams = new URLSearchParams({ limit: String(limit) });
  const response = await fetchTetrioJson(
    `/users/${encodeURIComponent(username)}/records/league/recent?${searchParams.toString()}`,
    {
      fetchImpl: options.fetchImpl,
      sessionId,
      tetrioApiBaseUrl: options.tetrioApiBaseUrl,
    },
  );

  return Array.isArray(response.data?.entries)
    ? response.data.entries
    : [];
}

function extractReplayCandidates(entries) {
  const candidates = [];
  const seenReplayIds = new Set();

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const replayId = normalizeReplayId(entry?.replayid);
    if (!replayId || seenReplayIds.has(replayId)) {
      continue;
    }

    seenReplayIds.add(replayId);
    candidates.push({
      replayId,
      playedAt: normalizeTimestamp(entry?.ts),
      sourceIndex: index,
    });
  }

  return candidates.sort(compareReplayCandidates);
}

async function downloadReplayCandidate(candidate, options) {
  const url = `${options.replayApiBaseUrl.replace(/\/+$/, '')}/${encodeURIComponent(candidate.replayId)}`;

  try {
    const response = await fetchWithTimeout(url, {
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      headers: tetrioHeaders,
    });

    if (response.status === 404) {
      return buildReplayFailure(candidate, 'not_found', 404);
    }

    if (response.status === 429) {
      return buildReplayFailure(candidate, 'rate_limited', 429);
    }

    if (response.status >= 500) {
      return buildReplayFailure(candidate, 'server_error', response.status);
    }

    if (!response.ok) {
      return buildReplayFailure(candidate, 'http_error', response.status);
    }

    const content = await response.text();
    if (!isLikelyReplayContent(content)) {
      return buildReplayFailure(candidate, 'invalid_content', response.status);
    }

    return {
      ok: true,
      replayId: candidate.replayId,
      playedAt: candidate.playedAt,
      sourceIndex: candidate.sourceIndex,
      content,
    };
  } catch (error) {
    if (isTimeoutError(error)) {
      return buildReplayFailure(candidate, 'timeout');
    }

    return buildReplayFailure(candidate, 'network_error');
  }
}

function compareReplayCandidates(left, right) {
  const timeDelta = (right.playedAt ?? 0) - (left.playedAt ?? 0);
  if (timeDelta !== 0) {
    return timeDelta;
  }

  return left.sourceIndex - right.sourceIndex;
}

function compareReplayDownloads(left, right) {
  return compareReplayCandidates(left, right);
}

function mergeLeagueRecentEntries(entryGroups, limit) {
  const merged = [];
  const seenKeys = new Set();

  for (const entries of entryGroups) {
    for (const entry of entries) {
      const key = getLeagueRecentEntryKey(entry);
      if (seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);
      merged.push(entry);
    }
  }

  merged.sort((left, right) => compareLeagueRecentEntries(right, left));
  return merged.slice(0, limit);
}

function getLeagueRecentEntryKey(entry) {
  const replayId = normalizeReplayId(entry?.replayid);
  if (replayId) {
    return `replay:${replayId}`;
  }

  const timestamp = String(entry?.ts ?? '');
  const users = (Array.isArray(entry?.results?.leaderboard) ? entry.results.leaderboard : [])
    .map((player) => String(player?.username ?? '').toLowerCase())
    .join(',');
  return `fallback:${timestamp}:${users}`;
}

function compareLeagueRecentEntries(left, right) {
  const leftTime = normalizeTimestamp(left?.ts);
  const rightTime = normalizeTimestamp(right?.ts);
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return String(left?.replayid ?? '').localeCompare(String(right?.replayid ?? ''));
}

async function fetchTetrioJson(path, options) {
  const response = await options.fetchImpl(`${options.tetrioApiBaseUrl}${path}`, {
    headers: getTetrioHeaders(options.sessionId),
  });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    const error = new Error(body?.error?.msg ?? `TETR.IO API responded with ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return body;
}

function getTetrioHeaders(sessionId) {
  return sessionId
    ? {
      ...tetrioHeaders,
      'X-Session-ID': sessionId,
    }
    : tetrioHeaders;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs);

  try {
    return await options.fetchImpl(url, {
      headers: options.headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const results = new Array(items.length);
  const workerCount = Math.min(items.length, Math.max(1, concurrency));
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function buildReplayFailure(candidate, reason, status = null) {
  return {
    ok: false,
    replayId: candidate.replayId,
    playedAt: candidate.playedAt,
    sourceIndex: candidate.sourceIndex,
    reason,
    status,
  };
}

function isLikelyReplayContent(content) {
  const trimmed = String(content ?? '').trim();
  if (trimmed.length < 32) {
    return false;
  }

  if (/^<(?:!doctype|html)\b/i.test(trimmed)) {
    return false;
  }

  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function isTimeoutError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function formatReplayFileName(username, index, replayId) {
  const safeUsername = String(username ?? 'user').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'user';
  const safeReplayId = String(replayId ?? 'replay').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'replay';
  return `${safeUsername}-league-${String(index + 1).padStart(2, '0')}-${safeReplayId}.ttrm`;
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

function normalizeReplayId(value) {
  const replayId = String(value ?? '').trim();
  if (!replayId || replayId.length > 200) {
    return null;
  }

  if (/[/?#\s]/.test(replayId)) {
    return null;
  }

  return replayId;
}

function normalizeTimestamp(value) {
  const time = Date.parse(String(value ?? ''));
  return Number.isFinite(time) ? time : 0;
}

function normalizeInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, number));
}

function createTetrioApiSessionId(scope) {
  return `discord-bot-${scope}-${randomUUID()}`;
}
