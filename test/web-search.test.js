import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveWebSearchQuery,
  shouldRetryWebSearchForUncertainAnswer,
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

test('shouldUseWebSearch recognizes information requests whose subject is not a factual-topic keyword', () => {
  assert.equal(shouldUseWebSearch('hebi의 지금부터 가사를 알려줘'), true);
  assert.equal(deriveWebSearchQuery('hebi의 지금부터 가사를 검색해서알려줘'), 'hebi의 지금부터 가사를');
});

test('shouldRetryWebSearchForUncertainAnswer detects answers that admit missing knowledge', () => {
  assert.equal(shouldRetryWebSearchForUncertainAnswer('정확한 가사를 알 수 없다냥.'), true);
  assert.equal(shouldRetryWebSearchForUncertainAnswer('검색 결과를 바탕으로 정리해봤다냥.'), false);
});

test('shouldUseWebSearch turns on for short currency amount prompts and enriches them with latest exchange context', () => {
  assert.equal(shouldUseWebSearch('3달러'), true);
  assert.equal(deriveWebSearchQuery('3달러'), '3달러 원화 환율 최신');
});

test('deriveWebSearchQuery prefers latest market price context only when no date is specified', () => {
  assert.equal(deriveWebSearchQuery('삼성전자 주가'), '삼성전자 주가 최신 시세');
  assert.equal(deriveWebSearchQuery('2024년 1월 3일 삼성전자 주가'), '2024년 1월 3일 삼성전자 주가');
});

test('shouldUseWebSearch stays off for simple casual chat', () => {
  assert.equal(shouldUseWebSearch('안녕'), false);
  assert.equal(shouldUseWebSearch('오늘 좀 피곤하다'), false);
});
