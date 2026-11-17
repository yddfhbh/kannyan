import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGeminiAnswerPayload } from '../src/gemini-answer.js';

test('truncated JSON is detected without exposing partial output', () => {
  const samples = [
    '{"answer":"partial response',
    '{"answer":"partial response","emotion":',
    '{"emotion":"neutral","answer":"partial response',
    '{"sourcePlan":',
    '```json\n{"answer":"partial response\n```',
  ];

  for (const raw of samples) {
    const result = parseGeminiAnswerPayload(raw);

    assert.equal(result.parseFailure, 'invalid-answer-json');
    assert.equal(result.parseStrategy, 'unparseable-wrapper');
    assert.equal(result.answer.includes('partial response'), false);
    assert.equal(result.answer.includes('"answer"'), false);
  }
});

test('valid JSON remains supported', () => {
  const result = parseGeminiAnswerPayload(
    '{"answer":"valid response","emotion":"neutral"}'
  );

  assert.equal(result.answer, 'valid response');
  assert.equal(result.parseFailure, null);
});

test('plain text fallback remains supported', () => {
  const raw = 'ordinary text response';
  const result = parseGeminiAnswerPayload(raw);

  assert.equal(result.answer, raw);
  assert.equal(result.parseFailure, null);
});

test('recoverable trailing comma still works', () => {
  const result = parseGeminiAnswerPayload(
    '{"answer":"recovered","emotion":"neutral",}'
  );

  assert.equal(result.answer, 'recovered');
  assert.equal(result.parseFailure, null);
});
