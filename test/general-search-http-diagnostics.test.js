import test from 'node:test';
import assert from 'node:assert/strict';
import { searchWeb } from '../src/web-search.js';

const naverResult = '<main><a href="https://www.postgresql.org/download/">PostgreSQL Downloads</a></main>';

test('search diagnostics distinguish transport failure from HTTP response', async () => {
  const result = await searchWeb('diagnostic', {
    queryVariants: ['diagnostic'],
    providerOrder: ['naver'],
    fetchImpl: async () => {
      const error = new TypeError('fetch failed');
      error.cause = { code: 'ENOTFOUND' };
      throw error;
    },
  });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.attempts[0], {
    provider: 'naver', query: 'diagnostic', httpStatus: null,
    fetchInvoked: true, responseReceived: false, stage: 'fetch-invoked',
    status: 'transport-error', count: 0, durationMs: result.attempts[0].durationMs,
    errorCode: 'TypeError', errorName: 'TypeError', errorMessage: 'fetch failed',
    errorCauseCode: 'ENOTFOUND', abort: false,
    failureStage: 'transport-before-http-response',
  });
});

test('Naver HTTP 202 is blocked and can trigger fallback', async () => {
  const result = await searchWeb('fallback', {
    queryVariants: ['fallback'],
    providerOrder: ['naver', 'duckduckgo'],
    fetchImpl: async (url) => String(url).includes('search.naver.com')
      ? new Response('challenge', { status: 202 })
      : new Response('<div class="result"><a class="result__title result__a" href="https://docs.github.com/en">Docs</a></div>', { status: 200 }),
  });
  assert.equal(result.status, 'success');
  assert.deepEqual(result.attempts.map((attempt) => [attempt.provider, attempt.status, attempt.httpStatus]), [
    ['naver', 'blocked', 202], ['duckduckgo', 'success', 200],
  ]);
});

test('HTTP 200 with no recognized result is empty, not success', async () => {
  const result = await searchWeb('empty', {
    queryVariants: ['empty'], providerOrder: ['naver'],
    fetchImpl: async () => new Response('검색 결과가 없습니다', { status: 200 }),
  });
  assert.equal(result.status, 'empty');
  assert.equal(result.attempts[0].httpStatus, 200);
  assert.equal(result.attempts[0].responseReceived, true);
});

