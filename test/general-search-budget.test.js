import test from 'node:test';
import assert from 'node:assert/strict';
import { withGeneralSearchBudget, consumeGeneralSearchAttempt, generalSearchBudgetSnapshot, withinGeneralSearchDeadline } from '../src/general-search-budget.js';
import { searchWeb } from '../src/web-search.js';
import { fetchWebPageText } from '../src/web-page-content.js';

test('search fallback and query variants share two real HTTP attempts', async () => {
  let calls = 0;
  await withGeneralSearchBudget(async () => {
    await assert.rejects(searchWeb('unknown subject', {
      queryVariants: ['first', 'second'], providerOrder: ['duckduckgo', 'naver'],
      fetchImpl: async () => { calls += 1; return { status: 503, ok: false, text: async () => '' }; },
      logger: {},
    }), { code: 'HTTP_BUDGET_EXHAUSTED' });
    assert.equal(calls, 2);
    assert.equal(generalSearchBudgetSnapshot().searches, 2);
  });
});

test('redirects and later body reads share four HTTP attempts', async () => {
  let calls = 0;
  await withGeneralSearchBudget(async () => {
    await assert.rejects(fetchWebPageText('https://example.org/start', {
      resolveHostnames: async () => ['93.184.215.14'],
      fetchImpl: async () => { calls += 1; return { status: 302, headers: { get: () => '/next' } }; },
    }), { code: 'HTTP_BUDGET_EXHAUSTED' });
    assert.equal(calls, 4);
    await assert.rejects(fetchWebPageText('https://example.org/another', {
      resolveHostnames: async () => ['93.184.215.14'], fetchImpl: async () => { calls += 1; },
    }), { code: 'HTTP_BUDGET_EXHAUSTED' });
    assert.equal(calls, 4);
  });
});

test('extraction and total deadline stop additional attempts without leaking into another question', async () => {
  await withGeneralSearchBudget(async () => {
    assert.equal(consumeGeneralSearchAttempt('extraction'), true);
    assert.equal(consumeGeneralSearchAttempt('extraction'), false);
    await assert.rejects(withinGeneralSearchDeadline(() => new Promise(() => {})), { name: 'AbortError' });
    assert.equal(consumeGeneralSearchAttempt('search'), false);
  }, { durationMs: 15 });
  await withGeneralSearchBudget(async () => {
    assert.equal(consumeGeneralSearchAttempt('search'), true);
    assert.equal(generalSearchBudgetSnapshot().searches, 1);
  });
});
