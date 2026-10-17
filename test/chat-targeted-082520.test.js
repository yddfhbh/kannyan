import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compactEvidenceText, reviewSourceBodies } from '../src/evidence-review.js';
import { collectWebBodyEvidence, renderWeatherEvidence } from '../src/web-evidence.js';
import { searchWeb } from '../src/web-search.js';
import { answerChatBySource, resolveChatEvidence } from '../src/chat-search-policy.js';
const logs = JSON.parse(fs.readFileSync(new URL('./fixtures/chat-targeted-082520.json', import.meta.url)));
const mixed = logs.mixed;
const read = mixed.data.bodyVerification.reads[0];
const source = { title: read.extractedTitle, url: read.fetchedUrl, pageText: read.extractedBody, metadataText: read.extractedMetadata };
const query = `기준일: ${mixed.now}\n질문 원문: ${mixed.question}`;
const raw = JSON.parse(mixed.responses[1].raw).evidenceReviews[0];
// Explicit corrective-review double; not a new API response or live success.
const quote = source.pageText.slice(source.pageText.indexOf('2026년'), source.pageText.indexOf('○ (내일'));
const fixed = { ...raw, id: 0, quote, weatherFields: ['○ (오늘, 17일) 가끔 구름많다가 밤부터 흐려짐'] };
const item = n => ({ title: `자료 ${n}`, url: `https://source.test/${n}` });
const reject = { id: 0, relevant: false, requestSatisfied: false, quote: '', reason: '요청 조건 없음' };

test('082520 model strings cannot authorize a bulletin without its selected regional title', async () => {
  assert.equal(mixed.identity.codeSha256, '789df65f975fe454e3186da5868db1edd66381e21fe8fb078083a6e8ab15f6e1');
  for (const review of [raw, fixed]) {
    const [r] = await reviewSourceBodies(query, [source], async () => ({ evidenceReviews: [review] }));
    assert.equal(r.bodyReview.relevant, false);
    assert.ok(r.bodyReview.validationFailures.includes('weather-bulletin-scope-mismatch'));
  }
  const [r] = await reviewSourceBodies(query, [{...source,discoveredTitle:read.searchTitle}], async () => ({evidenceReviews:[raw]}));
  assert.equal(r.bodyReview.relevant,true);
  assert.equal(r.bodyReview.quote,'○ (오늘, 17일) 가끔 구름많다가 밤부터 흐려짐');
  assert.equal(r.bodyReview.publicationTime,'2026년 10월 17일 (토)요일 05:00 발표');
});

test('common collector binds actual regional title and body without trusting model paraphrases', async () => {
  let calls = 0;
  const data = await collectWebBodyEvidence('부산 날씨', { status: 'success', results: [{ title: read.searchTitle, url: source.url }] }, async () => {
    calls++;
    return { evidenceReviews: [raw] };
  }, { now: mixed.now, originalPrompt: mixed.question, readPage: async () => ({ ...source, text: source.pageText }), search: async () => { throw Error('unnecessary search'); } });
  assert.equal(calls, 1);
  assert.equal(data.results.length, 1);
  assert.equal(data.results[0].pageText, source.pageText);
  assert.equal(data.results[0].bodyReview.rawModelReview.quote, raw.quote);
  const output = await answerChatBySource(mixed.question, { searchIntent: { requiresExternal: true, hasLocalAnswer: true, independentLocalPrompt: '너 누구야?' }, plannedAnswer: { answer: '나는 깐냥이다냥.' }, verifiedExternalAnswer: renderWeatherEvidence(data, query) }, async () => { throw Error('unnecessary generation'); });
  assert.match(output.answer, /나는 깐냥.*\n\n.*예보는/);
  assert.ok(output.answer.includes('가끔 구름많다가 밤부터 흐려짐'));
  assert.ok(output.answer.includes(source.url));
});

