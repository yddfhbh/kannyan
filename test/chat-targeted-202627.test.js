import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reviewSourceBodies } from '../src/evidence-review.js';
import { collectWebBodyEvidence, renderWeatherEvidence } from '../src/web-evidence.js';
import { answerChatBySource, resolveChatEvidence } from '../src/chat-search-policy.js';
import { requestChatWithFallback } from '../src/gemini-chat-request.js';
import { createVerificationBudget } from '../scripts/lib/chat-verification-budget.js';
import { classifyChatError } from '../src/chat-errors.js';
const logs = JSON.parse(fs.readFileSync(new URL('./fixtures/chat-targeted-202627.json', import.meta.url)));
const m = logs.mixed;
const read = m.data.bodyVerification.reads.find(r => r.fetchedUrl?.includes('korea247'));
const source = { title: read.extractedTitle, url: read.fetchedUrl, pageText: read.extractedBody, metadataText: read.extractedMetadata };
const query = `기준일: ${m.now}\n질문 원문: ${m.question}`;
const quote = source.pageText.slice(source.pageText.indexOf('2026년 10월 17일'), source.pageText.indexOf('2026년 10월 18일'));
const good = { id: 0, relevant: true, requestSatisfied: true, quote, region: '부산광역시', validTime: '2026년 10월 17일', kind: 'forecast', dataType: 'table', weatherFields: ['21:00 21°C 구름많음 0 mm 동36 km/h', '22:00 21°C 맑음 0 mm 동35 km/h'] };
const review = async changes => (await reviewSourceBodies(query, [source], async () => ({ evidenceReviews: [{ ...good, ...changes }] })))[0];

