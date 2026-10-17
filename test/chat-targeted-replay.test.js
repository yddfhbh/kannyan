import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reviewSourceBodies, evidenceRequestMismatch } from '../src/evidence-review.js';
import { rankWebCandidates, collectWebBodyEvidence, renderWeatherEvidence } from '../src/web-evidence.js';
import { generator } from './helpers/captured-chat-generator.js';
import { createVerificationBudget } from '../scripts/lib/chat-verification-budget.js';
const logs=JSON.parse(fs.readFileSync(new URL('./fixtures/chat-targeted-20261017.json',import.meta.url)));
const m=logs.mixed;
const read=m.body.reads[0];
const source={title:read.extractedTitle,url:read.fetchedUrl,pageText:read.extractedBody,metadataText:read.extractedMetadata,evidenceKind:'body'};
const raw=JSON.parse(m.responses[1].raw);
const verdict=raw.evidenceReviews[0];
const q=`기준일: ${m.now}\n질문 원문: ${m.question}`;
const items=(c,round)=>logs[c].body.selections.filter(s=>s.round===round).sort((a,b)=>a.index-b.index);

test('captured identity and original refusal are preserved, unchanged raw weather quote now validates',async()=>{
 for(const x of Object.values(logs))assert.equal(x.identity.codeSha256,'5958fd69d716a7442deab815d43f8ce32c615d39d854725035a9c3deecbb2511');
 assert.equal(m.body.reviews[0].reason,'weather-time-is-not-observation-or-forecast');
 const g=generator([m.responses[1].raw]);
 const sources=m.body.reviews.filter(r=>r.round===0).map(r=>{
  const b=m.body.reads.find(b=>b.fetchedUrl===r.url);
  const s=m.body.selections.find(s=>s.url===r.url);
  return b?{title:b.extractedTitle,url:r.url,pageText:b.extractedBody,metadataText:b.extractedMetadata,evidenceKind:'body'}:{title:s.title,url:r.url,pageText:s.snippet,evidenceKind:'search-snippet'};
 });
 const result=await reviewSourceBodies(q,sources,g.generate);
 assert.equal(g.payloads.length,1);
 assert.equal(result[0].bodyReview.relevant,true);
 assert.equal(result[0].bodyReview.quote,verdict.quote);
 assert.match(renderWeatherEvidence({results:result},q),/부산 24도/);
});

test('publication and update alone cannot establish weather date; stale and different region remain rejected',()=>{
 assert.equal(evidenceRequestMismatch(q,source,verdict),'');
 assert.equal(evidenceRequestMismatch(q,{...source,metadataText:source.metadataText.replaceAll('2026-10-17','2025-10-17')},verdict),'weather-target-date-mismatch');
 assert.equal(evidenceRequestMismatch(q,{...source,pageText:source.pageText.replaceAll('17일','16일')},verdict),'weather-target-date-mismatch');
 assert.equal(evidenceRequestMismatch(q,{...source,pageText:`업데이트 2026-10-17\n${verdict.quote}`},verdict),'weather-time-is-not-observation-or-forecast');
 assert.equal(evidenceRequestMismatch(q,source,{...verdict,region:'서울'}),'weather-region-mismatch');
 assert.equal(evidenceRequestMismatch('2026-10-18 부산 날씨',source,verdict),'weather-target-date-mismatch');
});

test('previous-day publication can describe an exact next-day forecast, with body day required independently',async()=>{
 const s={...source,metadataText:source.metadataText.replaceAll('2026-10-17','2026-10-16')};
 const [r]=await reviewSourceBodies(q,[s],async()=>({evidenceReviews:[verdict]}));
 assert.equal(r.bodyReview.relevant,true);
 assert.equal(r.bodyReview.validTime,'2026-10-17');
 const [stale]=await reviewSourceBodies(q,[{...s,pageText:s.pageText.replaceAll('17일','16일')}],async()=>({evidenceReviews:[verdict]}));
 assert.equal(stale.bodyReview.relevant,false);
});

test('actual followup festivals and official home screens spend no reads; initial regional forecast remains first',()=>{
 const ranked=rankWebCandidates('부산 날씨',items('mixed',1));
 for(const oldRead of m.body.reads.filter(r=>r.round===1))assert.equal(ranked.find(r=>r.candidate.url===oldRead.requestedUrl).eligible,false);
 const homes=ranked.filter(r=>/weather\.go\.kr\/(?:w\/index\.do)?$/.test(r.candidate.url));
 assert.ok(homes.length);
 for(const home of homes) { assert.equal(home.eligible,false); assert.equal(home.reason,'weather-main-screen'); }
 const initial=rankWebCandidates('부산 날씨',items('mixed',0));
 assert.equal(initial[0].candidate.url,'https://www.weather.go.kr/w/forecast/notice.do?stnId=159');
});

