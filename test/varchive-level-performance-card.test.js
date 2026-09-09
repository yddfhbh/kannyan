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

test('renders ALL difficulty heading and per-entry difficulty labels', () => {
  const svg = renderVArchiveLevelPerformanceCardSvg({
    lookup: {
      nickname: 'KanNyan0713',
      difficulty: 'ALL',
      level: 14,
      button: 4,
      entries: [
        { titleId: '1', songName: 'Alpha', difficulty: 'NM', level: 14, floorName: '4.1', scoreText: '99.10' },
        { titleId: '2', songName: 'Beta', difficulty: 'SC', level: 14, floorName: '14.1', scoreText: '-' },
      ],
    },
  });

  assert.match(svg, /4B · LEVEL 14/);
  assert.match(svg, /NM 14/);
  assert.match(svg, /SC 14/);
  assert.match(svg, /V-ARCHIVE 4\.1/);
});
