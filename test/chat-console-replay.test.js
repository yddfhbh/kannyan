import { formatChatDisplayAnswer } from '../src/chat-display.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generator } from './helpers/captured-chat-generator.js';
import { runtime } from '../scripts/lib/chat-verification-runtime.js';
import { reviewSourceBodies, evidenceRequestMismatch } from '../src/evidence-review.js';
import { collectWebBodyEvidence } from '../src/web-evidence.js';
import { answerChatBySource } from '../src/chat-search-policy.js';
import { validateChatCitationsWithStatus, extractCitationUrls } from '../src/chat-evidence.js';
import { createVerificationBudget } from '../scripts/lib/chat-verification-budget.js';
import { createVerificationSerializer } from '../scripts/lib/chat-verification-redaction.js';
import { requestChatWithFallback } from '../src/gemini-chat-request.js';
import { classifyChatError } from '../src/chat-errors.js';

const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/chat-log-20261016-234402.json', import.meta.url)));
const fixture = id => fixtures.find(f => f.id === id);
const event = (f, name) => f.trace.find(e => e.event === name);
const raw = (f, stage) => f.trace.find(e => e.event === 'model-response' && e.stage === stage)?.raw;
const message = q => ({content:`%${q}`,author:{id:'replay',username:'Replay'},guildId:'g',channelId:'c',client:{user:{username:'깐냥'}},attachments:new Map(),channel:{send:async()=>{}}});

test('captured TOEFL URL matches the delivered manifest after Korean closing prose; unrelated URLs still fail', async () => {
  const f = fixture('toefl-search');
  assert.equal(f.worktreeIdentity.codeSha256, 'e69368b6e02abc9f1bc96bc2662b32bbad9c0696db4635fc33fd2324fa85755b');
  const evidence = f.trace.find(e => e.event === 'model-input' && e.grounding.includes('근거 범위:'))?.grounding
    ?? f.trace.filter(e => e.event === 'model-input').at(-1).grounding;
  const answer = JSON.parse(raw(f, 'answer')).answer;
  assert.deepEqual(f.final, ['제공된 자료에서 답변의 출처를 확인하지 못했다냥.']);
  const g = generator([raw(f, 'answer')]);
  const result = await g.generate(f.question, { webSearchContext: evidence });
  assert.equal(result.citationsValid, true);
  assert.equal(result.answer, answer);
  assert.ok(extractCitationUrls(evidence).includes(extractCitationUrls(answer)[0]));
  assert.equal(validateChatCitationsWithStatus(answer.replace('blog.toptedu.co.kr', 'evil.test'), evidence).valid, false);
  assert.equal(validateChatCitationsWithStatus('주장 [99]', evidence).valid, false);
  assert.deepEqual(extractCitationUrls('https://en.wikipedia.org/wiki/Test_(example))를 참고'), ['https://en.wikipedia.org/wiki/Test_(example)']);
  // The captured body gives an amount, but no country/test type. URL identity
  // alone must not make that an established current fee. No new verdict is recorded.
  const data = event(f, 'tryBuildWebSearchData').result;
  const body = data.bodyVerification.reads[0].extractedBody;
  assert.match(body, /220달러/);
  assert.doesNotMatch(body, /한국|대한민국|Korea|iBT|ITP|PBT/i);
  let constraints;
  const rejection = generator([JSON.stringify({evidenceReviews:data.results.map((_,id)=>({id,relevant:false,requestSatisfied:false,quote:'',reason:'국가·종류·현재 요금 불명'}))})]);
  const output = await answerChatBySource(f.question, {
    originalPrompt: f.question,
    searchIntent: { requiresExternal:true, hasLocalAnswer:false }, evidenceDecision: {hasEvidence:true},
    webEvidence: data.results,
  }, async (q, opts) => {
    if (!opts.evidenceReview) return result;
    constraints = opts.webSearchContext;
    // Explicit rejection double, never a fabricated successful provider verdict.
    return rejection.generate(q, opts);
  });
  assert.match(constraints, /국가·지역|국가·시험 종류/);
  assert.ok(rejection.payloads[0].contents[0].parts[0].text.includes(answer));
  assert.ok(rejection.payloads[0].contents[0].parts[0].text.includes(f.question));
  assert.equal(output.answerVerification.status, 'rejected');
  assert.doesNotMatch(output.answer, /220/);
});

