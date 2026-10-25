import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExtractedEvidenceFact, assessRequiredAnswerItems } from '../src/general-search-llm-extraction.js';

function check(fact, pageText) {
  return validateExtractedEvidenceFact({ sourceUrl: 'https://example.org/source', unit: '', appliesAt: null,
    requiredAnswerItems: [], uncertainties: [], ...fact }, [{ url: 'https://example.org/source', pageText }], { strictSemantic: true });
}

test('a different plan table links column header, row owner and numeric value', () => {
  const body = 'Plan Storage Minutes (per month) Cache Custom\nStarter 500 MB 1,500 10 GB Not applicable\nGrowth 2 GB 4,000 10 GB 75 GB';
  const fact = { subject: 'Starter', relation: 'free-minutes-per-month', value: '1,500', unit: 'minutes',
    quote: 'Starter 500 MB 1,500 10 GB Not applicable' };
  assert.equal(check(fact, body).status, 'verified');
  assert.equal(check({ ...fact, value: '500' }, body).status, 'rejected');
  assert.equal(check({ ...fact, subject: 'Growth' }, body).status, 'rejected');
  assert.equal(check({ ...fact, quote: 'Starter 500 MB 1,500 10 GB Not applicable', unit: 'GB' }, body).status, 'rejected');
});

test('a date belongs only to the same structured post, independent of its topic', () => {
  const body = '{rnum=1, nttCn2=연구원장 홍길동, pstgBgngDt=2026-10-19 09:00:00.0}, {rnum=2, nttCn2=대학 총장 김철수, pstgBgngDt=2026-10-21 16:00:00.0}';
  const fact = { subject: '연구원장 홍길동', relation: 'evidence-date', value: '2026-10-19',
    quote: 'pstgBgngDt=2026-10-19 09:00:00.0', appliesAt: '2026-10-19' };
  assert.equal(check(fact, body).status, 'verified');
  assert.equal(check({ ...fact, quote: 'pstgBgngDt=2026-10-21 16:00:00.0', value: '2026-10-21', appliesAt: '2026-10-21' }, body).status, 'rejected');
});

test('numeric value and unit must be linked in prose', () => {
  const body = 'Widget A costs 30 USD and includes 50 GB of storage.';
  const fact = { subject: 'Widget A', relation: 'costs', value: '30', unit: 'USD', quote: body };
  assert.equal(check(fact, body).status, 'verified');
  assert.equal(check({ ...fact, value: '50' }, body).status, 'rejected');
});

test('source ID and URL must point to the same stored page', () => {
  const fact = { sourceId: 'source-99', sourceUrl: 'https://example.org/source', subject: '고양이', relation: '포유류',
    value: '포유류', quote: '고양이는 포유류이다.' };
  const result = validateExtractedEvidenceFact(fact, [{ sourceId: 'source-1', url: fact.sourceUrl, pageText: fact.quote }], { strictSemantic: true });
  assert.equal(result.status, 'rejected');
  assert.ok(result.validationFailures.includes('source-reference-mismatch'));
});

test('comparison coverage follows the subjects in the question', () => {
  const facts = ['Alpha', 'Beta'].map((subject) => ({ subject, relation: 'supports', value: 'JSON',
    quote: `${subject} supports JSON.`, sourceUrl: 'https://example.org/source', status: 'verified', semanticStatus: 'supported' }));
  assert.equal(assessRequiredAnswerItems('Alpha vs Beta 기능 비교', facts).outcome, 'complete');
  assert.equal(assessRequiredAnswerItems('Alpha vs Beta 기능 비교', facts.slice(0, 1)).outcome, 'partial');
});