test('weather repair never permits nonexistent text, changed numbers/date/region/kind or tomorrow rainfall', async () => {
  for (const changed of [{ quote: fixed.quote + '오늘 맑음' }, { weatherFields: ['기온 99℃'] }, { weatherFields: [...fixed.weatherFields, '기온 99℃'] }, { region: '서울' }, { validTime: '2026년 10월 18일' }, { kind: 'observation' }, { quote: source.pageText.slice(source.pageText.indexOf('2026년'), source.pageText.indexOf('선택한 지역')), weatherFields: ['부산, 울산, 경상남도: 10~50mm'] }]) {
    const [r] = await reviewSourceBodies(query, [source], async () => ({ evidenceReviews: [{ ...fixed, ...changed }] }));
    assert.equal(r.bodyReview.relevant, false, JSON.stringify(changed));
  }
});

test('general evidence excerpts preserve spaces and symbols; invented paraphrases get at most one original-text retry', async () => {
  const s = { title: 'Atlas 7 사양', url: item(0).url, pageText: 'Atlas 7\n메모리:  32 GB · 속도: 5.2 GHz' };
  assert.ok(compactEvidenceText('Atlas 7 메모리', s).includes('메모리:  32 GB · 속도: 5.2 GHz'));
  const paraphrase = { id: 0, relevant: true, requestSatisfied: true, quote: '메모리: 32 GB, 속도: 5.2 GHz' };
  let calls = 0;
  const [r] = await reviewSourceBodies('Atlas 7 메모리', [s], async () => { calls++; return { evidenceReviews: [paraphrase] }; }, { repairInvalidReviews: true });
  assert.equal(calls, 2); assert.equal(r.bodyReview.relevant, false); assert.equal(r.bodyReview.repairAttempted, true);
  const [valid] = await reviewSourceBodies('Atlas 7 메모리', [s], async () => ({ evidenceReviews: [{ ...paraphrase, quote: s.pageText }] }));
  assert.equal(valid.bodyReview.relevant, true);
});

test('corrective review respects completion reservations and keeps the invalid raw verdict', async () => {
  let calls = 0;
  const [r] = await reviewSourceBodies(query, [source], async () => { calls++; return { evidenceReviews: [raw] }; }, { repairInvalidReviews: true, canRepair: () => false });
  assert.equal(calls, 1); assert.equal(r.bodyReview.relevant, false); assert.equal(r.bodyReview.rawModelReview.quote, raw.quote);
});

test('retained general candidates are read after two searches even with zero remaining search allowance', async () => {
  const reads = []; let searches = 0;
  const result = await collectWebBodyEvidence('Atlas specifications', { status: 'success', results: [] }, async (q, opts) => {
    // Three candidates in the final search: last one is not a reviewable snippet.
    const urls = [...opts.webSearchContext.matchAll(/URL: (https:\/\/source.test\/\d+)/g)].map(m => m[1]);
    return { evidenceReviews: urls.map((url, id) => url.endsWith('/5') ? { id, relevant: true, requestSatisfied: true, quote: 'Atlas supports 32 GB.' } : { ...reject, id }), searchRefinement: { requestedSatisfied: urls.some(u => u.endsWith('/5')), queries: ['Atlas specifications revised'] } };
  }, { readPage: async url => { reads.push(url); return { url, text: 'Atlas supports 32 GB.' }; }, search: async () => ({ status: 'success', results: ++searches === 1 ? [item(1)] : [item(3), item(4), item(5)] }) });
  assert.equal(searches, 2); assert.equal(result.bodyVerification.remaining.searches, 0);
  assert.deepEqual(reads, [item(1).url, item(3).url, item(4).url, item(5).url]);
  assert.equal(result.results[0].url, item(5).url);
  assert.ok(result.bodyVerification.decisions.some(d => d.action === 'read-retained-candidates' && d.remaining.searches === 0));
});

