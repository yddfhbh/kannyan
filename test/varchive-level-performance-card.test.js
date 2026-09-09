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

test('renders in-game level input with V-ARCHIVE level labels', () => {
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
  assert.doesNotMatch(svg, /NM 14/);
  assert.doesNotMatch(svg, /SC 14/);
  assert.match(svg, /V-ARCHIVE 4\.1/);
});

test('renders V-ARCHIVE level input with in-game level labels', () => {
  const svg = renderVArchiveLevelPerformanceCardSvg({
    lookup: {
      nickname: 'KanNyan0713',
      difficulty: null,
      level: null,
      floorName: '4.2',
      button: 4,
      entries: [
        { titleId: '1', songName: 'Alpha', difficulty: 'HD', level: 12, floorName: '4.2', scoreText: '99.10' },
      ],
    },
  });

  assert.match(svg, /HD 12/);
  assert.doesNotMatch(svg, /class="difficulty">V-ARCHIVE 4\.2/);
});