test('captured missing weather/comparison question is preserved in actual generation payload and subsequent rounds', async () => {
  for (const id of ['weather', 'product-comparison']) {
    const f = fixture(id);
    const old = f.trace.find(e => e.event === 'api-payload' && e.stage === 'evidence-review');
    assert.match(old.contents[0].parts[0].text, /\[현재 질문\]\n\n/);
    const data = event(f, 'tryBuildWebSearchData').result;
    const body = data.bodyVerification.reads.find(r => r.extractedBody);
    const g = generator([raw(f,'evidence-review')]);
    await reviewSourceBodies(`기준일: ${f.now}\n질문 원문: ${f.question}\n실제 검색어: changed query`, [{ title:body.extractedTitle,url:body.fetchedUrl,pageText:body.extractedBody }], g.generate);
    const payload = g.payloads[0];
    assert.ok(payload.contents[0].parts[0].text.includes(f.question));
    assert.match(payload.system_instruction.parts[0].text, /대상·요청 속성/);
  }
  const prompts=[];
  const source={title:'부산 날씨',url:'https://weather.test/a',snippet:'기온 20°C'};
  await collectWebBodyEvidence('부산 날씨',{status:'success',results:[source]},async(q,opts)=>{
    prompts.push(q);
    return {evidenceReviews:[{id:0,relevant:false,requestSatisfied:false,quote:''}],searchRefinement:{requestedSatisfied:false,queries:['부산 기온 오늘'],aliases:[]}};
  },{originalPrompt:'오늘 부산 날씨는 어때?',now:'2026-10-16T14:46:00Z',readPage:async()=>({text:''}),search:async()=>({status:'success',results:[{...source,url:'https://weather.test/b'}]})});
  assert.ok(prompts.length >= 2);
  assert.ok(prompts.every(q => q.includes('오늘 부산 날씨는 어때?') && q.includes('2026-10-16')));
  assert.ok(prompts[1].includes('실제 검색어: 부산 기온 오늘'));
});

test('updated timestamps and same-name locality in another province cannot establish Busan weather validity', () => {
  const query='기준일: 2026-10-16T14:46:00Z\n질문 원문: 오늘 부산 날씨는 어때?';
  const review={relevant:true,requestSatisfied:true,region:'부산, 전라남도',validTime:'2026-10-16',quote:'기온 20°C'};
  assert.equal(evidenceRequestMismatch(query,{pageText:'2026-10-16 예보 기온 20°C'},review),'weather-region-mismatch');
  assert.equal(evidenceRequestMismatch(query,{pageText:'마지막 업데이트: 2026-10-16 기온 20°C'},{...review,region:'부산광역시'}),'weather-time-is-not-observation-or-forecast');
});

test('captured news fourth attempt reproduces a local reserved-budget error with no fourth network request', async () => {
  const f=fixture('news');
  const b=createVerificationBudget(f.limits,f.questionLimits);
  b.begin({modelRequests:2,httpRequests:2});
  for(const e of f.trace.filter(e=>e.event==='http-attempt')) b.consume(e.service==='model',{required:e.required});
  let network=0, caught;
  try { b.consume(true); network++; } catch(error) {caught=error;}
  assert.equal(network,0);
  assert.equal(caught.code,'VERIFY_QUESTION_MODEL_RESERVED_LIMIT');
  assert.equal(caught.name,'Error');
  assert.equal(caught.message,'Verification limit reached');
  assert.match(caught.stack,/chat-verification-budget.js/);
  assert.equal(classifyChatError(caught).category,'request-limit');
  assert.equal(f.trace.filter(e=>e.event==='model-error'&&e.status===503).length,3);
});

