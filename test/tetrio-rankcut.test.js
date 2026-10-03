import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRankCards, formatPlayerPercentage } from '../src/tetrio-rankcut.js';

test('rankcut player percentages are cumulative from the highest rank', () => {
  const cards = buildRankCards({
    total: 1000,
    x: { tr: 100, count: 123, apm: 30, pps: 2, vs: 1 },
    d: { tr: 10, count: 7, apm: 10, pps: 1, vs: 0.5 },
  });

  assert.equal(cards.find((card) => card.rank === 'x').playerPercentage, 12.3);
  assert.ok(Math.abs(cards.find((card) => card.rank === 'd').playerPercentage - 13) < Number.EPSILON);
  assert.equal(cards.at(-1).rank, 'tl');
  assert.equal(cards.at(-1).playerPercentage, 100);
});

test('rankcut player percentage formatting keeps small non-zero values visible', () => {
  assert.equal(formatPlayerPercentage(12.34), 'TOP 12.34%');
  assert.equal(formatPlayerPercentage(4.27), 'TOP 4.27%');
  assert.equal(formatPlayerPercentage(0.24), 'TOP 0.24%');
  assert.equal(formatPlayerPercentage(0.008), 'TOP 0.008%');
  assert.equal(formatPlayerPercentage(0), 'TOP 0%');
});
