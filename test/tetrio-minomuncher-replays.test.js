import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchRecentTetrioLeagueReplayFiles } from '../src/tetrio-minomuncher-replays.js';

test('fetchRecentTetrioLeagueReplayFiles keeps Inoue concurrency capped while filling the latest 10 replays', async () => {
  const entries = buildLeagueEntries(12);
  let activeReplayRequests = 0;
  let maxReplayRequests = 0;

  const fetchImpl = async (url) => {
    const textUrl = String(url);

    if (textUrl.includes('/records/league/recent?')) {
      return createJsonResponse({
        success: true,
        data: { entries },
      });
    }

    if (textUrl.includes('/api/replay/')) {
      activeReplayRequests += 1;
      maxReplayRequests = Math.max(maxReplayRequests, activeReplayRequests);
      const replayId = decodeURIComponent(textUrl.split('/').at(-1) ?? '');

      await wait(5);
      activeReplayRequests -= 1;

      return createTextResponse(buildReplayText(replayId));
    }

    throw new Error(`Unexpected URL ${textUrl}`);
  };

  const result = await fetchRecentTetrioLeagueReplayFiles('hebi_', {
    candidateCount: 12,
    targetCount: 10,
    concurrency: 2,
    fetchImpl,
    tetrioApiBaseUrl: 'https://ch.tetr.io/api',
    replayApiBaseUrl: 'https://inoue.szy.lol/api/replay',
  });

  assert.equal(result.replays.length, 10);
  assert.equal(result.failures.length, 0);
  assert.equal(result.replays[0].replayId, 'replay-01');
  assert.equal(result.replays.at(-1)?.replayId, 'replay-10');
  assert.equal(maxReplayRequests, 2);
});

test('fetchRecentTetrioLeagueReplayFiles skips 404 replays and backfills older successful matches', async () => {
  const entries = buildLeagueEntries(12);

  const fetchImpl = async (url) => {
    const textUrl = String(url);

    if (textUrl.includes('/records/league/recent?')) {
      return createJsonResponse({
        success: true,
        data: { entries },
      });
    }

    const replayId = decodeURIComponent(textUrl.split('/').at(-1) ?? '');
    if (replayId === 'replay-02' || replayId === 'replay-04') {
      return createTextResponse('missing', { status: 404 });
    }

    return createTextResponse(buildReplayText(replayId));
  };

  const result = await fetchRecentTetrioLeagueReplayFiles('hebi_', {
    candidateCount: 12,
    targetCount: 10,
    fetchImpl,
  });

  assert.equal(result.replays.length, 10);
  assert.deepEqual(
    result.replays.map((replay) => replay.replayId),
    ['replay-01', 'replay-03', 'replay-05', 'replay-06', 'replay-07', 'replay-08', 'replay-09', 'replay-10', 'replay-11', 'replay-12'],
  );
  assert.deepEqual(
    result.failures.map((failure) => [failure.replayId, failure.reason]),
    [['replay-02', 'not_found'], ['replay-04', 'not_found']],
  );
});

test('fetchRecentTetrioLeagueReplayFiles treats 429 as a per-replay failure instead of aborting the batch', async () => {
  const entries = buildLeagueEntries(11);

  const fetchImpl = async (url) => {
    const textUrl = String(url);

    if (textUrl.includes('/records/league/recent?')) {
      return createJsonResponse({
        success: true,
        data: { entries },
      });
    }

    const replayId = decodeURIComponent(textUrl.split('/').at(-1) ?? '');
    if (replayId === 'replay-01') {
      return createTextResponse('slow down', { status: 429 });
    }

    return createTextResponse(buildReplayText(replayId));
  };

  const result = await fetchRecentTetrioLeagueReplayFiles('hebi_', {
    candidateCount: 11,
    targetCount: 10,
    fetchImpl,
  });

  assert.equal(result.replays.length, 10);
  assert.equal(result.failures.length, 1);
  assert.deepEqual(result.failures[0], {
    replayId: 'replay-01',
    playedAt: Date.parse('2026-08-09T12:00:00.000Z'),
    reason: 'rate_limited',
    status: 429,
  });
  assert.equal(result.replays[0].replayId, 'replay-02');
});

test('fetchRecentTetrioLeagueReplayFiles returns fewer replays when the user does not have 10 recent matches', async () => {
  const entries = buildLeagueEntries(7);

  const fetchImpl = async (url) => {
    const textUrl = String(url);

    if (textUrl.includes('/records/league/recent?')) {
      return createJsonResponse({
        success: true,
        data: { entries },
      });
    }

    const replayId = decodeURIComponent(textUrl.split('/').at(-1) ?? '');
    return createTextResponse(buildReplayText(replayId));
  };

  const result = await fetchRecentTetrioLeagueReplayFiles('hebi_', {
    candidateCount: 18,
    targetCount: 10,
    fetchImpl,
  });

  assert.equal(result.recentMatchCount, 7);
  assert.equal(result.replayCandidateCount, 7);
  assert.equal(result.replays.length, 7);
  assert.equal(result.failures.length, 0);
});

test('fetchRecentTetrioLeagueReplayFiles returns an empty replay list when every download fails', async () => {
  const entries = buildLeagueEntries(4);

  const fetchImpl = async (url, init = {}) => {
    const textUrl = String(url);

    if (textUrl.includes('/records/league/recent?')) {
      return createJsonResponse({
        success: true,
        data: { entries },
      });
    }

    const replayId = decodeURIComponent(textUrl.split('/').at(-1) ?? '');
    if (replayId === 'replay-01') {
      return createTextResponse('missing', { status: 404 });
    }
    if (replayId === 'replay-02') {
      return createTextResponse('busy', { status: 429 });
    }
    if (replayId === 'replay-03') {
      return createTextResponse('oops', { status: 503 });
    }

    init.signal?.throwIfAborted?.();
    await wait(20);
    throw Object.assign(new Error('timeout'), { name: 'AbortError' });
  };

  const result = await fetchRecentTetrioLeagueReplayFiles('hebi_', {
    candidateCount: 4,
    targetCount: 10,
    timeoutMs: 5,
    fetchImpl,
  });

  assert.equal(result.replays.length, 0);
  assert.deepEqual(
    result.failures.map((failure) => [failure.replayId, failure.reason]),
    [
      ['replay-01', 'not_found'],
      ['replay-02', 'rate_limited'],
      ['replay-03', 'server_error'],
      ['replay-04', 'timeout'],
    ],
  );
});

function buildLeagueEntries(count) {
  return Array.from({ length: count }, (_, index) => ({
    replayid: `replay-${String(index + 1).padStart(2, '0')}`,
    ts: new Date(Date.UTC(2026, 7, 9, 12, 0, 0) - index * 60_000).toISOString(),
    results: {
      leaderboard: [
        { username: 'hebi_' },
        { username: `opponent_${index + 1}` },
      ],
    },
  }));
}

function buildReplayText(replayId) {
  return JSON.stringify({
    id: replayId,
    replay: {
      frames: [{ board: [] }],
    },
  });
}

function createJsonResponse(body, options = {}) {
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function createTextResponse(body, options = {}) {
  return new Response(String(body), {
    status: options.status ?? 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
