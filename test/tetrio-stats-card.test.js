import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTetrioStats } from '../src/tetrio-stats-calculations.js';
import { createTetrioStatsCard } from '../src/tetrio-stats-card.js';

test('createTetrioStatsCard renders a custom metric card', async () => {
  const stats = calculateTetrioStats({
    apm: 98.04,
    pps: 1.51,
    vs: 189.83,
    rd: 60,
    wins: 18,
  });

  const image = await createTetrioStatsCard({
    username: 'CUSTOM STATS',
    stats: {
      ...stats,
      rank: '-',
      tr: null,
      glicko: null,
      rd: 60,
    },
  });

  assert.equal(Buffer.isBuffer(image), true);
  assert.ok(image.length > 0);
});
