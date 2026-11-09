import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createChessleDailyOrigin, normalizeOriginalDaily } from '../src/chessle/daily-origin.js';

const answer = {
  num: 1729, date: '2026-11-07',
  moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4'],
  name_normal: 'Normal test opening', name_expert: 'Expert test opening',
};
const response = data => ({ ok: true, text: async () => JSON.stringify(data) });
async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chessle-origin-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'cache.json');
}

test('normalizes valid original 10-ply SAN and rejects invalid moves', () => {
  const daily = normalizeOriginalDaily(answer);
  assert.equal(daily.moves.length, 10);
  assert.equal(daily.normalName, answer.name_normal);
  assert.throws(() => normalizeOriginalDaily({ ...answer, moves: ['a1a9'] }));
  assert.throws(() => normalizeOriginalDaily({ ...answer, date: '2026-02-30' }));
});

test('uses same original daily for normal and expert and pins across restart', async t => {
  const filePath = await temp(t);
  let calls = 0;
  const fetchImpl = async () => { calls++; return response(answer); };
  const create = () => createChessleDailyOrigin({ filePath, fetchImpl, dateKst: () => '2026-11-07' });
  const first = await create().current();
  assert.equal(first.date, '2026-11-07');
  assert.equal(first.puzzles.normal.moves.length, 6);
  assert.deepEqual(first.puzzles.expert.moves.slice(0, 6), first.puzzles.normal.moves);
  assert.equal(first.puzzles.normal.name, answer.name_normal);
  const next = await create().current();
  assert.equal(calls, 2);
  assert.deepEqual(next.puzzles.expert.moves, first.puzzles.expert.moves);
  const saved = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(Object.keys(saved.records).length, 1);
});

test('when API fails the fallback remains frozen for the KST day', async t => {
  const filePath = await temp(t);
  let shouldFail = true;
  const daily = createChessleDailyOrigin({
    filePath, dateKst: () => '2026-11-07', refreshMs: 0,
    fetchImpl: async () => { if (shouldFail) throw Error('offline'); return response(answer); },
  });
  const first = await daily.current();
  assert.equal(first.source, 'local');
  shouldFail = false;
  const again = await daily.current();
  assert.equal(again.source, 'local');
  assert.deepEqual(again.puzzles.normal.moves, first.puzzles.normal.moves);
});

test('protects legacy games on matching date instead of silently swapping answers', async t => {
  const filePath = await temp(t);
  const daily = createChessleDailyOrigin({
    filePath, dateKst: () => '2026-11-07',
    fetchImpl: async () => response(answer),
  });
  const first = await daily.current({ legacyDates: ['2026-11-07'] });
  assert.equal(first.source, 'local');
  assert.equal(first.date, '2026-11-07');
  assert.deepEqual(first.puzzles.expert.moves, (await daily.current()).puzzles.expert.moves);
});

test('refreshes with a newly published original date, without overwriting old cache', async t => {
  const filePath = await temp(t);
  let payload = answer;
  let date = '2026-11-07';
  const daily = createChessleDailyOrigin({
    filePath, dateKst: () => date, refreshMs: 0,
    fetchImpl: async () => response(payload),
  });
  assert.equal((await daily.current()).date, '2026-11-07');
  date = '2026-11-08';
  payload = { ...answer, date, num: 1730 };
  assert.equal((await daily.current()).date, '2026-11-08');
  const saved = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.deepEqual(Object.keys(saved.records).sort(), ['2026-11-07', '2026-11-08']);
});

test('KST midnight never reuses an in-memory puzzle from the previous day', async t => {
  const filePath = await temp(t);
  let date = '2026-11-07';
  let payload = answer;
  const daily = createChessleDailyOrigin({ filePath, dateKst: () => date, refreshMs: 10 * 60_000, fetchImpl: async () => response(payload) });
  assert.equal((await daily.current()).date, '2026-11-07');
  // Simulate KST 23:59 -> 00:00 while the process and its active cache remain alive.
  date = '2026-11-08';
  payload = { ...answer, date, num: 1730 };
  assert.equal((await daily.current()).date, '2026-11-08');
});