test('202627 captures exact candidate and distinguishes actual time, HTTP headroom and reserved model calls', () => {
  for(const f of Object.values(logs)) {
    assert.equal(f.identity.codeSha256, '983612b46b35440ad9eebd9d75a9f5a9fd39f81a597f9f5251f122ea15921a69');
    assert.ok(f.timings.elapsedMs < 40000);
    assert.ok(f.data.bodyVerification.remaining.external.httpRequests > 20);
    assert.equal(f.data.bodyVerification.remaining.external.modelRequests, 0);
  }
});
test('actual dated Busan body supports future forecast rows, never an observation or fabricated/date-shifted values', async () => {
  assert.equal((await review({})).bodyReview.relevant, true);
  assert.match(renderWeatherEvidence({results:[await review({})]}, query), /예보.*21:00 21°C/);
  for (const change of [{ kind: 'observation' }, { region:'서울' }, { validTime:'2026년 10월 18일' }, { weatherFields:['21:00 99°C 구름많음'] }, { quote:quote+'현재 맑음' }, { weatherFields:['12:00 23°C 비 0.1 mm 남32 km/h'] }]) assert.equal((await review(change)).bodyReview.relevant, false, JSON.stringify(change));
});
test('503 fallback can spend reserved evidence recovery, leaving answer and final verification intact', async () => {
  const limits={modelRequests:7,httpRequests:36,durationMs:40000};
  const b=createVerificationBudget(limits,limits); b.begin({stages:{'evidence-review':2,answer:1,'final-verification':1}});
  b.consume(true); b.setStage('evidence-review'); let calls=0;
  const result=await requestChatWithFallback({}, {models:['a','b'],keys:['mock'],canAttempt:()=>b.canConsume(true,{required:b.hasReservation('evidence-review')}),request:async()=>{
    b.consume(true,{required:b.hasReservation('evidence-review')});
    if(++calls===1) throw Object.assign(Error('unavailable'),{status:503});
    return { evidenceReviews:[good] };
  }});
  assert.equal(result.evidenceReviews[0].quote,quote); assert.equal(calls,2);
  assert.equal(b.remaining().reservedEvidenceRequests,0); assert.equal(b.remaining().reservedModelRequests,2);
});
test('missing IDs are repaired independently; explicit fee rejection and accepted unrelated quote survive', async () => {
  const f=logs['toefl-fact']; const sources=f.data.bodyVerification.reads.map(r=>({url:r.fetchedUrl,title:r.extractedTitle,pageText:r.extractedBody}));
  sources.push({url:'https://example.test/spec',title:'Atlas',pageText:'Atlas has 32 GB.'});
  const raw=JSON.parse(f.responses[0].raw); let calls=0;
  const reviewed=await reviewSourceBodies('자료 검토',sources,async(q,o)=>{
    calls++;
    if(calls===1) return {evidenceReviews:[raw.evidenceReviews[0],{id:2,relevant:true,requestSatisfied:true,quote:'Atlas has 32 GB.'}]};
    assert.ok(o.webSearchContext.includes(sources[1].url)); assert.ok(!o.webSearchContext.includes(sources[0].url));
    return {evidenceReviews:[{id:0,relevant:false,requestSatisfied:false,quote:'',reason:'기본 금액 없음'}]};
  },{repairInvalidReviews:true});
  assert.equal(calls,2); assert.equal(reviewed[0].bodyReview.relevant,false); assert.equal(reviewed[1].bodyReview.status,'reviewed'); assert.equal(reviewed[2].bodyReview.relevant,true);
});
test('a failed repair preserves valid siblings and never approves the missing source',async()=>{
  let calls=0; const s={...source,pageText:'Atlas has 32 GB.'};
  const result=await reviewSourceBodies('Atlas memory',[s,s],async()=>{
    if(++calls===2)throw Object.assign(Error('unavailable'),{status:503});
    return {evidenceReviews:[{id:0,relevant:true,requestSatisfied:true,quote:s.pageText}]};
  },{repairInvalidReviews:true});
  assert.equal(result[0].bodyReview.relevant,true); assert.equal(result[1].bodyReview.relevant,false); assert.equal(result[1].bodyReview.repairError.status,503);
});
test('collector retains source URLs and 503 failure stage without inventing a review',async()=>{
  const data=await collectWebBodyEvidence('부산 날씨',{status:'success',results:[source]},async()=>{throw Object.assign(Error('unavailable'),{status:503});},{now:m.now,readPage:async()=>({...source,text:source.pageText}),getRemainingBudget:()=>({modelRequests:0,httpRequests:30,reservedModelRequests:2,durationMs:25000})});
  assert.equal(data.results.length,0); assert.equal(data.bodyVerification.reviewCalls[0].sources[0].url,source.url);
  assert.equal(data.bodyVerification.stopReason,'model-budget-reserved-for-answer');
  const d=resolveChatEvidence({requiresExternal:true,externalPrompt:'부산 날씨'},{webSearchData:data});
  assert.match(d.unavailable,/모델 호출/); assert.match(d.unavailable,/503/); assert.doesNotMatch(d.unavailable,/시간 한도/);
});
test('final verifier outage delivers only previously approved exact quotation, rejection still blocks',async()=>{
  const s=await review({});
  for(const fail of [true,false]){
    let calls=0;
    const r=await answerChatBySource(m.question,{searchIntent:{requiresExternal:true},evidenceDecision:{hasEvidence:true},webEvidence:[s]},async()=>{
      if(++calls===1)return {answer:'기온 99°C https://www.korea247.kr/'};
      if(fail)throw Object.assign(Error('unavailable'),{status:503});
      return {evidenceReviews:[{id:0,relevant:false,quote:'',reason:'99°C 없음'}]};
    });
    assert.doesNotMatch(r.answer,/99°C/);
    if(fail){ assert.ok(r.answer.includes(quote.trim())); assert.ok(r.answer.includes(source.url)); assert.equal(r.answerVerification.generatedAnswerAccepted,false); }
    else assert.equal(r.answerVerification.status,'rejected');
  }
});
test('reservation, actual timeout, model count and HTTP count diagnostics are distinct',()=>{
  assert.equal(classifyChatError({code:'CHAT_STAGE_TIME_LIMIT'}).category,'time-reservation');
  for(const resource of ['MODEL','HTTP','TIME','MODEL_RESERVED']){
    const d=classifyChatError({code:`VERIFY_QUESTION_${resource}_LIMIT`});
    assert.equal(d.resource,resource.startsWith('MODEL')?'model':resource==='HTTP'?'http':'time');
    assert.equal(d.reserved,resource.endsWith('RESERVED'));
  }
});
