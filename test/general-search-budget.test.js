import test from 'node:test';
import assert from 'node:assert/strict';
import { withGeneralSearchBudget, consumeGeneralSearchAttempt, generalSearchBudgetSnapshot, withinGeneralSearchDeadline } from '../src/general-search-budget.js';
import { searchWeb } from '../src/web-search.js';
import { fetchWebPageText } from '../src/web-page-content.js';
import { runGeneralSearchChat } from '../src/general-search-chat.js';

test('search fallback and query variants share two real HTTP attempts', async () => {
  let calls = 0;
  await withGeneralSearchBudget(async () => {
    const result = await searchWeb('unknown subject', {
      queryVariants: ['first', 'second', 'third'], providerOrder: ['duckduckgo', 'naver'],
      fetchImpl: async () => { calls += 1; return { status: 503, ok: false, text: async () => '' }; },
      logger: {},
    });
    assert.equal(calls, 2);
    assert.equal(generalSearchBudgetSnapshot().searches, 2);
    assert.equal(result.status, 'provider-unavailable');
    assert.equal(result.budgetExhausted, true);
    assert.deepEqual(result.attempts.map(({ provider, httpStatus }) => [provider, httpStatus]), [
      ['duckduckgo', 503], ['naver', 503],
    ]);
  });
});

test('DDG challenge followed by Naver success retains the candidate when another query is planned', async () => {
  let calls = 0;
  await withGeneralSearchBudget(async () => {
    const result = await searchWeb('generic topic', {
      queryVariants: ['generic topic', 'generic topic site:example.org'],
      fetchImpl: async (url) => {
        calls++;
        return String(url).includes('duckduckgo')
          ? new Response('challenge', { status: 202 })
          : new Response('<main><a href="https://example.org/guide">Generic topic guide</a></main>');
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.status, 'success');
    assert.equal(result.budgetExhausted, true);
    assert.equal(result.results[0].url, 'https://example.org/guide');
    assert.deepEqual(result.attempts.map(({ provider, status, httpStatus }) => [provider, status, httpStatus]), [
      ['duckduckgo', 'blocked', 202], ['naver', 'success', 200],
    ]);
  });
});

test('first query success survives the search budget limit on later variants', async () => {
  let calls = 0;
  await withGeneralSearchBudget(async () => {
    const result = await searchWeb('generic topic', {
      queryVariants: ['first', 'second', 'third'], providerOrder: ['naver'],
      fetchImpl: async () => {
        calls++;
        return calls === 1
          ? new Response('<main><a href="https://example.org/guide">Generic topic guide</a></main>')
          : new Response('검색 결과가 없습니다');
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.status, 'success');
    assert.equal(result.results[0].url, 'https://example.org/guide');
    assert.deepEqual(result.attempts.map(({ status }) => status), ['success', 'empty']);
  });
});

test('two blocked engines return their failure status and actual attempts', async () => {
  await withGeneralSearchBudget(async () => {
    const result = await searchWeb('generic topic', {
      queryVariants: ['first', 'second'],
      fetchImpl: async () => new Response('challenge', { status: 202 }),
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.failed, true);
    assert.equal(result.attempts.length, 2);
    assert.deepEqual(result.attempts.map(({ httpStatus }) => httpStatus), [202, 202]);
  });
});

test('a later transport exception retains earlier success and safe failure diagnostics', async () => {
  let calls = 0;
  await withGeneralSearchBudget(async () => {
    const result = await searchWeb('generic topic', {
      queryVariants: ['first', 'second', 'third'], providerOrder: ['naver'],
      fetchImpl: async () => {
        calls++;
        if (calls === 1) return new Response('<main><a href="https://example.org/guide">Generic topic guide</a></main>');
        const error = new TypeError('fetch failed');
        error.code = 'unsafe/request-detail';
        error.cause = { code: 'ENOTFOUND' };
        throw error;
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.status, 'success');
    assert.equal(result.results[0].url, 'https://example.org/guide');
    assert.deepEqual(result.attempts.map(({ status }) => status), ['success', 'transport-error']);
    assert.equal(result.attempts[1].errorCode, undefined);
    assert.equal(result.attempts[1].errorCauseCode, 'ENOTFOUND');
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

test('expired 30-second scope does not start a Gemini extraction', async () => {
  await withGeneralSearchBudget(async () => {
    const pages = [{ sourceId: 'source-1', url: 'https://docs.github.com/en/billing',
      title: 'GitHub Actions billing', pageText: 'GitHub Actions billing includes free minutes and paid overages.' }];
    const result = await runGeneralSearchChat('GitHub Actions billing', { results: [] }, { mode: 'on', pages });
    assert.equal(result.reason, 'extraction-budget-exhausted');
  }, { durationMs: 1 });
});
