import { generator } from './helpers/captured-chat-generator.js';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { runtime, declaration } from '../scripts/lib/chat-verification-runtime.js';
import { parseGeminiAnswerPayload } from '../src/gemini-answer.js';
import { getChatClock } from '../src/chat-clock.js';
import { selectGeminiContextSections } from '../src/gemini-context.js';
import { validateChatCitationsWithStatus } from '../src/chat-evidence.js';
import { chatSourcePlanGuidance, resolveChatSourcePlan } from '../src/chat-source-plan.js';
import { answerChatBySource } from '../src/chat-search-policy.js';
import { reviewSourceBodies } from '../src/evidence-review.js';
import { collectWebBodyEvidence, renderWeatherEvidence } from '../src/web-evidence.js';
import { answerVerifiedNews } from '../src/news-evidence.js';
import { startChatBudget, chatStageTimeout } from '../src/chat-time-budget.js';
import { requestChatWithFallback } from '../src/gemini-chat-request.js';
import { classifyChatError } from '../src/chat-errors.js';
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/chat-log-20261016-211818.json', import.meta.url)));
const replayOutputs = [];
after(() => fs.writeFileSync(new URL('../tmp/followup-new-replay-results.json', import.meta.url), JSON.stringify({ fixtureCodeSha256: fixtures[0].codeSha256, results: replayOutputs }, null, 2)));
const fixture = (id) => fixtures.find((f) => f.id === id);
const response = (f, stage) => JSON.parse(f.trace.find((e) => e.event === 'model-response' && e.stage === stage).raw);
const searchData = (f) => f.trace.find((e) => e.event === 'tryBuildWebSearchData')?.result;
const message = (q) => ({content:`%${q}`,author:{id:'replay',username:'Replay'},guildId:'g',channelId:'c',client:{user:{username:'깐냥'}},attachments:new Map(),channel:{send:async()=>{}}});
// Invoke the production JSON parser, context selection and citation processing,
// replacing only the transport with captured provider strings.

test('captured final TOEFL abstention cannot become the planning estimate after a verifier exception', async () => {
  const f = fixture('toefl-fact');
  assert.match(f.originalFinal.join('\n'),/220|20만/);
  const planned = resolveChatSourcePlan(response(f,'planning'),f.question);
  assert.equal(planned.result.answer,'');
  assert.equal(planned.intent.hasLocalAnswer,false);
  const raw = f.trace.find((e)=>e.event==='model-response'&&e.stage==='answer').raw;
  const g = generator([raw]);
  const original = g.generate;
  g.generate = async (q, opts) => {
    if (opts.evidenceReview) throw Object.assign(new Error('Stage time reserved for completion'),{code:'CHAT_STAGE_TIME_LIMIT',remainingStageMs:1});
    return original(q,opts);
  };
  const r = runtime({search:searchData(f)});
  r.context.generateGeminiAnswer = async (q,opts) => opts.planSearch ? response(f,'planning') : g.generate(q,opts);
  await r.context.handleGeminiFallbackMessage(message(f.question),{now:new Date(f.now)});
  replayOutputs.push({ id: f.id, answer: r.sent[0], verifier: 'recorded local exception reproduced', transport: 'captured raw model response' });
  assert.equal(r.sent[0],response(f,'answer').answer);
  assert.doesNotMatch(r.sent[0],/220|20만|9700|2278|2007/);
});

