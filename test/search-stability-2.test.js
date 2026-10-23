import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewSourceBodies } from '../src/evidence-review.js';
import { inferOfficialDomains } from '../src/web-search.js';
import { parseNewsFreshnessDays } from '../src/news-evidence.js';
import { rankNewsCandidates } from '../src/news-candidates.js';

test('weather relative dates resolve in KST and keep tomorrow separate from publication day', async () => {
  const quote = '2026년 10월 24일 부산은 구름많음, 최저 15도, 최고 22도, 강수확률 20%로 예보된다.';
  const [result] = await reviewSourceBodies(
    '기준일: 2026-10-23T00:00:00.000Z\n질문 원문: 내일 부산 날씨는 어때?',
    [{ title: '부산 예보', url: 'https://weather.test/busan', pageText: quote }],
    async () => ({ evidenceReviews: [{
      id: 0, relevant: true, requestSatisfied: true, quote,
      region: '부산', validTime: '2026년 10월 24일', kind: 'forecast', dataType: 'prose',
      weatherFields: ['구름많음', '15도', '22도', '20%'],
    }] }),
  );
  assert.equal(result.bodyReview.relevant, true);
  assert.equal(result.bodyReview.validTime, '2026년 10월 24일');
});

test('news freshness follows the requested window and official software domains are discovery hints', () => {
  assert.equal(parseNewsFreshnessDays('최근 일주일 AI 뉴스 2개'), 7);
  assert.equal(parseNewsFreshnessDays('최근 14일 AI 뉴스'), 14);
  assert.deepEqual(inferOfficialDomains('Node.js 최신 LTS 버전 공식 사이트'), ['nodejs.org']);
  const ranked = rankNewsCandidates([
    { title: 'AI 기사', url: 'https://news.test/2026/10/15/story', publishedAt: '2026-10-15T00:00:00Z' },
    { title: 'AI 오래된 기사', url: 'https://news.test/2026/10/01/story', publishedAt: '2026-10-01T00:00:00Z' },
  ], '2026-10-16T00:00:00Z', { freshnessDays: 7 });
  assert.equal(ranked.find((item) => item.candidate.title === 'AI 기사').eligible, true);
  assert.equal(ranked.find((item) => item.candidate.title === 'AI 오래된 기사').reason, 'stale-or-future-discovery-date');
});
