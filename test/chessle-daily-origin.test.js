import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createChessleDailyOrigin, normalizeOriginalDaily } from '../src/chessle/daily-origin.js';

const answer = {
  num: 1735, date: '2026-11-13',
  moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4'],
  name_normal: 'Normal test opening', name_expert: 'Expert test opening',
};
const response = data => ({ ok: true, text: async () => JSON.stringify(data) });
async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chessle-origin-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'cache.json');
}

test('validates official puzzle names, ID, dates and SAN sequences', () => {
  const daily = normalizeOriginalDaily(answer);
  assert.equal(daily.id, 1735);
  assert.equal(daily.moves.length, 10);
  assert.throws(() => normalizeOriginalDaily({ ...answer, moves: ['a1a9'] }));
  assert.throws(() => normalizeOriginalDaily({ ...answer, date: '2026-02-30' }));
});

test('uses publisher date even if KST calendar differs', async t => {
  const filePath = await temp(t);
  const origin = createChessleDailyOrigin({
    filePath, dateKst: () => '2026-11-14',
    fetchImpl: async () => response(answer),
  });
  const view = await origin.current();
  assert.equal(view.source, 'original');
  assert.equal(view.date, '2026-11-13');
  assert.equal(view.puzzleId, 1735);
  assert.equal(view.puzzles.normal.length, 6);
  assert.equal(view.puzzles.expert.length, 10);
  assert.deepEqual(view.puzzles.expert.moves.slice(0, 6), view.puzzles.normal.moves);
});

test('previously pinned local fallback dates cannot override a valid official puzzle', async t => {
  const filePath = await temp(t);
  await fs.writeFile(filePath, JSON.stringify({
    version: 1, records: {}, fallbacks: { '2026-11-13': '2026-11-13' },
  }));
  const view = await createChessleDailyOrigin({
    filePath, fetchImpl: async () => response(answer),
  }).current({ legacyDates: ['2026-11-13'] });
  assert.equal(view.source, 'original');
  assert.equal(view.puzzleId, 1735);
  const cache = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(cache.activeDate, '2026-11-13');
  assert.equal(cache.fallbacks['2026-11-13'], '2026-11-13');
});

test('no official data and no verified cache must fail, not invent a local answer', async t => {
  const filePath = await temp(t);
  const origin = createChessleDailyOrigin({
    filePath, fetchImpl: async () => { throw Error('offline'); },
  });
  await assert.rejects(origin.current(), /Official Chessle puzzle unavailable/);
  await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
});

test('transient outage retains last verified official answer across restarts', async t => {
  const filePath = await temp(t);
  await createChessleDailyOrigin({ filePath, fetchImpl: async () => response(answer) }).current();
  const offline = createChessleDailyOrigin({ filePath, fetchImpl: async () => { throw Error('offline'); } });
  const view = await offline.current();
  assert.equal(view.date, answer.date);
  assert.equal(view.puzzleId, 1735);
});

test('new upstream publication changes day without waiting for a KST midnight', async t => {
  const filePath = await temp(t);
  let published = answer;
  const origin = createChessleDailyOrigin({
    filePath, refreshMs: 0, dateKst: () => '2026-11-14',
    fetchImpl: async () => response(published),
  });
  assert.equal((await origin.current()).date, '2026-11-13');
  published = { ...answer, num: 1736, date: '2026-11-14' };
  assert.equal((await origin.current()).date, '2026-11-14');
  const cache = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(cache.activeDate, '2026-11-14');
  assert.deepEqual(Object.keys(cache.records).sort(), ['2026-11-13', '2026-11-14']);
});

test('stale CDN responses cannot undo a published reset', async t => {
  const filePath = await temp(t);
  let published = { ...answer, date: '2026-11-14', num: 1736 };
  const origin = createChessleDailyOrigin({
    filePath, refreshMs: 0, fetchImpl: async () => response(published),
  });
  assert.equal((await origin.current()).date, '2026-11-14');
  published = answer;
  assert.equal((await origin.current()).date, '2026-11-14');
  const cache = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(cache.activeDate, '2026-11-14');
});

test('same-date upstream edits do not change a pinned official answer', async t => {
  const filePath = await temp(t);
  let published = answer;
  const origin = createChessleDailyOrigin({
    filePath, refreshMs: 0, fetchImpl: async () => response(published),
  });
  assert.equal((await origin.current()).puzzleId, 1735);
  published = { ...answer, num: 3000, name_expert: 'Rewritten' };
  const view = await origin.current();
  assert.equal(view.puzzleId, 1735);
  assert.equal(view.puzzles.expert.name, answer.name_expert);
});
