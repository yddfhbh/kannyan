import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveChatSourcePlan } from '../src/chat-source-plan.js';
import { collectWebBodyEvidence, rankWebCandidates, webCandidateKey } from '../src/web-evidence.js';
import { evidenceRequestMismatch } from '../src/evidence-review.js';
import { resolveChatEvidence, answerChatBySource } from '../src/chat-search-policy.js';
const logs = JSON.parse(fs.readFileSync(new URL('./fixtures/chat-final-recheck-20261017.json', import.meta.url)));
const rejected = async () => ({evidenceReviews: Array.from({length:4},(_,id)=>({id,relevant:false,requestSatisfied:false,reason:'요청 근거 없음'})),searchRefinement:{requestedSatisfied:false,queries:['TOEFL iBT fee']}});
const emptySearch = async()=>({status:'empty',results:[]});
const source = (url,title='일반 사실')=>({url,title,snippet:''});

test('actual candidate identity and count exhaustion are preserved, distinct from elapsed time',()=>{
  for(const log of Object.values(logs)) {
    assert.equal(log.identity.codeSha256,'4e3ce78112f6f15489f77a945b481a1a25d4d4f79e6f10c732e675415fd04b11');
    assert.equal(log.reads.length,4);
    assert.equal(log.remaining.reads,0);
    assert.equal(log.remaining.searches,0);
    assert.ok(log.remaining.durationMs > 15000);
    assert.ok(log.remaining.external.httpRequests >= 18);
  }
});

test('mixed dated planner query remains focused despite implicit current-date expansion',()=>{
  const plan = {mode:'search',query:'부산 날씨 2026년 10월 17일',purpose:'오늘 부산 기상',externalPrompt:'오늘 부산 날씨',localPrompt:'너 누구야?'};
  const r=resolveChatSourcePlan({answer:'나는 깐냥이다냥.',sourcePlan:plan},logs.mixed.question);
  assert.equal(r.intent.query,plan.query);
  assert.equal(r.intent.externalPrompt,plan.externalPrompt);
  assert.equal(r.intent.hasLocalAnswer,true);
});

test('actual weather home screens and TOEFL India candidate never spend reads',()=>{
  const mixed=logs.mixed.reads.map(r=>source(r.requestedUrl,r.searchTitle));
  assert.equal(rankWebCandidates('부산 날씨',mixed).filter(r=>r.eligible).length,1);
  const india=logs['toefl-fact'].reads.at(-1);
  assert.equal(rankWebCandidates('한국 TOEFL iBT 응시료',[source(india.requestedUrl,india.searchTitle)])[0].eligible,false);
});

test('canonical URL ignores anchors/tracking but retains weather station/date selectors',()=>{
  assert.equal(webCandidateKey('https://a.test/page?utm_source=x#part'),webCandidateKey('https://a.test/page'));
  assert.equal(webCandidateKey('https://www.weather.go.kr/'),webCandidateKey('https://www.weather.go.kr/w/index.do'));
  assert.notEqual(webCandidateKey('https://a.test/?station=159'),webCandidateKey('https://a.test/?station=108'));
});

test('redirect destination is reviewed once and duplicate consumes a real read without refund',async()=>{
  const pages=[source('https://a.test/start'),source('https://b.test/start'),{...source('https://a.test/end#fragment'),snippet:'중복 도착 URL의 검색 스니펫'}];
  const r=await collectWebBodyEvidence('일반 사실',{results:pages},rejected,{
    search:emptySearch,readPage:async()=>({url:'https://a.test/end',title:'일반 사실',text:'일반 사실 본문'}),
  });
  assert.equal(r.bodyVerification.reads.length,2);
  assert.equal(r.bodyVerification.reads[1].status,'duplicate-fetched-url');
  assert.equal(r.bodyVerification.reviews.length,1);
});

