import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectGeneralSearchBodies, collectWebBodyEvidence } from '../src/web-evidence.js';
import { runGeneralSearchChat } from '../src/general-search-chat.js';
import { withGeneralSearchBudget, generalSearchBudgetSnapshot } from '../src/general-search-budget.js';
import { runChatBudget } from '../src/chat-time-budget.js';

const replay = JSON.parse(readFileSync(new URL('./fixtures/general-search-discord-replay.json', import.meta.url)));
const candidate = { url: replay.source.url, title: replay.source.title, snippet: 'GitHub Actions free use and billing' };
const initial = { query: replay.question, status: 'success', candidates: [candidate], results: [candidate],
  attempts: [{ provider: 'naver', httpStatus: replay.operationLog.naverStatus }] };
const readPage = async () => ({ url: replay.source.url, title: replay.source.title, text: replay.source.pageText, status: 200 });

test('saved Discord case reaches one extraction without the 20-second legacy review', async () => {
  assert.ok(replay.operationLog.legacyReviewMs.reduce((a, b) => a + b) > 20_000);
  await runChatBudget(() => withGeneralSearchBudget(async () => {
    const data = await collectGeneralSearchBodies(replay.question, initial, { readPage });
    assert.equal(data.bodyVerification.reviewCalls.length, 0);
    assert.equal(data.bodyVerification.reads[0].status, 'body-extracted');
    let calls = 0;
    const result = await runGeneralSearchChat(replay.question, data, { mode: 'on', extract: async () => {
      calls++;
      return { responseSchemaValid: true, facts: replay.facts, calls };
    } });
    assert.equal(calls, 1);
    assert.equal(result.outcome, 'partial');
    assert.match(result.answer, /docs\.github\.com/);
    assert.equal(generalSearchBudgetSnapshot().reads, 0); // injected offline read
  }));
});

test('unsafe body and disguised redirect never reach extraction', async () => {
  for (const readPage of [
    async () => ({ url: replay.source.url, title: candidate.title, text: 'api_key=abc123 and billing' }),
    async () => ({ url: 'https://docs.github.com.evil.example/billing', title: candidate.title, text: replay.source.pageText }),
  ]) {
    const data = await collectGeneralSearchBodies(replay.question, initial, { readPage });
    let calls = 0;
    const result = await runGeneralSearchChat(replay.question, data, { mode: 'on', extract: async () => { calls++; return {}; } });
    assert.equal(calls, 0);
    assert.equal(result.action, 'legacy');
  }
});

test('insufficient time blocks a further model call', async () => {
  const data = await collectGeneralSearchBodies(replay.question, initial, { readPage });
  await runChatBudget(() => withGeneralSearchBudget(async () => {
    let calls = 0;
    const result = await runGeneralSearchChat(replay.question, data, { mode: 'on', extract: async () => { calls++; return {}; } });
    assert.equal(result.reason, 'extraction-budget-exhausted');
    assert.equal(calls, 0);
  }, { durationMs: 4500 }));
  await runChatBudget(() => withGeneralSearchBudget(async () => {
    let calls = 0;
    const result = await runGeneralSearchChat(replay.question, data, { mode: 'on', extract: async () => { calls++; return {}; } });
    assert.equal(result.reason, 'extraction-budget-exhausted');
    assert.equal(calls, 0);
  }), 4500);
  await runChatBudget(() => withGeneralSearchBudget(async () => {
    let calls = 0;
    const result = await collectGeneralSearchBodies(replay.question, initial, { readPage: async () => { calls++; return readPage(); } });
    assert.equal(result.bodyVerification.reads.length, 0);
    assert.equal(calls, 0);
  }, { durationMs: 9000 }));
});

test('off and shadow retain legacy response selection', async () => {
  let reviewCalls = 0;
  await collectWebBodyEvidence(replay.question, initial, async () => { reviewCalls++; throw new Error('legacy review'); },
    { readPage, search: async () => ({ status: 'empty', results: [], attempts: [] }), getRemainingBudget: () => ({ durationMs: 0 }) });
  assert.ok(reviewCalls > 0);
  for (const mode of ['off', 'shadow']) {
    let extractionCalls = 0;
    const result = await runGeneralSearchChat(replay.question, initial, { mode, extract: async () => { extractionCalls++; return {}; } });
    assert.equal(result.action, 'legacy');
    assert.equal(extractionCalls, 0);
  }
});
