import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rankNewsCandidates } from '../src/news-candidates.js';
import { collectNewsEvidence } from '../src/news-evidence.js';
import { reviewSourceBodies } from '../src/evidence-review.js';
import { answerChatBySource } from '../src/chat-search-policy.js';
import { validateChatCitationsWithStatus } from '../src/chat-evidence.js';
import { searchWeb } from '../src/web-search.js';
import { summarizeVerification } from '../scripts/lib/chat-verification-report.js';
const logs = JSON.parse(fs.readFileSync(new URL('./fixtures/chat-final-check-20261017.json', import.meta.url)));
const get = name => logs.find(l => l.case === name);
const now = '2026-10-16T15:38:00Z';
const data = name => get(name).trace.find(e => e.event === 'tryBuildWebSearchData').result;

test('final mixed 503 is a planning failure with zero search; cannot certify weather repair', () => {
  const log = get('mixed'), v = summarizeVerification(log.trace, log.final);
  assert.equal(log.trace.filter(e => e.event === 'model-error' && e.status === 503).length, 2);
  assert.equal(v.searchExecuted, false);
  assert.equal(v.failurePath, 'planning-call-failure');
  assert.equal(v.evidenceReview, 'not-applicable');
  assert.equal(v.qualityPassed, false);
});

test('actual news candidates: homepage, board, news index and old article spend no body reads', async () => {
  const original = data('news').newsVerification;
  assert.equal(original.pageReads, 6);
  assert.equal(original.articles, 0);
  const items = original.attempts.map(a => ({url:a.discoveredUrl,title:a.discoveredTitle}));
  const ranked = rankNewsCandidates(items, now);
  assert.equal(ranked.filter(r => !r.eligible).length, 6);
  const reads = [];
  const result = await collectNewsEvidence('AI 뉴스', {status:'success',results:items}, {
    now, search:async()=>({status:'empty',results:[]}),
    readPage:async url => { reads.push(url); throw Object.assign(new Error('timeout'),{name:'AbortError'}); },
  });
  assert.equal(reads.length, 0);
  assert.equal(result.status, 'no-verified-articles');
  assert.equal(result.newsVerification.failures.pageReads, 0);
  assert.equal(result.newsVerification.candidateShortage, true);
  assert.equal(result.newsVerification.discovery.outcome, 'results');
  assert.equal(summarizeVerification([{event:'searchWeb',status:'success'}, {event:'tryBuildWebSearchData',result}],['확인하지 못했다냥.']).qualityPassed, false);
});

test('common search ranks dated individual articles before truncation; collector uses same ranking', async () => {
  const items = [
    ...Array.from({length:14},(_,i)=>({url:`https://portal${i}.test/`, title:'AI 뉴스 최신 목록'})),
    {url:'https://publisher.test/stories/new-ai',title:'AI 모델 공개 2026-10-16'},
  ];
  const html = items.map(s => `<div class="result"><a class="result__a" href="${s.url}">${s.title}</a></div>`).join('');
  const search = await searchWeb('AI 뉴스',{now,maxResults:1,fetchImpl:async()=>new Response(html)});
  assert.equal(search.results[0].url,items.at(-1).url);
  const reads=[];
  const result = await collectNewsEvidence('AI 뉴스', {status:'success',results:[{url:'https://source.test/unknown',title:'AI'},...items]}, {
    now, search:async()=>({status:'empty',results:[]}),readPage:async url => {
      reads.push(url);
      return {url,title:'AI 모델 공개',articleTitle:'AI 모델 공개',isArticle:true,publicationEvidence:'datePublished',publishedAt:'2026-10-16',text:'AI 모델의 새로운 기능을 공개했다. '.repeat(15)};
    },
  });
  assert.equal(reads[0],items.at(-1).url);
  assert.equal(result.results.length,2);
});

test('all eligible article requests failing remain retrieval-failed, distinct from candidate shortage',async()=>{
  const result=await collectNewsEvidence('AI 뉴스',{status:'success',results:[{url:'https://publisher.test/stories/ai',title:'AI 2026-10-16'}]}, {
    now,search:async()=>({status:'empty',results:[]}),readPage:async()=>{throw Error('network');},
  });
  assert.equal(result.status,'retrieval-failed');
  assert.equal(result.failed,true);
  assert.equal(result.newsVerification.candidateShortage,false);
});

