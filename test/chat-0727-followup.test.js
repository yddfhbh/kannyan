import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compactEvidenceText, reviewSourceBodies, extractQuotedAmounts, evidenceRequestMismatch } from '../src/evidence-review.js';
import { rankWebCandidates, collectWebBodyEvidence, renderWeatherEvidence } from '../src/web-evidence.js';
import { createVerificationBudget } from '../scripts/lib/chat-verification-budget.js';
import { answerVerifiedNews } from '../src/news-evidence.js';
import { generator } from './helpers/captured-chat-generator.js';
import { answerChatBySource } from '../src/chat-search-policy.js';
const logs = JSON.parse(fs.readFileSync(new URL('./fixtures/chat-log-20261017-0727.json',import.meta.url)));
const read=logs.mixed.body.reads[0];
const source={title:read.extractedTitle,url:read.fetchedUrl,pageText:read.extractedBody,metadataText:read.extractedMetadata};
const query='기준일: 2026-10-16T22:27:41Z\n질문 원문: 오늘 부산 날씨 어때?';
const date='2026년 10월 17일';
const quote=source.pageText.slice(source.pageText.indexOf(date),source.pageText.indexOf('08:00')).trim();
const row='07:00 18°C 대체로 맑음';
const verdict={id:0,relevant:true,requestSatisfied:true,quote,region:'부산광역시',validTime:date,kind:'forecast',dataType:'table',weatherFields:[row]};

test('07:27 input retains target date, region and hourly row removed by old sentence scoring',()=>{
 const text=compactEvidenceText(query,source);
 assert.ok(text.includes(`${date} 토요일 부산광역시 오늘 날씨 ${row}`));
 assert.ok(text.length<=1100);assert.ok(!text.includes('2026년 10월 18일'));
});

test('07:27 raw empty weather verdict is retained without inventing normalized fields',async()=>{
 const [r]=await reviewSourceBodies(query,[source],async()=>logs.mixed.raw);
 assert.equal(r.bodyReview.relevant,false);assert.equal(r.bodyReview.region,'');
 assert.deepEqual(r.bodyReview.rawModelReview,logs.mixed.raw.evidenceReviews[0]);
});

test('table, structured and prose row formats validate exact source and render forecast only',async()=>{
 for(const dataType of ['table','structured','prose','weather']){
 const [r]=await reviewSourceBodies(query,[source],async()=>({evidenceReviews:[{...verdict,dataType}]}));
 assert.equal(r.bodyReview.relevant,true);
 assert.match(renderWeatherEvidence({results:[r]},query),/예보에서는 07:00 18°C 대체로 맑음/);
 }
});

test('table validation rejects wrong region/date, tomorrow rows and fabricated values',async()=>{
 for(const changed of [{region:'서울'},{validTime:'2026년 10월 18일'},
  {quote:quote+' '+source.pageText.slice(source.pageText.indexOf('2026년 10월 18일'),source.pageText.indexOf('01:00')),weatherFields:['00:00 20°C 맑음']},
  {weatherFields:['07:00 99°C 맑음']},{quote:row}]){
 const [r]=await reviewSourceBodies(query,[source],async()=>({evidenceReviews:[{...verdict,...changed}]}));
 assert.equal(r.bodyReview.relevant,false,JSON.stringify(changed));
 }
});

test('currency parser handles won, man-won, dollars and approximate qualifiers without currency conversion',()=>{
 for(const [text,value,currency,approximate] of [['35만원 전후',350000,'KRW',true],['약 35만 원',350000,'KRW',true],['350,000원',350000,'KRW',false],['265달러',265,'USD',false],['약 $220',220,'USD',true],['USD 265',265,'USD',false]]){
  assert.deepEqual(extractQuotedAmounts(text).map(({value,currency,approximate})=>({value,currency,approximate})),[{value,currency,approximate}]);
 }
 const r=logs['toefl-fact'].raw.evidenceReviews[1];
 assert.equal(evidenceRequestMismatch('토플 응시료', {pageText:r.quote},r),'fee-applicability-unverified');
});

test('blog approximate fee without applicable period is rejected even in estimate scope',async()=>{
 const raw=logs['toefl-fact'].raw.evidenceReviews[1];
 const s={url:'https://blog.toptedu.co.kr/ibt-toefl-fee-2026-checklist-for-beginners/',pageText:raw.quote};
 const r={...raw,id:0,reason:'블로그 대략값만 확인, 현재 응시료는 확인할 수 없음',feeApplicability:{scope:'estimate',country:'한국',examType:'IBT',validFrom:'',validThrough:'',quote:raw.quote}};
 const [accepted]=await reviewSourceBodies('토플 응시료',[s],async()=>({evidenceReviews:[r]}));
 assert.equal(accepted.bodyReview.relevant,false);
 assert.equal(accepted.bodyReview.requestMismatch,'fee-applicability-unverified');
 for(const scope of ['current','unknown'])assert.ok(evidenceRequestMismatch('토플 응시료',s,{...r,feeApplicability:{...r.feeApplicability,scope}}));
 assert.equal(evidenceRequestMismatch('미국 iBT 토플 응시료',s,r),'fee-country-mismatch');
 const result=await answerChatBySource('토플 응시료',{
 searchIntent:{requiresExternal:true,hasLocalAnswer:false},evidenceDecision:{hasEvidence:true},webEvidence:[accepted],
 },async()=>({answer:'현재 공식 응시료는 35만원이다냥.',citationsValid:true}));
 assert.equal(result.answerVerification.status,'rejected');assert.ok(!result.answer.includes('35만원'));
});

