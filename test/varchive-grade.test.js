import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import {
  findVArchiveGradeEntries,
  getVArchiveGradeEmptyMessage,
  normalizeVArchiveGradeButton,
} from '../src/varchive-grade.js';
import { createVArchiveGradeCard } from '../src/varchive-grade-card.js';
import {
  parseVArchiveSongLookupInput,
  resolveVArchiveSongCommandOptions,
} from '../src/varchive-song-input.js';

const fixtureSongs = [
  {
    title: '1001',
    name: 'Alpha',
    dlcCode: 'VE',
    patterns: {
      '4B': {
        NM: { level: 9, floorName: '15.2' },
        HD: { level: 12, floorName: '15.2' },
        MX: { level: 14, floorName: '15.2' },
        SC: { level: 15, floorName: '15.2' },
      },
      '6B': {
        MX: { level: 13, floorName: '15.2' },
      },
    },
  },
  {
    title: '1002',
    name: 'Beta',
    dlcCode: 'VL',
    patterns: {
      '4B': {
        NM: { level: 10, floorName: '14.9' },
        HD: { level: 13, floorName: '15.2' },
        MX: { level: 15, floorName: '15.3' },
      },
      '5B': {
        SC: { level: 15, floorName: '15.2' },
      },
    },
  },
  {
    title: '1003',
    name: 'Gamma',
    dlcCode: 'TR',
    patterns: {
      '4B': {
        SC: { level: 15, floorName: '16.1' },
      },
    },
  },
];

test('findVArchiveGradeEntries collects only matching 4B 15.2 patterns', () => {
  assert.deepEqual(
    findVArchiveGradeEntries(fixtureSongs, '15.2', 4).map((entry) => ({
      titleId: entry.titleId,
      songName: entry.songName,
      difficulty: entry.difficulty,
      level: entry.level,
      floorName: entry.floorName,
    })),
    [
      { titleId: '1001', songName: 'Alpha', difficulty: 'NM', level: 9, floorName: '15.2' },
      { titleId: '1001', songName: 'Alpha', difficulty: 'HD', level: 12, floorName: '15.2' },
      { titleId: '1001', songName: 'Alpha', difficulty: 'MX', level: 14, floorName: '15.2' },
      { titleId: '1001', songName: 'Alpha', difficulty: 'SC', level: 15, floorName: '15.2' },
      { titleId: '1002', songName: 'Beta', difficulty: 'HD', level: 13, floorName: '15.2' },
    ],
  );
});

test('findVArchiveGradeEntries excludes other buttons and floors', () => {
  const entries = findVArchiveGradeEntries(fixtureSongs, '15.2', 4);
  assert.equal(entries.some((entry) => entry.button !== 4), false);
  assert.equal(entries.some((entry) => entry.floorName !== '15.2'), false);
  assert.equal(entries.some((entry) => entry.songName === 'Gamma'), false);
});

test('findVArchiveGradeEntries treats an integer floor as a prefix match', () => {
  const entries = findVArchiveGradeEntries(fixtureSongs, '15', 4);

  assert.deepEqual(
    entries.map((entry) => `${entry.songName}:${entry.floorName}`),
    [
      'Alpha:15.2',
      'Alpha:15.2',
      'Alpha:15.2',
      'Alpha:15.2',
      'Beta:15.2',
      'Beta:15.3',
    ],
  );
});

test('findVArchiveGradeEntries keeps multiple qualifying patterns from one song', () => {
  const alphaEntries = findVArchiveGradeEntries(fixtureSongs, '15.2', 4)
    .filter((entry) => entry.songName === 'Alpha');
  assert.equal(alphaEntries.length, 4);
});

test('findVArchiveGradeEntries returns empty array for missing floor', () => {
  assert.deepEqual(findVArchiveGradeEntries(fixtureSongs, '16.1', 4).map((entry) => entry.songName), ['Gamma']);
  assert.deepEqual(findVArchiveGradeEntries(fixtureSongs, '17.0', 4), []);
  assert.equal(getVArchiveGradeEmptyMessage(4, '16.1'), '4B 16.1층에 해당하는 패턴이 없다냥.');
});

