import test from 'node:test';
import assert from 'node:assert/strict';
import { renderVArchiveLevelPerformanceCardSvg } from '../src/varchive-level-performance-card.js';

test('does not render a short song title twice', () => {
  const svg = renderVArchiveLevelPerformanceCardSvg({
    lookup: {
      nickname: 'KanNyan0713',
      difficulty: 'HD',
      level: 12,
      button: 4,
      entries: [{
        titleId: '1',
        songName: 'Löschen',
        difficulty: 'HD',
        level: 12,
        scoreText: '99.56',
      }],
    },
  });

  assert.equal((svg.match(/Löschen/g) || []).length, 1);
});
