import test from 'node:test';
import assert from 'node:assert/strict';

import { isChessPgnRequestText } from '../src/chess/chess-pgn-intent.js';

test('does not treat 기본 말투 as a chess PGN request', () => {
  assert.equal(isChessPgnRequestText('%기본 말투가 뭐야?'), false);
});

test('does not treat 기본값 as a chess PGN request', () => {
  assert.equal(isChessPgnRequestText('%기본값을 알려줘'), false);
});

test('does not treat a long prompt containing 기본 as a chess PGN request', () => {
  const prompt = '%기본적으로 어떻게 동작하는지 길게 설명해줘. 기본 말투와 기본 형식도 같이 알려줘.';

  assert.equal(isChessPgnRequestText(prompt), false);
});

test('recognizes 기보 보여줘 as a chess PGN request', () => {
  assert.equal(isChessPgnRequestText('%기보 보여줘'), true);
});

test('recognizes pgn as a chess PGN request', () => {
  assert.equal(isChessPgnRequestText('%pgn'), true);
});

test('recognizes 방금 경기 기록 보여줘 as a chess PGN request', () => {
  assert.equal(isChessPgnRequestText('%방금 경기 기록 보여줘'), true);
});
