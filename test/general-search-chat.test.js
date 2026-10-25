import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generalSearchMode, eligibleForGeneralSearch, runGeneralSearchChat } from '../src/general-search-chat.js';

const input = JSON.parse(fs.readFileSync(new URL('../tmp/general-search-focused-gemini-runner-input-20261024.json', import.meta.url)));
const run = JSON.parse(fs.readFileSync(new URL('../tmp/general-search-focused-gemini-run-20261024.json', import.meta.url)));
const focused = (id) => ({ item: input.cases.find((entry) => entry.id === id), row: run.results.find((entry) => entry.id === id) });

test('off, shadow, on use the same chatbot response boundary without external replay calls', async () => {
  const { item, row } = focused('focus-02');
  let calls = 0;
  const replayExtraction = async () => { calls += 1; return { responseSchemaValid: true, facts: row.methodB.facts }; };
  const data = { results: [{}] };
  assert.equal(generalSearchMode('unexpected'), 'off');
  assert.equal((await runGeneralSearchChat(item.question, data, { mode: 'off', pages: item.sources, replayExtraction })).action, 'legacy');
  assert.equal(calls, 0);
  const shadow = await runGeneralSearchChat(item.question, data, { mode: 'shadow', pages: item.sources, replayExtraction });
  assert.equal(shadow.action, 'legacy');
  assert.equal(shadow.outcome, 'partial');
  assert.equal(calls, 1);
  const on = await runGeneralSearchChat(item.question, data, { mode: 'on', pages: item.sources, replayExtraction });
  assert.equal(on.action, 'verified');
  assert.equal(on.outcome, 'partial');
  assert.match(on.answer, /일부만 확인/);
  assert.match(on.answer, /출처: https:\/\/docs\.github\.com/);
  assert.match(on.answer, /확인하지 못한 항목/);
  assert.equal((await runGeneralSearchChat(item.question, { failed: true }, { mode: 'on', replayExtraction })).action, 'legacy');
  assert.equal(calls, 2);
});

test('five focused questions replay from saved inputs; publication date does not establish as-of date', async () => {
  const outcomes = [];
  for (const id of ['focus-01', 'focus-02', 'focus-03', 'focus-04', 'focus-05']) {
    const { item, row } = focused(id);
    const pages = item.sources || [{ sourceId: 'source-1', url: 'https://example.org/empty', pageText: '근거 없음' }];
    const result = await runGeneralSearchChat(item.question, { results: [{}] }, {
      mode: 'on', pages, now: input.referenceTime,
      extract: async () => ({ responseSchemaValid: true, facts: row?.methodB?.facts || [] }),
    });
    outcomes.push(result.outcome);
    if (id === 'focus-05') assert.match(result.answer, /기준일 2026-10-24 적용 사실/);
  }
  assert.deepEqual(outcomes, ['hold', 'partial', 'hold', 'hold', 'partial']);
});

test('complete, Hold, false quote, and protected routes', async () => {
  const pages = [{ sourceId: 'source-1', url: 'https://example.org/fact', pageText: '고양이는 포유류이다.' }];
  const base = { subject: '고양이', relation: '포유류', value: '포유류', unit: '', sourceId: 'source-1',
    sourceUrl: pages[0].url, quote: '고양이는 포유류이다.', appliesAt: null, requiredAnswerItems: [], uncertainties: [] };
  const complete = await runGeneralSearchChat('고양이는 무엇인가?', { results: [{}] }, {
    mode: 'on', pages, extract: async () => ({ responseSchemaValid: true, facts: [base] }),
  });
  assert.equal(complete.outcome, 'complete');
  assert.match(complete.answer, /출처: https:\/\/example\.org\/fact/);
  const hold = await runGeneralSearchChat('고양이는 무엇인가?', { results: [{}] }, {
    mode: 'on', pages, extract: async () => ({ responseSchemaValid: true, facts: [{ ...base, value: '파충류' }] }),
  });
  assert.equal(hold.outcome, 'hold');
  assert.doesNotMatch(hold.answer, /파충류/);
  for (const key of ['wikiOnly', 'chess', 'weather', 'news', 'age', 'image', 'localOnly']) {
    assert.equal(eligibleForGeneralSearch('사실 질문', { [key]: true }), false);
  }
});
