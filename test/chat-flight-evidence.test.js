import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveChatSourcePlan } from '../src/chat-source-plan.js';
import { collectWebBodyEvidence } from '../src/web-evidence.js';
import { formatWebSearchContext } from '../src/web-search.js';
import { answerChatBySource, resolveChatEvidence } from '../src/chat-search-policy.js';
import { runtime } from '../scripts/lib/chat-verification-runtime.js';

const question = 'naia to pus flight time';
const plan = { mode:'search', query:'Nairobi NBO to pus flight time', purpose:'flight duration', externalPrompt:'NBO to PUS flight duration', localPrompt:'' };
const message = (q) => ({content:`%${q}`,author:{id:'test',username:'test'},guildId:'g',channelId:'c',client:{user:{username:'깐냥'}},attachments:new Map(),channel:{send:async()=>{}}});

test('directional identity survives majority-overlap rewrites and traces both endpoint changes', () => {
  for (const [original, proposed] of [[question,plan.query], ['qrx to uvz flight time','QRT to uvz flight time'], ['alpha port to beta bay travel time','different port to beta bay travel time']]) {
    const { intent } = resolveChatSourcePlan({answer:'18~25시간',sourcePlan:{...plan,query:proposed}}, original, {});
    assert.equal(intent.query, original);
    assert.equal(intent.externalPrompt, original);
    assert.equal(intent.identityTrace.original,original);
    assert.equal(intent.identityTrace.proposedQuery,proposed);
  }
});

test('actual handler cannot emit unverified duration from draft or local recovery on retrieval failure', async () => {
  for (const status of ['empty','blocked','failed','extraction-failed','insufficient-evidence','review-failed']) {
    const r=runtime({plan,search:{status,failed:true,results:[]},localAnswer:'NBO 출발이며 직항은 없고 18~25시간이다냥.'});
    await r.context.handleGeminiFallbackMessage(message(question));
    assert.deepEqual(r.queries,[question]);
    assert.equal(r.generated.length,1); // No second attempt to answer external facts from memory.
    assert.equal(r.sent.length,1);
    assert.doesNotMatch(r.sent[0],/18|25|NBO|나이로비|직항/);
    if(status==='review-failed') assert.match(r.sent[0],/검증 중 오류/);
    if(status==='insufficient-evidence') assert.doesNotMatch(r.sent[0],/연결|차단/);
  }
});

test('a short snippet supports only its explicit fields even when body extraction is unavailable', async () => {
  // Synthetic data, deliberately not an assertion about the real route.
  const snippet='QRX (Example Harbor Airport) → UVZ (Example Bay Airport): scheduled flight duration 2h 10m. Schedule sample: 2025-04-01.';
  const data=await collectWebBodyEvidence('qrx to uvz flight time',{status:'success',results:[{title:'QRX UVZ timetable',url:'https://sample.test/route',snippet}]},async(_q,options)=>{
    assert.match(options.webSearchContext,/search-snippet/);
    return {evidenceReviews:[{id:0,relevant:true,quote:snippet,reason:'dated schedule example only',dataType:'prose'}]};
  },{readPage:async()=>{throw Object.assign(new Error('unavailable'),{status:403});},search:async()=>{throw Error('do not require official prose');}});
  assert.equal(data.results[0].evidenceKind,'search-snippet');
  assert.equal(data.bodyVerification.reads[0].status,'read-failed');
  assert.equal(data.retrievalStatus,'success');
  assert.match(formatWebSearchContext('qrx to uvz flight time',data.results),/본문·현재 상태 확인 아님/);
  assert.equal(resolveChatEvidence({requiresExternal:true},{webSearchData:data}).hasEvidence,true);
});

test('valid partial evidence survives a different invalid review and unreviewed snippet text is not delivered',async()=>{
  const quote='QRX = Example Harbor Airport';
  const data=await collectWebBodyEvidence('qrx airport',{status:'success',results:[{title:'QRX',url:'https://sample.test/airport',snippet:'unreviewed unrelated assertion'}]},async()=>({evidenceReviews:[{id:0,relevant:true,quote,reason:'identity only'}]}),{readPage:async(url)=>({url,title:'QRX',text:quote})});
  assert.equal(data.status,'partial-success');
  assert.equal(data.results.length,1);
  assert.equal(data.failed,false);
  assert.doesNotMatch(formatWebSearchContext('qrx airport',data.results),/unreviewed unrelated/);
});

test('a cited answer with unsupported duration falls back to the already accepted identity evidence',async()=>{
  const source={url:'https://sample.test/identity',title:'Identity',pageText:'QRX = Example Harbor Airport',evidenceKind:'search-snippet',bodyReview:{relevant:true}};
  const {intent}=resolveChatSourcePlan({answer:'18~25시간',sourcePlan:{...plan,query:'qrx to uvz flight time'}},'qrx to uvz flight time',{});
  const result=await answerChatBySource('qrx to uvz flight time',{searchIntent:intent,evidenceDecision:{hasEvidence:true},webEvidence:[source]},async(_q,options)=>options.evidenceReview
    ? {evidenceReviews:[{id:0,relevant:false,quote:'',reason:'No duration, direct service or connection time in evidence'}]}
    : {answer:'직항이 없고 18~25시간이다냥. https://sample.test/identity',citationsValid:true});
  assert.doesNotMatch(result.answer,/18|25|직항이 없/);
  assert.match(result.answer,/QRX = Example Harbor Airport/);
  assert.equal(result.answerVerification.reviews[0].reason,'No duration, direct service or connection time in evidence');
});

