import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMinomuncherAnalysis,
  filterMinomuncherStatsByUsername,
} from '../src/minomuncher-analysis.js';

test('createMinomuncherAnalysis surfaces a parse failure when every replay is invalid', async () => {
  await assert.rejects(
    createMinomuncherAnalysis({
      replays: [
        {
          name: 'broken-replay.ttrm',
          content: '{}',
        },
      ],
    }),
    (error) => error?.code === 'MINOMUNCHER_REPLAY_PARSE_FAILED'
      && Array.isArray(error.failedReplayFiles)
      && error.failedReplayFiles.includes('broken-replay.ttrm'),
  );
});

test('filterMinomuncherStatsByUsername keeps only the requested player for auto recent analysis', () => {
  const stats = {
    alpha: {
      username: 'Hebi_',
      stats: { apm: 100 },
    },
    beta: {
      username: 'Opponent',
      stats: { apm: 90 },
    },
  };

  assert.deepEqual(
    filterMinomuncherStatsByUsername(stats, 'hebi_'),
    {
      alpha: {
        username: 'Hebi_',
        stats: { apm: 100 },
      },
    },
  );
});