test('plan, review with one 503, answer leaves the final verification call protected', () => {
  const b=createVerificationBudget({modelRequests:20,httpRequests:36,durationMs:180000},{modelRequests:5,httpRequests:36,durationMs:40000});
  b.begin({stages:{'evidence-review':1,answer:1,'final-verification':1}});
  b.consume(true); // planning
  b.setStage('evidence-review');b.consume(true,{required:true}); // review 503
  b.consume(true); // review success
  b.setStage('answer'); b.consume(true,{required:true}); // answer
  assert.throws(()=>b.consume(true),{code:'VERIFY_QUESTION_MODEL_RESERVED_LIMIT'}); // spare retry unavailable
  assert.equal(b.signal.aborted,false);
  b.setStage('final-verification');b.consume(true,{required:true});
  assert.equal(b.questionCounts.modelRequests,5);
  assert.equal(b.failures.length,0);
});

test('503 moves to the next configured model before repeating an overloaded model', async () => {
  const attempts=[];
  const result=await requestChatWithFallback({}, {models:['gemini-3.5-flash-lite','gemini-3.1-flash-lite'],keys:['fake'],maxAttempts:3,request:async(model)=>{
    attempts.push(model);
    if(attempts.length===1)throw Object.assign(Error('unavailable'),{status:503});
    return {ok:true};
  }});
  assert.equal(result.ok,true);
  assert.deepEqual(attempts,['gemini-3.5-flash-lite','gemini-3.1-flash-lite']);
});

test('masking keeps JSON numeric settings and safely masks literal/escaped credentials', () => {
  const serialize=createVerificationSerializer({GEMINI_MAX_OUTPUT_TOKENS:'4096',GEMINI_API_KEY:'secret"value',DISCORD_TOKEN:'123456'});
  const result=JSON.parse(serialize({outputTokenLimit:4096,key:'secret"value',numeric:123456,encoded:encodeURIComponent('secret"value')}));
  assert.equal(result.outputTokenLimit,4096);
  assert.equal(result.key,'[REDACTED]');
  assert.equal(result.numeric,'[REDACTED]');
  assert.equal(result.encoded,'[REDACTED]');
});

for(const id of ['wiki','self-answer']) test(`latest captured ${id} preserves final output through actual handler`,async()=>{
  const f=fixture(id),r=runtime({wiki:event(f,'tryBuildPyhokWikiSearchData')?.result});
  r.context.generateGeminiAnswer=async(q,opts)=>{
    assert.equal(opts.planSearch,true,'no additional answer call');
    return JSON.parse(raw(f,'planning'));
  };
  await r.context.handleGeminiFallbackMessage(message(f.question),{now:new Date(f.now)});
  assert.deepEqual(r.sent,f.final.map(formatChatDisplayAnswer));
  assert.doesNotMatch(r.sent.join("\n"),/https?:\/\//);
});

test('planning retries cannot consume the first evidence review reservation', async () => {
  const b=createVerificationBudget({modelRequests:20,httpRequests:36,durationMs:180000},{modelRequests:5,httpRequests:36,durationMs:40000});
  b.begin({stages:{'evidence-review':1,answer:1,'final-verification':1}});
  let attempts=0;
  const unavailable=Object.assign(Error('unavailable'),{status:503});
  await assert.rejects(requestChatWithFallback({}, {
    models:['a','b','c'],keys:['fake'],canAttempt:()=>b.canConsume(true),
    request:async()=>{ b.consume(true); attempts++; throw unavailable; },
  }),error=>error===unavailable);
  assert.equal(attempts,2);
  b.setStage('evidence-review');b.consume(true,{required:true});
  b.setStage('answer');b.consume(true,{required:true});
  b.setStage('final-verification');b.consume(true,{required:true});
  assert.equal(b.failures.length,0);
});
