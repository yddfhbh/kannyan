import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runtime } from '../scripts/lib/chat-verification-runtime.js';
import { reviewSourceBodies } from '../src/evidence-review.js';
import { renderWeatherEvidence } from '../src/web-evidence.js';
import { summarizeTimings, summarizeVerification } from '../scripts/lib/chat-verification-report.js';
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/chat-log-20261016.json', import.meta.url)));
const message = (q) => ({ content:`%${q}`, author:{ id:'replay', username:'Replay' }, guildId:'replay', channelId:'replay', client:{user:{username:'깐냥'}}, attachments:new Map(), channel:{send:async()=>{}} });
for (const id of ['wiki','mixed']) test(`actual ${id} log uses production final handler`, async () => {
  const f = fixtures.find((f) => f.id === id);
  const planning = JSON.parse(f.trace.find((e) => e.event === 'model-response' && e.stage === 'planning').raw);
  let search = f.trace.find((e) => e.event === 'tryBuildWebSearchData')?.result;
  if (id === 'mixed') {
    // Revalidate the exact accepted sources and model reviews from the log.
    const sources = search.results;
    const reviewed = await reviewSourceBodies(f.question, sources, async () => ({ evidenceReviews:sources.map((s,id) => ({ ...s.bodyReview, id })) }));
    assert.equal(reviewed.filter((s) => s.bodyReview.relevant).length, 0);
    search = {...search, results:[], status:'insufficient-evidence', context:''};
  }
  const r = runtime({wiki:f.trace.find((e) => e.event === 'tryBuildPyhokWikiSearchData')?.result, search});
  let calls = 0;
  r.context.generateGeminiAnswer = async (_q, opts) => {
    calls++;
    assert.equal(opts.planSearch, true, 'pure wiki and recovered mixed answer must not regenerate the external question');
    return planning;
  };
  await r.context.handleGeminiFallbackMessage(message(f.question));
  assert.equal(calls, 1);
  const answer = r.sent.join('\n');
  assert.doesNotMatch(answer, /자료 지역:|자료 대상 시각:|확인한 필드:|확인한 본문:|잠시|찾아보고/);
  if (id === 'wiki') {
    assert.match(answer, /2007-09-14/);
    assert.match(answer, /19세/);
    assert.doesNotMatch(answer, /공식 자료나 정보가 없다|확인 불가/);
  } else assert.match(answer, /고양이귀 미소녀 챗봇 깐냥/);
});
test('logged FAQ and forecast instructions cannot render current weather', () => {
  const f = fixtures.find((f) => f.id === 'mixed');
  assert.equal(renderWeatherEvidence(f.trace.find((e) => e.event === 'tryBuildWebSearchData').result), '');
});
test('overlapping nested durations are separate from wall time and 503 time', () => {
  const t = summarizeTimings([
    {event:'tryBuildWebSearchData', startedAt:100,endedAt:30100,durationMs:30000},
    {event:'collectWebBodyEvidence', startedAt:200,endedAt:30100,durationMs:29900},
    {event:'tryBuildPyhokWikiSearchData', startedAt:100,endedAt:300,durationMs:200},
    {event:'model-error',status:503,durationMs:3000},
  ], 39000);
  assert.equal(t.evidenceCollectionMs,30000);
  assert.equal(t.evidenceCollectionWorkMs,60100);
  assert.equal(t.elapsedMs,39000);
  assert.equal(t.serviceUnavailableMs,3000);
});
for (const f of fixtures) test(`logged ${f.id} reports execution independently of content verification`, () => {
  const v = summarizeVerification(f.trace,f.originalFinal);
  if(f.originalFinal.some((s) => /https?:\/\//.test(s))) assert.equal(v.claimSourceMatch,'unverified');
  assert.equal(v.qualityPassed,false);
  if (f.trace.some((e) => e.result?.results?.length)) assert.equal(v.search,'success');
});

test('remaining time stops optional searches, retries and model completion while preserving verified excerpts', async () => {
  const { startChatBudget, canCollectEvidence } = await import('../src/chat-time-budget.js');
  const { requestChatWithFallback } = await import('../src/gemini-chat-request.js');
  const { answerChatBySource } = await import('../src/chat-search-policy.js');
  const f = fixtures.find((f) => f.id === 'product-comparison');
  const data = f.trace.find((e) => e.event === 'tryBuildWebSearchData').result;
  const evidence = data.results.filter((s) => s.bodyReview?.relevant);
  assert.ok(evidence.length);
  startChatBudget(1000);
  try {
    assert.equal(canCollectEvidence(),false);
    let requests = 0;
    await assert.rejects(requestChatWithFallback({}, {models:['a','b'],keys:['test'],request:async()=>{requests++;}}), /Stage time reserved/);
    assert.equal(requests,0);
    const result = await answerChatBySource(f.question, {
      searchIntent:{requiresExternal:true,hasLocalAnswer:false}, evidenceDecision:{hasEvidence:true}, webEvidence:evidence,
    }, async()=>{throw Error('completion must not run');});
    assert.equal(result.answerVerification.status,'excerpt-only');
    assert.ok(result.answer.includes(evidence[0].bodyReview.quote));
    assert.doesNotMatch(result.answer,/자료 종류:|확인한 본문:/);
  } finally { startChatBudget(); }
});

for (const f of fixtures.filter((f) => !['wiki','mixed'].includes(f.id))) test(`actual ${f.id} materials finish through the production handler`, async () => {
  const planning = JSON.parse(f.trace.find((e) => e.event === 'model-response' && e.stage === 'planning').raw);
  const r = runtime({
    wiki:f.trace.find((e) => e.event === 'tryBuildPyhokWikiSearchData')?.result,
    search:f.trace.find((e) => e.event === 'tryBuildWebSearchData')?.result ?? {status:'timeout', failed:true, results:[], context:''},
  });
  r.context.generateGeminiAnswer = async (_q, opts) => {
    if (opts.planSearch) return planning;
    const recorded = f.trace.find((e) => e.event === 'model-response' && e.stage === (opts.evidenceReview?'evidence-review':'answer'));
    if (recorded) return JSON.parse(recorded.raw);
    throw Object.assign(new Error('No completed answer response in the captured log'), { code:'REPLAY_RECORDED_TIMEOUT' });
  };
  await r.context.handleGeminiFallbackMessage(message(f.question), {now:new Date(f.now)});
  assert.equal(r.sent.length,1);
  assert.ok(r.sent[0].trim());
  assert.doesNotMatch(r.sent[0], /자료 지역:|자료 대상 시각:|확인한 필드:|확인한 본문:/);
});
