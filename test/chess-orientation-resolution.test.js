import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBoardOrientationForRecognition } from '../src/chess/chess-analysis-command.js';

test('resolveBoardOrientationForRecognition only accepts explicit board orientation', () => {
  assert.equal(resolveBoardOrientationForRecognition('w'), 'w');
  assert.equal(resolveBoardOrientationForRecognition('b'), 'b');
  assert.equal(resolveBoardOrientationForRecognition(''), null);
  assert.equal(resolveBoardOrientationForRecognition(null), null);
  assert.equal(resolveBoardOrientationForRecognition(undefined), null);
});