const originalFee = data('toefl-fact').results[0];
const review = {id:0,relevant:true,requestSatisfied:true,quote:originalFee.pageText,reason:'현재 금액'};
test('actual 220 dollar blog quote is rejected even when model and citation URL checks pass', async()=>{
  const cited=validateChatCitationsWithStatus(`현재 응시료는 220달러다냥. ${originalFee.url}`, `URL: ${originalFee.url}`);
  assert.equal(cited.valid,true);
  const results=await reviewSourceBodies(`기준일: ${now}\n토플 응시료가 얼마야?`,[originalFee],async()=>({evidenceReviews:[review]}));
  assert.equal(results[0].bodyReview.relevant,false);
  assert.equal(results[0].bodyReview.requestSatisfied,false);
  assert.equal(results[0].bodyReview.requestMismatch,'fee-applicability-unverified');
  assert.equal(results[0].bodyReview.rawModelReview.relevant,true);
});

const applicability={country:'한국',examType:'TOEFL iBT',validFrom:'2026-01-01',validThrough:'2026-12-31'};
const scoped = a => `${a.country} ${a.examType} 응시료 220달러, 적용 기간 ${a.validFrom} ~ ${a.validThrough}.`;
async function feeReview(a, question='한국 TOEFL iBT 응시료') {
  const quote=scoped(a),source={url:'https://publisher.test/fees',pageText:quote};
  return (await reviewSourceBodies(question,[source],async()=>({evidenceReviews:[{...review,quote,feeApplicability:{...a,quote}}]}),{now}))[0].bodyReview;
}
test('explicit applicable country, test and date interval can pass; wrong and fabricated conditions fail',async()=>{
  assert.equal((await feeReview(applicability)).relevant,true);
  for(const a of [
    {...applicability,country:'미국'}, {...applicability,examType:'TOEFL ITP'},
    {...applicability,validThrough:'2026-10-01'}, {...applicability,validFrom:'2027-01-01'},
    {...applicability,validFrom:''},
  ]) assert.equal((await feeReview(a)).relevant,false);
  const invalid=await reviewSourceBodies('토플 응시료',[originalFee],async()=>({evidenceReviews:[{...review,feeApplicability:{...applicability,quote:scoped(applicability)}}]}),{now});
  assert.equal(invalid[0].bodyReview.relevant,false);
});

test('answer timeout never delivers a legacy accepted but unscoped fee quote', async()=>{
  const result=await answerChatBySource('토플 응시료가 얼마야?',{
    searchIntent:{requiresExternal:true,hasLocalAnswer:false},evidenceDecision:{hasEvidence:true},webEvidence:[originalFee],
  },async()=>{throw Object.assign(new Error('timeout'),{name:'AbortError'});});
  assert.doesNotMatch(result.answer,/220|달러|https?:/);
  assert.match(result.answer,/국가·시험 종류·적용 시점/);
  assert.equal(result.answerVerification.status,'review-failed');
});

test('production schema transports fee conditions and collector cannot terminate on unscoped blog price',async()=>{
  const { generator }=await import('./helpers/captured-chat-generator.js');
  const { collectWebBodyEvidence }=await import('../src/web-evidence.js');
  const quote=scoped(applicability);
  const g=generator([JSON.stringify({evidenceReviews:[{...review,quote,feeApplicability:{...applicability,quote}}]})]);
  const verified=await reviewSourceBodies('한국 TOEFL iBT 응시료',[{url:'https://publisher.test/fees',pageText:quote}],g.generate,{now});
  assert.equal(verified[0].bodyReview.relevant,true);
  const properties=g.payloads[0].generationConfig.responseSchema.properties.evidenceReviews.items.properties;
  assert.equal(properties.feeApplicability.type,'OBJECT');
  assert.deepEqual(Array.from(properties.feeApplicability.required),['country','examType','validFrom','validThrough','quote']);
  const result=await collectWebBodyEvidence('토플 응시료',{status:'success',results:[originalFee]},async()=>({evidenceReviews:[review],searchRefinement:{requestedSatisfied:true}}),{
    now,originalPrompt:'토플 응시료가 얼마야?',readPage:async()=>({url:originalFee.url,title:originalFee.title,text:originalFee.pageText}),
    getRemainingBudget:()=>({httpRequests:2,modelRequests:0,durationMs:18000}),
  });
  assert.equal(result.results.length,0);
  assert.equal(result.bodyVerification.requestedSatisfied,false);
  assert.notEqual(result.bodyVerification.stopReason,'requested-evidence-found');
});
