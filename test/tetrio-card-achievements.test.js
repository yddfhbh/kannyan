import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateAchievementProgress,
  getAchievementCompetitivePlace,
  getAchievementRingClipPoints,
  isBotTetrioUser,
  isGuestTetrioUser,
} from '../src/tetrio-card.js';
import { renderTetrioAchievementIconMarkup } from '../src/tetrio-achievement-icon.js';

test('getAchievementCompetitivePlace requires art=2 and respects 0-based wreath thresholds', () => {
  const cases = [
    [{ art: 2, pos: 22 }, 't25'],
    [{ art: 2, pos: 99 }, 't100'],
    [{ art: 2, pos: 100 }, null],
    [{ art: 1, pos: 0 }, null],
    [{ art: 0, pos: 22 }, null],
    [{ art: null, pos: 1 }, null],
    [{ art: 2, pos: null }, null],
    [{ art: 2, pos: Number.NaN }, null],
  ];

  for (const [achievement, expected] of cases) {
    assert.equal(getAchievementCompetitivePlace(achievement), expected);
  }
});

test('calculateAchievementProgress clamps percentile progress to 0..1', () => {
  assert.ok(
    Math.abs(calculateAchievementProgress({ rt: 1, rank: 5, pos: 2, total: 101 }) - 0.6) < 1e-9,
  );
  assert.equal(
    calculateAchievementProgress({ rt: 1, rank: 5, pos: -50, total: 101 }),
    1,
  );
  assert.equal(
    calculateAchievementProgress({ rt: 1, rank: 5, pos: 999, total: 101 }),
    0,
  );
});

test('calculateAchievementProgress supports zenith achievements', () => {
  assert.equal(
    calculateAchievementProgress({ rt: 3, rank: 4, v: 1500, pos: 21, total: 77100 }),
    0.5,
  );
  assert.equal(
    calculateAchievementProgress({ rt: 3, rank: 4, v: Number.NaN, pos: 21, total: 77100 }),
    0,
  );
});

test('getAchievementRingClipPoints returns stable polygon coordinates at branch boundaries', () => {
  const progresses = [0, 1 / 3, 2 / 3, 1];

  for (const progress of progresses) {
    const points = getAchievementRingClipPoints(progress, 48);
    const segments = points.split(' ');

    assert.ok(segments.length >= 3);
    assert.ok(segments.every((segment) => /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(segment)));
  }
});

test('renderTetrioAchievementIconMarkup follows the shared frame-ring-inner-icon-wreath structure', () => {
  const markup = renderTetrioAchievementIconMarkup({
    achievement: {
      frame: 'frame.png',
      ringPiece: 'ring.png',
      icon: 'icon.png',
      wreath: 'wreath.png',
    },
    clipPathId: 'test-ring',
    ringClipPoints: getAchievementRingClipPoints(0.5, 48),
    size: 48,
    x: 0,
    y: 0,
  });

  assert.ok(markup.includes('href="frame.png"'));
  assert.ok(markup.includes('href="ring.png"'));
  assert.ok(markup.includes('href="icon.png"'));
  assert.ok(markup.includes('href="wreath.png"'));
  assert.ok(markup.indexOf('href="frame.png"') < markup.indexOf('href="ring.png"'));
  assert.ok(markup.indexOf('href="ring.png"') < markup.indexOf('href="icon.png"'));
  assert.ok(markup.indexOf('href="icon.png"') < markup.indexOf('href="wreath.png"'));
});

test('guest and bot account detection follows TETR.IO role values', () => {
  assert.equal(isGuestTetrioUser({ role: 'anon' }), true);
  assert.equal(isGuestTetrioUser({ role: 'ANON' }), true);
  assert.equal(isGuestTetrioUser({ role: 'user' }), false);
  assert.equal(isBotTetrioUser({ role: 'bot' }), true);
  assert.equal(isBotTetrioUser({ role: 'anon' }), false);
});
