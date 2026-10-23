import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reviewSourceBodies, compactEvidenceText } from '../src/evidence-review.js';
import { collectWebBodyEvidence } from '../src/web-evidence.js';
import { summarizeVerification, summarizeTimings } from '../scripts/lib/chat-verification-report.js';
import { generator } from './helpers/captured-chat-generator.js';

const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/chat-log-20261017-000215.json', import.meta.url)));
const read = id => fixtures.find(row => row.case === id);
const mixed = read('mixed');
const raw = JSON.parse(mixed.trace.find(e=>e.event==='model-response' && e.stage==='evidence-review').raw);
const body = mixed.trace.find(e=>e.event==='tryBuildWebSearchData').result.bodyVerification;
const sources = body.reads.map(r=>({ title:r.extractedTitle, metadataText:r.extractedMetadata, url:r.fetchedUrl, pageText:r.extractedBody }));
const query = '기준일: 2026-10-16T15:02:44Z\n질문 원문: 너 누구고 오늘 부산 날씨는 어때?';

test('original structured mixed response is rejected with both precise causes and raw verdict retained', async()=>{
  const g=generator([JSON.stringify(raw)]);
  const reviewed=await reviewSourceBodies(query,sources,g.generate);
  assert.equal(reviewed[0].bodyReview.relevant,false);
  assert.equal(reviewed[0].bodyReview.requestSatisfied,false);
  assert.equal(reviewed[0].bodyReview.rawModelReview.requestSatisfied,true);
  assert.match(reviewed[0].bodyReview.reason,/quote-not-contiguous-in-body/);
  assert.match(reviewed[0].bodyReview.rawModelReview.reason,/정확히 포함/);
  assert.deepEqual(reviewed[0].bodyReview.validationFailures,['quote-not-contiguous-in-body']);
  assert.equal(reviewed[1].bodyReview.validationFailures.includes('quote-not-contiguous-in-body'),false);
  assert.equal(reviewed[1].bodyReview.validationFailures.includes('weather-fields-not-verbatim-or-incomplete'),false);
  assert.ok(g.payloads[0].contents[0].parts[0].text.includes('주요 지역의 아침 최저기온은 부산 17도'));
});

test('compact source retains original sentence order',()=>{
 const compact=compactEvidenceText('부산 날씨',sources[0]);
 assert.ok(compact.indexOf('낮 기온이 27도 선까지') < compact.indexOf('주요 지역의 아침 최저기온은'));
});

test('one corrective review must supply exact weather sentences; repeat invalid output stays rejected',async()=>{
 const quote=sources[0].pageText.match(/주요 지역의 아침 최저기온은[\s\S]*?평년보다 높은 기온을 기록하겠다\./)[0];
 const fixed={ evidenceReviews:[{...raw.evidenceReviews[0],quote,weatherFields:[quote]}] };
 let calls=0;
 const result=await reviewSourceBodies(query,[sources[0]],async(_q,opts)=>{
   calls++;if(calls===2) assert.match(opts.webSearchContext,/quote-not-contiguous-in-body/);
   return calls===1?raw:fixed;
 },{repairInvalidReviews:true});
 assert.equal(calls,2);assert.equal(result[0].bodyReview.relevant,true);
 assert.equal(result[0].bodyReview.previousReview.requestSatisfied,false);
 assert.ok(sources[0].pageText.includes(result[0].bodyReview.quote));
 calls=0;
 const rejected=await reviewSourceBodies(query,[sources[0]],async()=>{calls++;return raw;},{repairInvalidReviews:true});
 assert.equal(calls,2);assert.equal(rejected[0].bodyReview.relevant,false);
});

test('weather labels may omit Korean particles only when the exact quote proves the place and value', async()=>{
 const quote=sources[0].pageText.match(/주요 지역의 아침 최저기온은[\s\S]*?평년보다 높은 기온을 기록하겠다\./)[0];
 const shortened={...raw.evidenceReviews[0],quote,weatherFields:['아침 최저기온 부산 17도','낮 최고기온 부산 24도']};
 const [result]=await reviewSourceBodies(query,[sources[0]],async()=>({evidenceReviews:[shortened]}));
 assert.equal(result.bodyReview.relevant,true);
 assert.deepEqual(result.bodyReview.weatherFields,shortened.weatherFields);
});

test('unrelated, wrong-date, wrong-province, and fabricated quotes cannot pass repair',async()=>{
 const cases=[
   { ...raw.evidenceReviews[0], quote:'부산 99도', weatherFields:['부산 99도'] },
   { ...raw.evidenceReviews[0], validTime:'16일' },
   { ...raw.evidenceReviews[0], region:'부산, 전라남도' },
   { ...raw.evidenceReviews[0], relevant:false, requestSatisfied:false, quote:'' },
 ];
 for(const r of cases) {
   const result=await reviewSourceBodies(query,[sources[0]],async()=>({evidenceReviews:[r]}),{repairInvalidReviews:true});
   assert.equal(result[0].bodyReview.relevant,false);
   assert.equal(result[0].bodyReview.requestSatisfied,false);
 }
});

test('all rejected reviews override model requestedSatisfied and never terminate with evidence-found',async()=>{
 const r=await collectWebBodyEvidence('부산 날씨',{status:'success',results:[{url:sources[0].url,title:sources[0].title}]},async()=>raw,{
   originalPrompt:'오늘 부산 날씨는 어때?',now:'2026-10-16T15:02:44Z',readPage:async()=>({title:sources[0].title,url:sources[0].url,text:sources[0].pageText}),
   getRemainingBudget:()=>({httpRequests:2,modelRequests:0,durationMs:20000}),
 });
 assert.equal(r.results.length,0);assert.equal(r.bodyVerification.requestedSatisfied,false);
 assert.notEqual(r.bodyVerification.stopReason,'requested-evidence-found');
});

test('planning failures never count as retrieval relevance failures; timings include failed attempts',()=>{
 for(const id of ['toefl-search','toefl-fact','news','weather']) {
   const r=read(id), v=summarizeVerification(r.trace,r.final);
   assert.equal(v.searchExecuted,false);assert.equal(v.failurePath,'planning-call-failure');
   assert.equal(v.evidenceReview,'not-applicable');assert.equal(v.qualityPassed,false);
   assert.ok(summarizeTimings(r.trace,r.timings.elapsedMs).planningMs>0);
 }
 const v=summarizeVerification(mixed.trace,mixed.final);
 assert.equal(v.failurePath,'evidence-review-validation-failure');assert.equal(v.finalAnswer,'failure');assert.equal(v.evidenceReview,'failure');
 const product=read('product-comparison');
 assert.equal(summarizeVerification(product.trace,product.final).failurePath,'evidence-review-call-failure');
 for(const id of ['wiki','self-answer']) {
   const r=read(id),v=summarizeVerification(r.trace,r.final);
   assert.equal(v.qualityPassed,false);assert.equal(v.qualityStatus,'unassessed');
 }
});

test('timeouts use the next configured model; both unavailable models are bounded and preserve last provider error',async()=>{
 const { requestChatWithFallback }=await import('../src/gemini-chat-request.js');
 let calls=[];
 const timeout=Object.assign(new Error('timeout'),{name:'AbortError'});
 const unavailable=Object.assign(new Error('provider overloaded'),{status:503,details:{status:'UNAVAILABLE'}});
 await assert.rejects(requestChatWithFallback({}, {models:['primary','fallback'],keys:['key'],maxAttempts:3,request:async model=>{calls.push(model);throw model==='primary'?timeout:unavailable;}}),e=>e===unavailable);
 assert.deepEqual(calls,['primary','fallback']);
});
