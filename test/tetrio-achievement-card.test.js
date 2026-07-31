import test from 'node:test';
import assert from 'node:assert/strict';

import { formatAchievementDateWithRelative } from '../src/tetrio-achievement-card.js';

test('formatAchievementDateWithRelative appends UTC calendar day difference', () => {
  const now = Date.UTC(2026, 6, 22, 12, 0, 0);

  assert.equal(
    formatAchievementDateWithRelative('2026-07-22T00:00:00.000Z', now),
    '2026. 7. 22. (0 days ago)',
  );
  assert.equal(
    formatAchievementDateWithRelative('2026-07-21T23:59:59.000Z', now),
    '2026. 7. 21. (1 days ago)',
  );
  assert.equal(
    formatAchievementDateWithRelative('2026-07-01T08:30:00.000Z', now),
    '2026. 7. 1. (21 days ago)',
  );
});
