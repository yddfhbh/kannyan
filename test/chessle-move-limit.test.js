import test from 'node:test';
import assert from 'node:assert/strict';
import { canEnterChessleMove } from '../activity/move-limit.js';

test('normal mode accepts exactly six half-moves', () => {
  const puzzle = { length: 6, finished: false };
  for (let n = 0; n < 6; n++) assert.equal(canEnterChessleMove(puzzle, n), true);
  assert.equal(canEnterChessleMove(puzzle, 6), false);
  assert.equal(canEnterChessleMove(puzzle, 7), false);
});

test('expert mode accepts exactly ten half-moves and no eleventh', () => {
  const puzzle = { length: 10, finished: false };
  assert.equal(canEnterChessleMove(puzzle, 9), true);
  assert.equal(canEnterChessleMove(puzzle, 10), false);
  assert.equal(canEnterChessleMove(puzzle, 11), false);
});

test('finished game and in-flight submission block any new move', () => {
  assert.equal(canEnterChessleMove({ length: 10, finished: true }, 0), false);
  assert.equal(canEnterChessleMove({ length: 10, finished: false }, 5, true), false);
  assert.equal(canEnterChessleMove({ length: 10, finished: false }, 5, false), true);
});

test('invalid or missing puzzle state cannot authorize moves', () => {
  for (const puzzle of [null, undefined, {}, { length: 0 }, { length: NaN }, { length: '10' }]) {
    assert.equal(canEnterChessleMove(puzzle, 0), false);
  }
  assert.equal(canEnterChessleMove({ length: 10 }, -1), false);
  assert.equal(canEnterChessleMove({ length: 10 }, 1.5), false);
});
