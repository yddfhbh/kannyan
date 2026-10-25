import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { deriveWebSearchQuery, searchWeb } from '../src/web-search.js';
import { collectWebBodyEvidence } from '../src/web-evidence.js';
import { runGeneralSearchChat } from '../src/general-search-chat.js';

const source = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const parserSource = source.slice(source.indexOf('function parseGeminiFallbackPrompt('), source.indexOf('function parseCommaSeparatedValues('));
const context = vm.createContext({ getCanonicalPercentCommand: () => null });
vm.runInContext(parserSource, context);

const input = JSON.parse(fs.readFileSync(new URL('../tmp/general-search-focused-gemini-runner-input-20261024.json', import.meta.url)));
const output = JSON.parse(fs.readFileSync(new URL('../tmp/general-search-focused-gemini-run-20261024.json', import.meta.url)));
const page = input.cases.find((entry) => entry.id === 'focus-02').sources[0];
const facts = output.results.find((entry) => entry.id === 'focus-02').methodB.facts;

test('Discord percent prompt can use saved body after legacy review failure', async () => {
  const message = '%GitHub Actions 요금제별 무료 사용량이랑 초과요금 알려줘';
  const question = context.parseGeminiFallbackPrompt(message);
  assert.equal(question, message.slice(1));
  const query = deriveWebSearchQuery(question);
  assert.equal(query, 'GitHub Actions 요금제별 무료 사용량이랑 초과요금');
  assert.equal(query.includes('%'), false);

  const html = `<div data-testid="result"><a data-testid="result-title" class="result__a" href="${page.url}">GitHub Actions billing - GitHub Docs</a><p>Free use of GitHub Actions</p></div>`;
  const search = await searchWeb(query, { fetchImpl: async () => new Response(html) });
  assert.equal(search.attempts[0].provider, 'duckduckgo');
  assert.equal(search.attempts[0].httpStatus, 200);
  assert.equal(search.results[0].url, page.url);

  const data = await collectWebBodyEvidence(query, search, async () => { throw new Error('offline legacy review failure'); }, {
    originalPrompt: question,
    readPage: async () => ({ url: page.url, title: page.title, text: page.pageText }),
    search: async () => ({ status: 'empty', results: [], attempts: [] }),
  });
  assert.equal(data.failed, true);
  assert.ok(data.bodyVerification.reads.some((read) => read.status === 'body-extracted'));
  const result = await runGeneralSearchChat(question, data, {
    mode: 'on', extract: async () => ({ responseSchemaValid: true, facts }),
  });
  assert.equal(result.outcome, 'partial');
  assert.equal(result.action, 'verified');
  assert.ok(result.verifiedCount > 0);
  assert.match(result.answer, /docs\.github\.com/);
});

test('earlier short question and actual Discord question share Partial on the same saved evidence', async () => {
  for (const question of ['GitHub Actions 요금제', 'GitHub Actions 요금제별 무료 사용량이랑 초과요금 알려줘']) {
    const result = await runGeneralSearchChat(question, { failed: true, bodyVerification: { reads: [{
      status: 'body-extracted', requestedUrl: page.url, extractedTitle: page.title, extractedBody: page.pageText,
    }] } }, { mode: 'on', extract: async () => ({ responseSchemaValid: true, facts }) });
    assert.equal(result.outcome, 'partial', question);
    assert.equal(result.verifiedCount, 6, question);
  }
  const noBody = await runGeneralSearchChat('GitHub Actions 요금제', { failed: true, results: [] }, { mode: 'on' });
  assert.equal(noBody.action, 'legacy');
});

test('saved HTTP 200 official body still yields Partial after a 503 review', async () => {
  const question = 'GitHub Actions 요금제별 무료 사용량이랑 초과요금 알려줘';
  const data = { failed: true, status: 'review-failed', bodyVerification: {
    error: { category: 'api', status: 503 },
    reads: [{ status: 'body-extracted', requestedUrl: page.url, fetchedUrl: page.url,
      extractedTitle: page.title, extractedBody: page.pageText }],
  } };
  const result = await runGeneralSearchChat(question, data, { mode: 'on', extract: async () => ({ responseSchemaValid: true, facts }) });
  assert.equal(result.outcome, 'partial');
  assert.equal(result.action, 'verified');
  assert.match(result.answer, /docs\.github\.com/);

  data.bodyVerification.error = { category: 'request-limit', code: 'VERIFY_QUESTION_MODEL_LIMIT' };
  assert.equal((await runGeneralSearchChat(question, data, { mode: 'on', extract: async () => ({ responseSchemaValid: true, facts }) })).outcome, 'partial');
  data.bodyVerification.error = { category: 'api', status: 503 };
  data.bodyVerification.reads[0].fetchedUrl = 'https://docs.github.com.evil.example/fake';
  assert.equal((await runGeneralSearchChat(question, data, { mode: 'on', extract: async () => { throw Error('must not call'); } })).action, 'legacy');
});