test('metadata ranking favors the requested endpoints and attribute over long unrelated bodies', async () => {
  const {rankWebCandidates}=await import('../src/web-evidence.js');
  const ranked=rankWebCandidates('qrx to uvz flight duration',[
    {title:'2023 QRX flight outage archive',url:'https://sample.test/archive',snippet:'Old disruption news'},
    {title:'Other City to UVZ flight duration',url:'https://sample.test/wrong',snippet:'Other City to UVZ'},
    {title:'UVZ to QRX flight duration',url:'https://sample.test/reverse',snippet:'Reverse direction'},
    {title:'QRX to UVZ flight duration',url:'https://sample.test/right',snippet:'Scheduled flight duration'},
  ]);
  assert.equal(ranked[0].candidate.url,'https://sample.test/right');
  assert.equal(ranked.find(r=>r.candidate.url.endsWith('/wrong')).eligible,false);
  assert.equal(ranked.find(r=>r.candidate.url.endsWith('/reverse')).eligible,false);
});

test('rejected and identity-only evidence trigger bounded alias-backed refinements in the original direction',async()=>{
  for(const identityOnly of [false,true]) {
    const identity='QRX is Harbor Airport (HBR) in Harbor City. UVZ is Bay Airport (BAY) in Bay City.';
    const quote='Harbor City to Bay City scheduled flight duration: 2h 10m, timetable sample only.';
    const initial={status:'success',results:[{title:'QRX and UVZ airport identities',url:'https://sample.test/identity',snippet:identity}]};
    const queries=[], fetched=[];
    let calls=0;
    const result=await collectWebBodyEvidence('qrx to uvz flight time',initial,async()=>{
      calls++;
      if(calls===1) return {evidenceReviews:[{id:0,relevant:identityOnly,quote:identityOnly?identity:'',reason:'Identity only, no requested duration'}],searchRefinement:{requestedSatisfied:false,aliases:[
        {from:'qrx',to:'Harbor City',sourceId:0,quote:identity},
        {from:'uvz',to:'Bay City',sourceId:0,quote:identity},
        {from:'qrx',to:'HBR',sourceId:0,quote:identity},
        {from:'uvz',to:'BAY',sourceId:0,quote:identity},
        {from:'qrx',to:'Invented City',sourceId:0,quote:identity},
      ],queries:['Bay City to Harbor City flight duration','Invented City to Bay City flight time','Harbor City to Bay City flight duration','HBR to BAY flight time']}};
      return {evidenceReviews:[{id:0,relevant:true,quote,reason:'Duration with timetable condition only'}],searchRefinement:{requestedSatisfied:true,aliases:[],queries:[]}};
    },{readPage:async(url)=>{fetched.push(url);return {url,title:'Identity',text:''};},search:async(q)=>{
      queries.push(q);return {status:'success',results:[{title:'Harbor City to Bay City flight duration',url:'https://sample.test/duration',snippet:quote}]};
    }});
    assert.deepEqual(queries,['Harbor City to Bay City flight duration']);
    assert.equal(result.bodyVerification.searches.length,1);
    assert.equal(result.bodyVerification.stopReason,'requested-evidence-found');
    assert.equal(result.bodyVerification.decisions[0].condition,identityOnly?'requested-attribute-insufficient':'review-rejected');
    assert.ok(result.bodyVerification.aliases.every(a=>a.to!=='Invented City'));
    assert.ok(result.results.some(s=>s.pageText===quote));
    assert.ok(fetched.includes('https://sample.test/duration'));
  }
});

test('a snippet alone no longer suppresses retry after relevance rejection, and budget stops are explicit',async()=>{
  const options={readPage:async(url)=>({url,text:''}),search:async()=>({status:'empty',results:[]})};
  const initial={status:'success',results:[{title:'QRX archive',url:'https://sample.test/a',snippet:'QRX outage in 2023'}]};
  const generate=async()=>({evidenceReviews:[{id:0,relevant:false,quote:'',reason:'No requested route duration'}]});
  const retried=await collectWebBodyEvidence('qrx to uvz flight time',initial,generate,options);
  assert.equal(retried.bodyVerification.searches.length,1);
  assert.equal(retried.bodyVerification.stopReason,'no-safe-query-refinement');
  const blocked=await collectWebBodyEvidence('qrx to uvz flight time',initial,generate,{...options,getRemainingBudget:()=>({httpRequests:20,modelRequests:2,durationMs:40000})});
  assert.deepEqual(blocked.bodyVerification.searches,[]);
  assert.equal(blocked.bodyVerification.stopReason,'external-budget-reserved-for-answer');
  assert.equal(blocked.bodyVerification.decisions[0].remaining.external.httpRequests,20);
  assert.equal(blocked.bodyVerification.decisions[0].condition,'review-rejected');
});

test('flight-time failure does not append a universal existence disclaimer',()=>{
  const result=resolveChatEvidence({requiresExternal:true,hasLocalAnswer:false,externalPrompt:question},{webSearchData:{status:'insufficient-evidence',results:[]}});
  assert.doesNotMatch(result.unavailable,/존재하지/);
  assert.match(result.unavailable,/확인하지 못/);
});
