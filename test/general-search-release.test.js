import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleForGeneralSearch, runGeneralSearchChat } from '../src/general-search-chat.js';

const pages = [{ sourceId: 'source-1', url: 'https://example.org/facts', pageText: '고양이는 포유류이다.' }];
const fact = { subject: '고양이', relation: '포유류', value: '포유류', unit: '', sourceId: 'source-1',
  sourceUrl: pages[0].url, quote: '고양이는 포유류이다.', appliesAt: null, requiredAnswerItems: [], uncertainties: [] };
const run = (question, facts) => runGeneralSearchChat(question, { results: [{}] }, {
  mode: 'on', pages, extract: async () => ({ responseSchemaValid: true, facts }),
});

test('Complete, Partial and Hold expose only source-matched quotations and URLs', async () => {
  const complete = await run('고양이는 무엇인가?', [fact]);
  assert.equal(complete.outcome, 'complete');
  assert.match(complete.answer, /고양이는 포유류이다\./);
  assert.match(complete.answer, /출처: https:\/\/example\.org\/facts/);

  const partial = await run('고양이와 강아지의 분류를 비교해 줘', [fact]);
  assert.equal(partial.outcome, 'partial');
  assert.match(partial.answer, /일부만 확인/);

  const hold = await run('고양이는 무엇인가?', [{ ...fact, quote: '고양이는 파충류이다.' }]);
  assert.equal(hold.outcome, 'hold');
  assert.doesNotMatch(hold.answer, /파충류|example\.org/);
});

test('failed search and extraction errors use the existing fallback', async () => {
  assert.equal((await runGeneralSearchChat('질문', { failed: true }, { mode: 'on' })).action, 'legacy');
  const error = await runGeneralSearchChat('고양이는 무엇인가?', { results: [{}] }, {
    mode: 'on', pages, extract: async () => { throw new Error('API unavailable'); },
  });
  assert.equal(error.action, 'legacy');
  assert.equal(error.reason, 'extraction-error');
});

test('weather, wiki, chess and image routes stay outside general search', () => {
  for (const key of ['wikiOnly', 'chess', 'weather', 'news', 'age', 'image', 'localOnly']) {
    assert.equal(eligibleForGeneralSearch('질문', { [key]: true }), false);
  }
});