test('captured historical totals are rejected for current unit fees despite relevant=true', async () => {
  const f=fixture('toefl-fact'), data=searchData(f);
  const sources=data.bodyVerification.reads.filter((r)=>r.extractedBody).map((r)=>({title:r.extractedTitle,url:r.fetchedUrl,pageText:r.extractedBody,metadataText:r.extractedMetadata}));
  // The second accepted item was a search snippet, preserved in results.
  sources.push(data.results[0]);
  const raw=f.trace.find((e)=>e.event==='model-response'&&e.stage==='evidence-review').raw;
  const g=generator([raw]);
  const reviewed=await reviewSourceBodies(`기준일: ${f.now}\n${f.question}`,sources,g.generate);
  replayOutputs.push({ id: 'toefl-current-fee-evidence', reviews: reviewed.map((r) => r.bodyReview) });
  assert.equal(reviewed.filter((r)=>r.bodyReview.relevant).length,0);
  assert.match(reviewed[1].bodyReview.requestMismatch,/missing-attribute/);
  assert.equal(g.payloads[0].generationConfig.responseSchema.properties.answer,undefined);
  assert.equal(g.payloads[0].generationConfig.responseSchema.properties.evidenceReviews.items.properties.weatherFields,undefined);
});

test('captured October 17 forecast cannot answer the October 16 request', async () => {
  const f=fixture('weather'), data=searchData(f);
  assert.match(f.originalFinal[0],/17일/);
  assert.equal(renderWeatherEvidence(data,f.question,f.now),'');
  const sources=data.bodyVerification.reads.filter((r)=>r.extractedBody).map((r)=>({title:r.extractedTitle,url:r.fetchedUrl,pageText:r.extractedBody,metadataText:r.extractedMetadata}));
  const reviewed=await reviewSourceBodies(`기준일: ${f.now}\n${f.question}`,sources,generator([f.trace.find((e)=>e.event==='model-response'&&e.stage==='evidence-review').raw]).generate);
  assert.equal(reviewed.filter((r)=>r.bodyReview.relevant).length,0);
  replayOutputs.push({ id: f.id, answer: renderWeatherEvidence(data,f.question,f.now), reviews: reviewed.map((r) => r.bodyReview) });
  assert.equal(reviewed[1].bodyReview.requestMismatch,'weather-target-date-mismatch');
});

test('exact runtime exception is a local stage reservation, and final review may use the remaining time', async () => {
  const payload={generationConfig:{responseSchema:{properties:{evidenceReviews:{}}}}};
  startChatBudget(9000);
  try {
    let calls=0;
    // The old final-review payload follows the retrieval reservation path.
    await assert.rejects(requestChatWithFallback(payload,{models:['replay'],keys:['fixture'],request:async()=>{calls++;}}),(error)=>{
      assert.equal(error.code,'CHAT_STAGE_TIME_LIMIT');
      assert.equal(error.message,'Stage time reserved for completion');
      assert.match(error.stack,/gemini-chat-request.js/);
      assert.equal(classifyChatError(error).category,'time-reservation');
      assert.equal(calls,0);
      return true;
    });
    payload[Symbol.for('chat.finalVerification')]=true;
    assert.ok(chatStageTimeout(payload)>7000);
    await requestChatWithFallback(payload,{models:['replay'],keys:['fixture'],request:async()=>{calls++;return {};}});
    assert.equal(calls,1);
  } finally {startChatBudget();}
});

test('both captured news summaries survive citation processing and reach one strict final review', async () => {
  const f=fixture('news'), data=searchData(f);
  const raws=f.trace.filter((e)=>e.event==='model-response'&&e.stage==='answer').map((e)=>e.raw);
  const g=generator([...raws]);
  const candidates=[];
  let reviews=0;
  const output=await answerVerifiedNews(data,async(q,opts)=>{
    if (!opts.evidenceReview) return g.generate(q,opts);
    reviews++;
    assert.equal(opts.finalVerification,true);
    assert.match(opts.webSearchContext,/요약 후보/);
    candidates.push(opts.webSearchContext);
    // No successful validator output was recorded. This test checks transport
    // and candidate preservation only; this verdict is an explicit test double.
    return {evidenceReviews:data.results.map((s,id)=>({id,relevant:true,requestSatisfied:true,quote:s.bodyReview.quote}))};
  });
  replayOutputs.push({ id: 'news', answer: output, verifier: 'explicit successful test double; original log has no completed validator response', transport: 'captured raw summary responses through production generator' });
  assert.equal(reviews,1);
  for (const raw of raws) assert.ok(output.includes(JSON.parse(raw).answer));
  assert.match(candidates[0],/FTC/);
  assert.doesNotMatch(output,/요약 검증에 실패/);
  // A rejection remains a rejection; preserved generation is not auto-approval.
  const rejected=await answerVerifiedNews(data,async(q,opts)=>opts.evidenceReview ? {evidenceReviews:data.results.map((_,id)=>({id,relevant:false,quote:''}))} : {answer:'모든 AI 서비스 가격이 내렸다냥.',citationsValid:true});
  assert.doesNotMatch(rejected,/모든 AI 서비스/);
  assert.match(rejected,/요약 검증에 실패/);
});

