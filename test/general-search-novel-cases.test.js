import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExtractedEvidenceFact, assessRequiredAnswerItems } from '../src/general-search-llm-extraction.js';
import { selectGeneralSearchSources, sourceSelectionProfile } from '../src/general-search-source-selection.js';

// Synthetic, offline development cases. No saved search result or sealed fixture is read.
export const novelCases = [
  { topic: 'saas-pricing', question: 'Aster Cloud Starter 요금제의 월 API 호출량은?', body: 'Plan | Monthly API calls | Seats\nStarter | 12,000 | 3\nTeam | 48,000 | 10',
    good: { subject: 'Starter', relation: 'Monthly API calls', value: '12,000', unit: 'calls', quote: 'Starter | 12,000 | 3' },
    bad: { subject: 'Starter', relation: 'Monthly API calls', value: '48,000', unit: 'calls', quote: 'Team | 48,000 | 10' } },
  { topic: 'specifications', question: 'Luma One과 Nexo Two 메모리 사양 비교', body: 'Model | Memory | Display\nLuma One | 16 GB | 14 in\nNexo Two | 32 GB | 15 in',
    good: { subject: 'Luma One', relation: 'Memory', value: '16', unit: 'GB', quote: 'Luma One | 16 GB | 14 in' },
    bad: { subject: 'Luma One', relation: 'Memory', value: '32', unit: 'GB', quote: 'Nexo Two | 32 GB | 15 in' } },
  { topic: 'documentation', question: 'Vela client의 timeout 사용 방법', body: 'To set a timeout, call client.request with timeout: 30 and then await the result.',
    good: { subject: 'client.request', relation: 'timeout', value: '30', unit: '', quote: 'call client.request with timeout: 30' },
    bad: { subject: 'client.request', relation: 'retries', value: '30', unit: '', quote: 'call client.request with timeout: 30' } },
  { topic: 'official-announcement', question: 'Northland Energy Agency의 새 의장과 발표 날짜는?', body: 'Announcement: Mira Sol appointed chair of Northland Energy Agency on 2026-09-18.\nAnnouncement: Leo Tan appointed director on 2026-09-22.',
    good: { subject: 'Mira Sol', relation: 'announcement date', value: '2026-09-18', unit: '', quote: 'Mira Sol appointed chair of Northland Energy Agency on 2026-09-18.', appliesAt: '2026-09-18' },
    bad: { subject: 'Mira Sol', relation: 'announcement date', value: '2026-09-22', unit: '', quote: 'Leo Tan appointed director on 2026-09-22.', appliesAt: '2026-09-22' } },
  { topic: 'release', question: 'FjordDB 4.2 정식 출시 여부', body: 'FjordDB 4.2 beta was published on 2026-08-01.\nFjordDB 4.1 stable was released on 2026-07-20.',
    good: { subject: 'FjordDB 4.2', relation: 'release status', value: 'beta', unit: '', quote: 'FjordDB 4.2 beta was published on 2026-08-01.' },
    bad: { subject: 'FjordDB 4.2', relation: 'release status', value: 'stable', unit: '', quote: 'FjordDB 4.1 stable was released on 2026-07-20.' } },
  { topic: 'event', question: '2026-11-03 Port Azure에서 열리는 Data Summit 행사 장소는?', body: 'Event | Date | City | Venue\nData Summit | 2026-11-03 | Port Azure | Civic Hall\nData Forum | 2026-11-03 | Port Azure | River Center',
    good: { subject: 'Data Summit', relation: 'venue', value: 'Civic Hall', unit: '', quote: 'Data Summit | 2026-11-03 | Port Azure | Civic Hall' },
    bad: { subject: 'Data Summit', relation: 'venue', value: 'River Center', unit: '', quote: 'Data Forum | 2026-11-03 | Port Azure | River Center' } },
  { topic: 'reordered-pricing', question: 'Birch Pro의 연간 가격은?', body: 'Annual price | Tier | Currency | Monthly price\n240 | Pro | USD | 25\n90 | Basic | USD | 10',
    good: { subject: 'Pro', relation: 'Annual price', value: '240', unit: 'USD', quote: '240 | Pro | USD | 25' },
    bad: { subject: 'Pro', relation: 'Annual price', value: '25', unit: 'USD', quote: '240 | Pro | USD | 25' } },
];

function verify(item, fact) {
  return validateExtractedEvidenceFact({ sourceUrl: 'https://example.org/novel', appliesAt: null, requiredAnswerItems: [], uncertainties: [], ...fact },
    [{ url: 'https://example.org/novel', pageText: item.body }], { strictSemantic: true });
}

test('novel offline facts accept the supported claim and reject the crossed claim', () => {
  const results = [];
  for (const item of novelCases) {
    const good = verify(item, item.good);
    const bad = verify(item, item.bad);
    results.push({ topic: item.topic, good: good.status, bad: bad.status,
      span: Boolean(good.sourceSpan && item.body.slice(good.sourceSpan.start, good.sourceSpan.end) === item.good.quote),
      badSpan: Boolean(bad.sourceSpan && item.body.slice(bad.sourceSpan.start, bad.sourceSpan.end) === item.bad.quote),
      outcome: assessRequiredAnswerItems(item.question, good.status === 'verified' ? [good] : []).outcome,
      rejectedOutcome: assessRequiredAnswerItems(item.question, bad.status === 'verified' ? [bad] : []).outcome });
  }
  console.log('NOVEL_METRICS', JSON.stringify(results));
  assert.deepEqual(results.filter((result) => result.good !== 'verified' || result.bad !== 'rejected' || !result.span || !result.badSpan || result.rejectedOutcome !== 'hold'), [], 'novel case failures');
  assert.deepEqual(results.map((result) => result.outcome), ['partial', 'partial', 'complete', 'complete', 'partial', 'complete', 'complete']);
});

test('unseen service discovery uses topical evidence and explicit site boundaries', () => {
  const question = 'Aster Cloud Starter 요금제 가격';
  assert.deepEqual(sourceSelectionProfile(question).requiredHosts, []);
  const candidates = [
    { url: 'https://aster.example/pricing/starter', title: 'Aster Cloud Starter pricing', pageText: 'Starter | 12 USD per month' },
    { url: 'https://unrelated.example/', title: 'Home', pageText: 'Unrelated content' },
  ];
  assert.equal(selectGeneralSearchSources(question, candidates).selected[0].url, candidates[0].url);
  assert.equal(selectGeneralSearchSources(question, candidates, { siteQuery: 'site:aster.example/pricing' }).selected.length, 1);
  const fact = validateExtractedEvidenceFact({ subject: 'Starter', relation: 'price', value: '12', unit: 'USD', quote: 'Starter price 12 USD per month.', sourceUrl: candidates[0].url, appliesAt: null },
    [{ url: candidates[0].url, pageText: 'Starter price 12 USD per month.' }], { strictSemantic: true });
  assert.equal(fact.status, 'verified');
  assert.equal(assessRequiredAnswerItems('Aster Cloud Starter 공식 가격', [fact]).outcome, 'hold');
});