test('retained candidates beyond display cap can supply an official first read', async () => {
  const official = { title: 'TOEFL iBT Test Fees', url: 'https://www.ets.org/toefl/test-takers/ibt/register/fees.html' };
  const reads = [];
  const result = await collectWebBodyEvidence('토플 응시료', { results: [], candidates: [official] }, async () => ({ evidenceReviews: [reject] }), { readPage: async url => { reads.push(url); return { url, text: 'Registration information without fee applicability.' }; }, search: async () => ({ status: 'empty', results: [] }) });
  assert.equal(reads[0], official.url); assert.equal(result.results.length, 0);
});

test('search diagnostics separate 202 challenges from Naver parse errors and retain undisplayed candidates', async () => {
  const failed = await searchWeb('Atlas specifications', { fetchImpl: async url => new Response(String(url).includes('duckduckgo') ? 'challenge' : '<title>Search</title><main>changed markup</main>', { status: String(url).includes('duckduckgo') ? 202 : 200 }) });
  assert.equal(failed.status, 'parse-error');
  assert.deepEqual(failed.attempts.map(a => [a.httpStatus, a.status]), [[202, 'blocked'], [200, 'parse-error']]);
  const html = Array.from({ length: 15 }, (_, i) => `<div class="result"><a class="result__a" href="https://source.test/${i}">Atlas specifications ${i}</a></div>`).join('');
  const success = await searchWeb('Atlas specifications', { maxResults: 2, fetchImpl: async () => new Response(html) });
  assert.equal(success.results.length, 2); assert.equal(success.candidates.length, 15);
  assert.deepEqual(success.resultCounts, { discovered: 15, unique: 15, returned: 2, retained: 15 });
});

test('082520 TOEFL replay separates ETS parse-error from successful followup selection and preserves three unused reads honestly', async () => {
  const f = logs['toefl-fact']; const b = f.data.bodyVerification; let searches = 0;
  const candidates = round => b.selections.filter(s => s.round === round);
  const result = await collectWebBodyEvidence('토플 응시료', { status: 'success', results: candidates(0), attempts: f.data.attempts }, async () => { throw Error('no captured review exists'); }, {
    now: f.now, originalPrompt: f.question,
    readPage: async () => { throw Object.assign(Error('timeout'), { name: 'TimeoutError' }); },
    search: async () => { const s = b.searches[searches++]; return { ...s, failed: s.status !== 'success', results: candidates(searches) }; },
  });
  assert.equal(result.bodyVerification.reads.length, 1); assert.equal(result.bodyVerification.remaining.reads, 3);
  assert.equal(result.results.length, 0); assert.equal(result.bodyVerification.searches[1].status, 'success');
  assert.ok(result.bodyVerification.failureEvents.some(e => e.stage === 'search' && e.status === 'parse-error'));
  assert.ok(result.bodyVerification.failureEvents.some(e => e.stage === 'body-read' && e.error.category === 'timeout'));
  const decision = resolveChatEvidence({ requiresExternal: true, externalPrompt: f.question }, { webSearchData: result });
  assert.match(decision.unavailable, /검색 횟수 한도/); assert.match(decision.unavailable, /시간 초과/); assert.match(decision.unavailable, /결과 형식/);
  assert.doesNotMatch(decision.unavailable, /자료 조회 요청이 실패/);
});

test('Korean fee still needs country, test type and validity even on the official domain', async () => {
  for (const body of ['TOEFL iBT test fee $220', '한국 TOEFL iBT 응시료 $220', '한국 TOEFL iBT 응시료 $220 게시일 2026-10-17']) {
    const [r] = await reviewSourceBodies('한국 iBT 토플 응시료', [{ title: 'Test Fees', url: 'https://www.ets.org/toefl/fees.html', pageText: body }], async () => ({ evidenceReviews: [{ id: 0, relevant: true, quote: body }] }));
    assert.equal(r.bodyReview.relevant, false); assert.equal(r.bodyReview.requestMismatch, 'fee-applicability-unverified');
  }
});