test('parseVArchiveSongLookupInput prefers grade mode only for valid floor and button pairs', () => {
  assert.deepEqual(parseVArchiveSongLookupInput('15.2 4'), {
    mode: 'grade',
    rawQuery: '15.2 4',
    floorName: '15.2',
    button: 4,
    baseQuery: null,
    selectionIndex: null,
  });

  assert.deepEqual(parseVArchiveSongLookupInput('12.1 6'), {
    mode: 'grade',
    rawQuery: '12.1 6',
    floorName: '12.1',
    button: 6,
    baseQuery: null,
    selectionIndex: null,
  });

  assert.deepEqual(parseVArchiveSongLookupInput('15 4'), {
    mode: 'grade',
    rawQuery: '15 4',
    floorName: '15',
    button: 4,
    baseQuery: null,
    selectionIndex: null,
  });

  assert.deepEqual(parseVArchiveSongLookupInput('LIMBO 2'), {
    mode: 'song',
    rawQuery: 'LIMBO 2',
    baseQuery: 'LIMBO',
    selectionIndex: 2,
  });

  assert.deepEqual(parseVArchiveSongLookupInput('LIMBO'), {
    mode: 'song',
    rawQuery: 'LIMBO',
    baseQuery: 'LIMBO',
    selectionIndex: null,
  });
});

test('normalizeVArchiveGradeButton allows only 4 5 6 8', () => {
  assert.equal(normalizeVArchiveGradeButton(4), 4);
  assert.equal(normalizeVArchiveGradeButton('8'), 8);
  assert.throws(() => normalizeVArchiveGradeButton(7), /4, 5, 6, 8/);
});

test('resolveVArchiveSongCommandOptions validates song mode and grade mode for slash commands', () => {
  assert.deepEqual(
    resolveVArchiveSongCommandOptions('서열표', {
      songName: 'LIMBO',
      floorName: '',
      button: null,
    }),
    {
      mode: 'song',
      query: 'LIMBO',
    },
  );

  assert.deepEqual(
    resolveVArchiveSongCommandOptions('서열표', {
      songName: '',
      floorName: '15.2',
      button: 4,
    }),
    {
      mode: 'grade',
      floorName: '15.2',
      button: 4,
    },
  );

  assert.throws(
    () => resolveVArchiveSongCommandOptions('서열표', {
      songName: 'LIMBO',
      floorName: '15.2',
      button: 4,
    }),
    /한 가지 방식만 선택/
  );

  assert.throws(
    () => resolveVArchiveSongCommandOptions('서열표', {
      songName: '',
      floorName: '15.2',
      button: null,
    }),
    /레벨과 버튼/
  );
});

test('createVArchiveGradeCard renders a smoke-test image from fixture songs', async () => {
  const pngPixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlAbWQAAAAASUVORK5CYII=',
    'base64',
  );
  const card = await createVArchiveGradeCard('15.2', 4, {
    songs: fixtureSongs,
    fetchImpl: async () => ({
      ok: true,
      async arrayBuffer() {
        return pngPixel;
      },
    }),
    generatedAt: '2026-09-04T00:00:00.000Z',
  });

  assert.equal(card.entryCount, 5);
  assert.match(card.imageFormat, /png|jpeg/);
  const metadata = await sharp(card.image).metadata();
  assert.ok(metadata.width >= 1000);
  assert.ok(metadata.height >= 300);
});

test('createVArchiveGradeCard orders grouped integer floors from high to low', async () => {
  const card = await createVArchiveGradeCard('15', 4, {
    songs: fixtureSongs,
    fetchImpl: async () => ({
      ok: false,
      async arrayBuffer() {
        return Buffer.alloc(0);
      },
    }),
    generatedAt: '2026-09-04T00:00:00.000Z',
  });

  assert.deepEqual(card.view.sections.map((section) => section.floorName), ['15.3', '15.2']);
  assert.ok(card.view.sections[0].lineY < card.view.sections[0].bottomY);
  assert.ok(card.view.sections[0].bottomY < card.view.sections[1].titleY);
});
