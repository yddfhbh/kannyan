import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveWebSearchQuery,
  shouldUseWebSearch,
} from '../src/web-search.js';

test('shouldUseWebSearch turns on for factual lookup questions', () => {
  assert.equal(shouldUseWebSearch('TETR.IO가 뭐야?'), true);
  assert.equal(shouldUseWebSearch('OpenAI API 최신 버전 뭐임?'), true);
});

test('shouldUseWebSearch turns on for explicit search-like Gemini prompts without %검색', () => {
  assert.equal(shouldUseWebSearch('OpenAI 최신 정보 알려줘'), true);
  assert.equal(shouldUseWebSearch('TETR.IO 검색해봐'), true);
  assert.equal(deriveWebSearchQuery('TETR.IO 검색해봐'), 'TETR.IO');
});

test('shouldUseWebSearch stays off for simple casual chat', () => {
  assert.equal(shouldUseWebSearch('안녕'), false);
  assert.equal(shouldUseWebSearch('오늘 좀 피곤하다'), false);
});
