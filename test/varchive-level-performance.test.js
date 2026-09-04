import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchVArchiveLevelPerformanceEntries,
  findVArchiveLevelPerformanceEntries,
  parseVArchiveLevelPerformanceMessageInput,
  parseVArchiveLevelPerformanceToken,
} from '../src/varchive-level-performance.js';
import { clearVArchiveBoardPageHtmlCache } from '../src/varchive-board.js';

const sampleSongs = [
  {
    title: 101,
    name: 'Alpha',
    patterns: {
      '4B': {
        SC: { level: 14, floorName: '14.1', rating: 195 },
        MX: { level: 14, floorName: '8.1', rating: 170 },
      },
      '6B': {
        MX: { level: 13, floorName: '9.3', rating: 176 },
      },
    },
  },
  {
    title: 102,
    name: 'Beta',
    patterns: {
      '4B': {
        SC: { level: 14, floorName: '14.2', rating: 197 },
        HD: { level: 12, floorName: '6.1', rating: 160 },
      },
      '8B': {
        HD: { level: 12, floorName: '7.1', rating: 162 },
      },
    },
  },
  {
    title: 103,
    name: 'Gamma',
    patterns: {
      '8B': {
        NM: { level: 10, floorName: '3.3', rating: 150 },
      },
    },
  },
];

test('parseVArchiveLevelPerformanceToken parses sc14 into difficulty and level', () => {
  assert.deepEqual(parseVArchiveLevelPerformanceToken('sc14'), {
    difficulty: 'SC',
    level: 14,
  });
});

test('parseVArchiveLevelPerformanceToken parses mx13 hd12 nm10', () => {
  assert.deepEqual(parseVArchiveLevelPerformanceToken('mx13'), { difficulty: 'MX', level: 13 });
  assert.deepEqual(parseVArchiveLevelPerformanceToken('HD12'), { difficulty: 'HD', level: 12 });
  assert.deepEqual(parseVArchiveLevelPerformanceToken('Nm10'), { difficulty: 'NM', level: 10 });
});

test('parseVArchiveLevelPerformanceMessageInput parses button and fallback nickname', () => {
  assert.deepEqual(
    parseVArchiveLevelPerformanceMessageInput('sc14 4', 'KanNyan0713'),
    {
      difficulty: 'SC',
      level: 14,
      button: 4,
      nickname: 'KanNyan0713',
      usedFallbackNickname: true,
    },
  );
});

test('parseVArchiveLevelPerformanceMessageInput prefers explicit nickname', () => {
  assert.deepEqual(
    parseVArchiveLevelPerformanceMessageInput('hd12 8 직접 입력', 'Fallback'),
    {
      difficulty: 'HD',
      level: 12,
      button: 8,
      nickname: '직접 입력',
      usedFallbackNickname: false,
    },
  );
});

test('parseVArchiveLevelPerformanceMessageInput rejects invalid button', () => {
  assert.throws(
    () => parseVArchiveLevelPerformanceMessageInput('sc14 7'),
    { code: 'INVALID_VARCHIVE_LEVEL_PERFORMANCE_BUTTON' },
  );
});

test('parseVArchiveLevelPerformanceMessageInput rejects invalid first token format', () => {
  assert.throws(
    () => parseVArchiveLevelPerformanceMessageInput('14sc 4'),
    { code: 'INVALID_VARCHIVE_LEVEL_PERFORMANCE_LEVEL' },
  );
  assert.throws(
    () => parseVArchiveLevelPerformanceMessageInput('sc 14 4'),
    { code: 'INVALID_VARCHIVE_LEVEL_PERFORMANCE_LEVEL' },
  );
  assert.throws(
    () => parseVArchiveLevelPerformanceMessageInput('zz14 4'),
    { code: 'INVALID_VARCHIVE_LEVEL_PERFORMANCE_LEVEL' },
  );
});

test('findVArchiveLevelPerformanceEntries selects only matching difficulty and level', () => {
  const entries = findVArchiveLevelPerformanceEntries(sampleSongs, 'SC', 14, 4);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) => ({
      titleId: entry.titleId,
      songName: entry.songName,
      difficulty: entry.difficulty,
      level: entry.level,
      button: entry.button,
    })),
    [
      { titleId: '101', songName: 'Alpha', difficulty: 'SC', level: 14, button: 4 },
      { titleId: '102', songName: 'Beta', difficulty: 'SC', level: 14, button: 4 },
    ],
  );
});

test('fetchVArchiveLevelPerformanceEntries marks missing records with dash', async () => {
  clearVArchiveBoardPageHtmlCache();

  const entries = findVArchiveLevelPerformanceEntries(sampleSongs, 'SC', 14, 4);
  const result = await fetchVArchiveLevelPerformanceEntries('Hebi', entries, {
    boardPageCount: 1,
    fetchImpl: async () => ({
      ok: true,
      text: async () => '<html><body>empty</body></html>',
    }),
  });

  assert.deepEqual(
    result.map((entry) => entry.scoreText),
    ['-', '-'],
  );
});

test('fetchVArchiveLevelPerformanceEntries does not mix other difficulties', async () => {
  clearVArchiveBoardPageHtmlCache();

  const entries = findVArchiveLevelPerformanceEntries(sampleSongs, 'SC', 14, 4);
  const result = await fetchVArchiveLevelPerformanceEntries('Hebi', entries, {
    boardPageCount: 1,
    fetchImpl: async () => ({
      ok: true,
      text: async () => `
        <div id="4-101-MX"><div class="text-center bg-[color:var(--maxcombo)]">99.91</div></div>
        <div id="4-102-HD"><div class="text-center bg-[color:var(--clear)]">98.75</div></div>
      `,
    }),
  });

  assert.deepEqual(
    result.map((entry) => ({ titleId: entry.titleId, scoreText: entry.scoreText })),
    [
      { titleId: '101', scoreText: '-' },
      { titleId: '102', scoreText: '-' },
    ],
  );
});

test('fetchVArchiveLevelPerformanceEntries fetches each board page only once per run', async () => {
  clearVArchiveBoardPageHtmlCache();

  const entries = findVArchiveLevelPerformanceEntries(sampleSongs, 'SC', 14, 4);
  const calls = [];
  const result = await fetchVArchiveLevelPerformanceEntries('Hebi', entries, {
    boardPageCount: 3,
    fetchImpl: async (url) => {
      calls.push(url);
      const pageNo = Number(String(url).match(/\/board\/4\/(\d+)/)?.[1] ?? 0);
      return {
        ok: true,
        text: async () => pageNo === 2
          ? `
            <div id="4-101-SC"><div class="text-center bg-[color:var(--perfect)]">99.12</div></div>
            <div id="4-102-SC"><div class="text-center bg-[color:var(--clear)]">98.56</div></div>
          `
          : '<html></html>',
      };
    },
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(
    result.map((entry) => ({ titleId: entry.titleId, boardNo: entry.boardNo, scoreText: entry.scoreText })),
    [
      { titleId: '101', boardNo: 2, scoreText: '99.12' },
      { titleId: '102', boardNo: 2, scoreText: '98.56' },
    ],
  );
});
