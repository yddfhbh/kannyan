import test from 'node:test';
import assert from 'node:assert/strict';
import { getDailyPuzzle, MATCHING, scoreGuess, validateSequence } from '../src/chessle/core.js';

test('daily puzzles are stable in KST and have legal sequences', () => { const normal = getDailyPuzzle('2026-11-06', 'normal'); const again = getDailyPuzzle('2026-11-06', 'normal'); assert.deepEqual(normal, again); assert.equal(validateSequence(normal.moves, 6).ok, true); assert.equal(validateSequence(getDailyPuzzle('2026-11-06', 'expert').moves, 10).ok, true); });
test('scoreGuess resolves greens before duplicate yellows', () => { const move = (san, from = 'e2', to = 'e4', piece = 'p') => ({ san, from, to, piece }); const answer = [move('e4'), move('e5'), move('Nf3', 'g1', 'f3', 'n')]; assert.deepEqual(scoreGuess([move('e4'), move('e4'), move('Nf3', 'g1', 'f3', 'n')], answer, MATCHING.exact), ['green', 'gray', 'green']); });
test('piece-square mode ignores SAN-only differences', () => { const a = [{ san: 'Qh5+', piece: 'q', from: 'd1', to: 'h5' }]; const g = [{ san: 'Qh5', piece: 'q', from: 'd1', to: 'h5' }]; assert.deepEqual(scoreGuess(g, a, MATCHING.pieceSquare), ['green']); assert.deepEqual(scoreGuess(g, a, MATCHING.exact), ['gray']); });