for(const id of ['wiki','mixed','toefl-search','self-answer','product-comparison']) test(`candidate log ${id} finishes through the actual handler`,async()=>{
  const f=fixture(id);
  const r=runtime({search:searchData(f),wiki:f.trace.find((e)=>e.event==='tryBuildPyhokWikiSearchData')?.result});
  r.context.generateGeminiAnswer=async(q,opts)=>{
    if(opts.planSearch)return response(f,'planning');
    const raw=f.trace.find((e)=>e.event==='model-response'&&e.stage===(opts.evidenceReview?'evidence-review':'answer'))?.raw;
    assert.ok(raw,'Missing captured response is not a successful generation');
    return parseGeminiAnswerPayload(raw);
  };
  await r.context.handleGeminiFallbackMessage(message(f.question),{now:new Date(f.now)});
  replayOutputs.push({ id, answer: r.sent[0], transport: 'captured planning and evidence through production handler' });
  assert.equal(r.sent.length,1);
  if(id==='wiki')assert.match(r.sent[0],/2007-09-14.*19세/s);
  if(id==='mixed')assert.match(r.sent[0],/CODEX가 만든 고양이귀 미소녀 챗봇 깐냥/);
  if(id==='product-comparison')assert.match(r.sent[0],/확인하지 못/);
});

test('comparison rejection still proceeds to attribute-bearing subject searches when budget permits',async()=>{
  startChatBudget();
  const f=fixture('product-comparison'),d=searchData(f),reads=d.bodyVerification.reads;
  const queries=[];
  const data=await collectWebBodyEvidence(f.question,{status:'success',results:reads.map((r)=>({url:r.requestedUrl,title:r.searchTitle}))},async()=>response(f,'evidence-review'),{
    now:f.now,readPage:async(url)=>{const r=reads.find((s)=>s.requestedUrl===url);return {url,title:r.extractedTitle,text:r.extractedBody};},
    search:async(q)=>{queries.push(q);return {status:'empty',results:[]};},
    getRemainingBudget:()=>({modelRequests:4,httpRequests:20,durationMs:30000}),
  });
  assert.deepEqual(queries,['"gpt 6 sol" official documentation','"gpt 6.1 sol" official documentation']);
  assert.equal(data.results.length,0);
});

test('malformed validator outputs report schema errors while unsupported content is rejected normally',async()=>{
  const source={title:'Source',url:'https://source.test',pageText:'원문에 적힌 실제 속성이다.'};
  for(const raw of ['not-json','{"answer":"","evidenceReviews":{}}','{"answer":""}']) {
    await assert.rejects(reviewSourceBodies('요청 속성',[source],generator([raw]).generate),(error)=>{
      const diagnostic=classifyChatError(error);
      assert.equal(diagnostic.code,'EVIDENCE_REVIEW_SCHEMA');
      assert.equal(diagnostic.category,'schema');
      assert.equal(diagnostic.location,'src/index.js:generateGeminiAnswer');
      assert.ok(error.reviewMetrics.inputChars>0);
      return true;
    });
  }
  const [rejected]=await reviewSourceBodies('요청 속성',[source],generator(['{"evidenceReviews":[{"id":0,"relevant":false,"requestSatisfied":false,"quote":"","reason":"요청 속성이 없음"}]}']).generate);
  assert.equal(rejected.bodyReview.status,'reviewed');
  assert.equal(rejected.bodyReview.relevant,false);
});
