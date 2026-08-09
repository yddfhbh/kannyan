import test from 'node:test';
import assert from 'node:assert/strict';

import { createMinomuncherAnalysis } from '../src/minomuncher-analysis.js';

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
