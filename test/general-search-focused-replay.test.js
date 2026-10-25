import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseEvidenceExtractionResponse, assessRequiredAnswerItems } from '../src/general-search-llm-extraction.js';
import { assessFocusedCase } from '../src/general-search-focused-assessment.js';

const input = JSON.parse(fs.readFileSync(new URL('../tmp/general-search-focused-gemini-runner-input-20261024.json', import.meta.url)));
const run = JSON.parse(fs.readFileSync(new URL('../tmp/general-search-focused-gemini-run-20261024.json', import.meta.url)));
const caseFor = (id) => ({ item: input.cases.find((item) => item.id === id), row: run.results.find((row) => row.id === id) });
const verify = (fact, item) => parseEvidenceExtractionResponse({ facts: [fact] }, item.sources, { strictSemantic: true }).facts[0];

test('저장된 8건은 실제 실행기 파서에서 인용·UTF-16 위치가 맞고 두 사례 모두 Partial이다', () => {
  for (const id of ['focus-02', 'focus-05']) {
    const { item, row } = caseFor(id);
    const parsed = parseEvidenceExtractionResponse(JSON.stringify({ facts: row.methodB.facts }), item.sources, { strictSemantic: true });
    assert.equal(parsed.facts.length, id === 'focus-02' ? 6 : 2);
    for (const [index, fact] of parsed.facts.entries()) {
      assert.equal(fact.status, 'verified', `${id}: ${fact.subject} ${fact.relation}`);
      assert.deepEqual(fact.sourceSpan, row.methodB.facts[index].sourceSpan);
      assert.equal(item.sources.find((source) => source.url === fact.sourceUrl).pageText.slice(fact.sourceSpan.start, fact.sourceSpan.end), fact.quote);
    }
    const assessment = assessFocusedCase(item, parsed.facts, assessRequiredAnswerItems(item.question, parsed.facts, { referenceTime: input.referenceTime }));
    assert.equal(assessment.outcome, 'partial');
    assert.deepEqual(assessment.missing, id === 'focus-02' ? ['unit-price-table'] : ['incumbency-at-2026-10-24']);
  }
});

test('GitHub Free 2,000분을 20,000분으로 잘못 읽으면 거부한다', () => {
  const { item, row } = caseFor('focus-02');
  const fact = verify({ ...row.methodB.facts[0], value: '20,000' }, item);
  assert.equal(fact.status, 'rejected');
  assert.ok(fact.validationFailures.includes('table-value-column-mismatch'));
});

test('GitHub Pro에 Team 행을 붙이면 두 요금제의 숫자가 같아도 거부한다', () => {
  const { item, row } = caseFor('focus-02');
  const team = row.methodB.facts[3];
  const fact = verify({ ...row.methodB.facts[1], quote: team.quote, sourceSpan: team.sourceSpan }, item);
  assert.equal(fact.status, 'rejected');
  assert.ok(fact.validationFailures.length > 0);
});

test('50 GB 저장소 용량을 실행 단가나 실행 시간으로 읽으면 거부한다', () => {
  const { item, row } = caseFor('focus-02');
  const enterprise = row.methodB.facts[4];
  const minutes = verify({ ...enterprise, value: '50', unit: 'minutes' }, item);
  const price = verify({ ...enterprise, relation: 'unit-price', value: '50 GB', unit: 'GB' }, item);
  assert.equal(minutes.status, 'rejected');
  assert.equal(price.status, 'rejected');
});

test('원문에 없는 단위 가격과 관계 표현은 거부한다', () => {
  const { item, row } = caseFor('focus-02');
  const fact = verify({ ...row.methodB.facts[5], relation: 'unit-price', value: '$0.01', unit: 'USD/minute' }, item);
  assert.equal(fact.status, 'rejected');
  assert.ok(fact.validationFailures.length > 0);
});

test('장관 게시물 밖의 날짜는 evidence-date로 승인하지 않는다', () => {
  const { item, row } = caseFor('focus-05');
  const quote = 'pstgBgngDt=2026-10-21 16:00:00.0';
  const date = verify({ ...row.methodB.facts[1], quote, value: '2026-10-21', appliesAt: '2026-10-21' }, item);
  assert.equal(date.status, 'rejected');
  assert.ok(date.validationFailures.includes('claim-subject-value-not-linked'));
});