test('actual $220 verdict remains rejected; subsidy/tuition/Junior/ITP filtered before read and snippet review',async()=>{
 const f=logs['toefl-fact'];
 const b=f.body.reads[1];
 const r=JSON.parse(f.responses[1].raw).evidenceReviews[1];
 const [result]=await reviewSourceBodies('토플 응시료',[{title:b.extractedTitle,url:b.fetchedUrl,pageText:b.extractedBody}],async()=>({evidenceReviews:[{...r,id:0}]}));
 assert.equal(result.bodyReview.relevant,false);
 assert.equal(result.bodyReview.requestMismatch,'fee-applicability-unverified');
 for(const round of [0,1]){
  const ranked=rankWebCandidates('토플 응시료',items('toefl-fact',round));
  for(const s of ranked.filter(s=>/지원|강좌|기관토플/.test(s.candidate.title)))assert.equal(s.eligible,false,s.candidate.title);
 }
 assert.equal(rankWebCandidates('토플 응시료',items('toefl-fact',1)).filter(r=>r.eligible).length,0);
});

test('captured fee replay skips all irrelevant reads and reviews and spends next search on ETS, without invented official body',async()=>{
 const f=logs['toefl-fact'];
 const requested=[],queries=[];let calls=0;
 const result=await collectWebBodyEvidence('토플 응시료',{status:'success',results:items('toefl-fact',0)},async()=>{
  calls++;
  const r=JSON.parse(f.responses[1].raw).evidenceReviews[1];
  return {evidenceReviews:[{...r,id:0}],searchRefinement:{requestedSatisfied:false,queries:[]}};
 },{now:f.now,originalPrompt:f.question,readPage:async url=>{
  requested.push(url);const b=f.body.reads.find(b=>b.requestedUrl===url);assert.ok(b,'unrecorded body');return {url,title:b.extractedTitle,text:b.extractedBody,metadataText:b.extractedMetadata};
 },search:async query=>{queries.push(query);return {status:'success',results:items('toefl-fact',1)};}});
 assert.equal(calls,1);
 assert.equal(requested.length,1);
 assert.match(requested[0],/blog.toptedu/);
 assert.match(queries[0],/site:ets.org\/toefl\/test-takers\/ibt\/register\/fees/);
 assert.equal(result.results.length,0); // ETS was absent from the archive; never fabricate its text.
});

test('fee authority ranking reserves first body slot but never bypasses original applicability validation',async()=>{
 const official={title:'TOEFL iBT Test Fees',url:'https://www.ets.org/toefl/test-takers/ibt/register/fees.html',snippet:''};
 const ranked=rankWebCandidates('토플 응시료',[...items('toefl-fact',0),official]);
 assert.equal(ranked[0].candidate,official);
 assert.ok(evidenceRequestMismatch('한국 iBT 토플 응시료',{pageText:'Test fee $220'},{relevant:true,quote:'Test fee $220'}));
 assert.notEqual(rankWebCandidates('토플 응시료',[{...official,url:'https://ets.org.evil.test/toefl/register/fees.html'},official])[0].candidate.url,'https://ets.org.evil.test/toefl/register/fees.html');
});

test('no reviewable candidates spend zero model slots, leaving review/answer/final reservations intact',async()=>{
 const budget=createVerificationBudget({modelRequests:5,httpRequests:36,durationMs:40000},{modelRequests:5,httpRequests:36,durationMs:40000});
 budget.begin({stages:{'evidence-review':1,answer:1,'final-verification':1}});budget.consume(true);
 let reviews=0;
 await collectWebBodyEvidence('토플 응시료',{results:items('toefl-fact',1)},async()=>{reviews++;throw Error('no material');},{getRemainingBudget:()=>budget.remaining(),search:async()=>{budget.consume(false);return {results:items('toefl-fact',1)};},readPage:async()=>{throw Error('irrelevant read');}});
 assert.equal(reviews,0);assert.equal(budget.questionCounts.modelRequests,1);assert.equal(budget.remaining().reservedModelRequests,3);
});