test('common candidate pool reserves a body read for each later search',async()=>{
  let searchCount=0;
  const reads=[];
  const r=await collectWebBodyEvidence('일반 사실',{results:Array.from({length:8},(_,i)=>source(`https://old.test/${i}`))},rejected,{
    search:async()=>({status:'success',results:[source(`https://new.test/${++searchCount}`)]}),
    readPage:async url=>{reads.push(url);return {url,title:'일반 사실',text:'근거 없는 본문'};},
  });
  assert.deepEqual(reads,['https://old.test/0','https://old.test/1','https://new.test/1','https://new.test/2']);
  assert.equal(r.bodyVerification.reads.at(-1).remainingBefore.reads,1);
  assert.equal(r.bodyVerification.stopReason,'read-budget-exhausted');
  assert.deepEqual(r.bodyVerification.exhaustedBudgets,['searches','reads']);
  const d=resolveChatEvidence({requiresExternal:true,externalPrompt:'일반 사실'},{webSearchData:r});
  assert.match(d.unavailable,/검색 횟수와 본문 조회 횟수/);
  assert.doesNotMatch(d.unavailable,/시간.*초과/);
});

test('actual official location instruction yields a scoped fee answer without foreign searches',async()=>{
  const original=logs['toefl-fact'].reads[0];
  const r=await collectWebBodyEvidence('토플 응시료',{status:'success',results:[source(original.requestedUrl,original.searchTitle)]},rejected,{
    originalPrompt:logs['toefl-fact'].question,
    search:async()=>{assert.fail('unspecified country needs clarification, not foreign search');},
    readPage:async()=>({url:original.fetchedUrl,title:original.extractedTitle,text:original.extractedBody}),
  });
  assert.equal(r.results.length,0);
  assert.equal(r.bodyVerification.stopReason,'location-required');
  assert.equal(r.bodyVerification.reads.length,1);
  assert.equal(r.bodyVerification.scopeEvidence[0].quote,'등록비를 확인하려면 시험 장소를 선택하세요.');
  const intent={requiresExternal:true,externalPrompt:logs['toefl-fact'].question};
  const decision=resolveChatEvidence(intent,{webSearchData:r});
  const answer=await answerChatBySource(intent.externalPrompt,{searchIntent:intent,evidenceDecision:decision},async()=>assert.fail());
  assert.match(answer.answer,/시험 장소를 선택/);
  assert.match(answer.answer,/현재 기본 응시료 금액은 확인하지 못/);
  assert.doesNotMatch(answer.answer,/한국/);
  assert.equal(answer.answerVerification.status,'sourced-partial');
  assert.ok(answer.answer.includes(original.fetchedUrl));
  assert.doesNotMatch(answer.answer,/220|15,729/);
  assert.ok(r.bodyVerification.refinements.some(q=>q.query==='TOEFL iBT fee' && q.reason==='fee-locale-scope-dropped'));
});

test('national weather fields cannot acquire Busan scope from a model label',()=>{
  const quote='2026년 10월 17일 전국이 흐리고 낮 기온은 20도입니다.';
  const mismatch=evidenceRequestMismatch('부산 날씨 2026년 10월 17일',{pageText:quote},{relevant:true,quote,region:'부산',validTime:'2026년 10월 17일',weatherFields:[quote],kind:'forecast'});
  assert.equal(mismatch,'weather-region-not-in-quote');
});

test('weather redirect to home screen never reaches evidence review',async()=>{
  const r=await collectWebBodyEvidence('부산 날씨',{results:[source('https://weather.test/busan','부산 날씨')]},async()=>assert.fail(),{
    search:emptySearch,readPage:async()=>({url:'https://www.weather.go.kr/w/index.do',title:'부산 날씨',text:'부산 20도 맑음'}),
  });
  assert.equal(r.results.length,0);
  assert.equal(r.bodyVerification.reads[0].status,'weather-main-screen');
});


test('current amount with valid source country cannot select the user country implicitly',()=>{
  const quote='한국 TOEFL iBT 응시료 220달러 적용 기간 2026-01-01 ~ 2026-12-31';
  const review={relevant:true,quote,feeApplicability:{country:'한국',examType:'TOEFL iBT',validFrom:'2026-01-01',validThrough:'2026-12-31',quote}};
  assert.equal(evidenceRequestMismatch('TOEFL iBT 응시료',{pageText:quote},review,'2026-10-17'),'fee-country-unspecified');
  assert.equal(evidenceRequestMismatch('한국 TOEFL iBT 응시료',{pageText:quote},review,'2026-10-17'),'');
});
