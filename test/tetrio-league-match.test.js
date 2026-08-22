import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRecentLeagueMatchRow } from '../src/tetrio-league-match.js';

test('DQ loss uses the explicit API result even when the unfinished score is ahead', () => {
  const row = buildRecentLeagueMatchRow(buildRecord({
    result: 'dqloss',
    targetWins: 3,
    opponentWins: 2,
    targetTrBefore: 20000,
    targetTrAfter: 19853.76,
  }), 'oyasuminya', 16);

  assert.equal(row?.opponent, 'WHY_CHEAT');
  assert.equal(row?.isDq, true);
  assert.equal(row?.isWin, false);
  assert.equal(row?.resultLabel, 'DEFEAT BY DQ');
  assert.equal(row?.resultTone, 'loss');
  assert.equal(row?.trDelta, '-146.24');
});

test('DQ victory uses the explicit API result even when the unfinished score is behind', () => {
  const row = buildRecentLeagueMatchRow(buildRecord({
    result: 'dqvictory',
    targetWins: 1,
    opponentWins: 2,
  }), 'oyasuminya', 1);

  assert.equal(row?.isWin, true);
  assert.equal(row?.resultLabel, 'VICTORY BY DQ');
  assert.equal(row?.resultTone, 'win');
});

test('ordinary matches still fall back to the final score when no explicit result is present', () => {
  const victory = buildRecentLeagueMatchRow(buildRecord({
    result: '',
    targetWins: 3,
    opponentWins: 1,
  }), 'oyasuminya', 1);
  const defeat = buildRecentLeagueMatchRow(buildRecord({
    result: '',
    targetWins: 1,
    opponentWins: 3,
  }), 'oyasuminya', 2);

  assert.equal(victory?.resultLabel, 'VICTORY 3-1');
  assert.equal(defeat?.resultLabel, 'DEFEAT 1-3');
});

function buildRecord({
  result,
  targetWins,
  opponentWins,
  targetTrBefore = 20000,
  targetTrAfter = 20100,
}) {
  return {
    ts: '2026-05-08T15:14:27.000Z',
    replayid: 'dq-regression',
    otherusers: [
      { id: 'opponent-id', username: 'WHY_CHEAT' },
    ],
    results: {
      leaderboard: [
        {
          id: 'target-id',
          username: 'oyasuminya',
          naturalorder: 0,
          wins: targetWins,
          stats: { apm: 50, pps: 1.5, vsscore: 100 },
        },
        {
          id: 'opponent-id',
          username: 'WHY_CHEAT',
          naturalorder: 1,
          wins: opponentWins,
          stats: { apm: 45, pps: 1.4, vsscore: 90 },
        },
      ],
    },
    extras: {
      result,
      league: {
        'target-id': [
          { tr: targetTrBefore },
          { tr: targetTrAfter },
        ],
      },
    },
  };
}