test('ETS fee candidate previously ranked ninth now gets first body read, lookalike domain gets no preference',()=>{
 const items=logs['toefl-fact'].body.selections.map(s=>({title:s.title,url:s.url,snippet:s.snippet}));
 const ranked=rankWebCandidates('토플 응시료',items);
 assert.equal(ranked[0].candidate.url,'https://www.kr.ets.org/toefl/test-takers/ibt/register/fees.html');
 const fake={...ranked[0].candidate,url:'https://ets.org.evil.test/toefl/register/fees.html'};
 assert.equal(rankWebCandidates('토플 응시료',[fake,ranked[0].candidate])[0].candidate.url,ranked[0].candidate.url);
});

test('one unreserved review slot permits followup while answer and final verification stay reserved',async()=>{
 const budget=createVerificationBudget({modelRequests:5,httpRequests:36,durationMs:40000},{modelRequests:5,httpRequests:36,durationMs:40000});
 budget.begin({stages:{'evidence-review':1,answer:1,'final-verification':1}});
 budget.consume(true); // planning
 let calls=0,searches=0;
 const result=await collectWebBodyEvidence('날씨 자료',{status:'success',results:[{url:source.url,title:source.title}]},async()=>{
  calls++;
  if(calls===1){budget.setStage('evidence-review');budget.consume(true,{required:true});return {evidenceReviews:[{id:0,relevant:false,requestSatisfied:false,quote:'',reason:'부족'}]};}
  budget.consume(true);return {evidenceReviews:[verdict]};
 },{originalPrompt:'날씨 자료',now:'2026-10-16T22:27:41Z',getRemainingBudget:()=>budget.remaining(),
 readPage:async url=>{budget.consume(false);return {url,title:source.title,text:source.pageText};},
 search:async()=>{searches++;budget.consume(false);return {status:'success',results:[{url:source.url+'?followup',title:source.title}]};}});
 assert.equal(searches,1);assert.equal(result.results.length,1);
 assert.equal(budget.remaining().reservedModelRequests,2);assert.equal(budget.questionCounts.modelRequests,3);
 for(const stage of ['answer','final-verification']){budget.setStage(stage);budget.consume(true,{required:true});}
 assert.equal(budget.questionCounts.modelRequests,5);assert.equal(budget.canConsume(true),false);
});


test('07:27 three-article news success replays captured source review, summaries and final verification unchanged',async()=>{
 const n=logs.news;
 const g=generator([n.responses.find(r=>r.stage==='evidence-review').raw]);
 const reviewed=await reviewSourceBodies('최신 AI 뉴스',n.data.results,g.generate);
 assert.equal(reviewed.filter(r=>r.bodyReview.relevant).length,3);
 const summaries=n.responses.filter(r=>r.stage==='answer');
 const checks=[];
 const answer=await answerVerifiedNews(n.data,async(q,opts)=>{
   const raw=opts.finalVerification?n.responses.find(r=>r.stage==='final-verification').raw:
     summaries.find(r=>JSON.parse(r.raw).answer.includes(n.data.results.find(a=>opts.webSearchContext.includes(a.url)).url)).raw;
   return generator([raw]).generate(q,opts);
 },{onVerificationResult:r=>checks.push(r)});
 assert.deepEqual(checks.map(c=>c.status),['success','success','success']);
 assert.equal(answer,n.final[0]);
});


test('explicit requested weather date is checked even without today, against the requested date rather than lookup day',()=>{
 const changed={...verdict,validTime:'2026년 10월 18일'};
 assert.equal(evidenceRequestMismatch('2026-10-17 부산 날씨',source,changed),'weather-target-date-mismatch');
 assert.equal(evidenceRequestMismatch('기준일: 2026-10-18T02:00:00Z\n질문 원문: 2026-10-17 부산 날씨',source,verdict),'');
});


test('limited estimate answer without applicable period fails final verification',async()=>{
 const raw=logs['toefl-fact'].raw.evidenceReviews[1];
 const url='https://blog.toptedu.co.kr/ibt-toefl-fee-2026-checklist-for-beginners/';
 const review={...raw,id:0,feeApplicability:{scope:'estimate',country:'한국',examType:'IBT',validFrom:'',validThrough:'',quote:raw.quote}};
 const source={url,pageText:raw.quote,bodyReview:review};
 const answer=`블로그에서는 한국 IBT 응시료를 대략 35만원 전후로 안내한다냥. 현재 공식 응시료는 확인하지 못했다냥. ${url}`;
 let verificationCalls=0;
 const result=await answerChatBySource('토플 응시료',{
 searchIntent:{requiresExternal:true,hasLocalAnswer:false},evidenceDecision:{hasEvidence:true},webEvidence:[source],
 },async(q,opts)=>{
  if(!opts.evidenceReview)return {answer,citationsValid:true};
  verificationCalls++;assert.equal(opts.finalVerification,true);
  assert.ok(opts.webSearchContext.includes(answer));
  return {evidenceReviews:[review]};
 });
 assert.notEqual(result.answer,answer);assert.equal(result.answerVerification.status,'rejected');assert.equal(verificationCalls,1);
});
