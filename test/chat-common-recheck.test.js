import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractKmaDailyForecast, reviewSourceBodies, evidenceRequestMismatch } from '../src/evidence-review.js';
import { collectWebBodyEvidence, renderWeatherEvidence } from '../src/web-evidence.js';
import { resolveChatSourcePlan } from '../src/chat-source-plan.js';
import { resolveChatEvidence, answerChatBySource } from '../src/chat-search-policy.js';
import { summarizeVerification } from '../scripts/lib/chat-verification-report.js';
import { generator } from './helpers/captured-chat-generator.js';
const logs = JSON.parse(fs.readFileSync(new URL('./fixtures/chat-common-recheck-20261017.json',import.meta.url)));
const l = logs.mixed;
const read = l.reads[0];
const source = {url:read.fetchedUrl,title:read.extractedTitle,discoveredTitle:read.searchTitle,pageText:read.extractedBody,metadataText:read.extractedMetadata,evidenceKind:'body'};
const query = `기준일: ${l.now}\n질문 원문: ${l.question}\n실제 검색어: 부산 날씨`;
const exact = '○ (오늘, 17일) 가끔 구름많다가 밤부터 흐려짐';
const emptySearch = async()=>({status:'empty',results:[]});

test('common recheck identities and original response/body are preserved',()=>{
  for(const log of Object.values(logs)) assert.equal(log.identity.codeSha256,'9afc1aef84a7cfcc71299463009ff1d47056e470bd5cad0d94f214b3ea0fccca');
  assert.ok(source.pageText.includes(exact));
  const raw = JSON.parse(l.responses.find(e=>e.stage==='evidence-review').raw).evidenceReviews[0];
  assert.equal(raw.validTime,'2026년 10월 17일 17:00 발표 (오늘~그글피)');
  assert.ok(raw.weatherFields.every(f=>!source.pageText.includes(f)));
});

test('actual model response is replayed unchanged; independent KMA section supplies exact evidence',async()=>{
  const {generate} = generator([l.responses.find(e=>e.stage==='evidence-review').raw]);
  const [r] = await reviewSourceBodies(query,[source],generate,{now:l.now});
  assert.equal(r.bodyReview.relevant,true);
  assert.equal(r.bodyReview.validTime,'2026-10-17');
  assert.equal(r.bodyReview.publicationTime,'2026년 10월 17일 (토)요일 17:00 발표');
  assert.equal(r.bodyReview.regionalTitle,'예보 통보문(부산·울산·경남)');
  assert.deepEqual(r.bodyReview.weatherFields,[exact]);
  assert.equal(r.bodyReview.quote,exact);
  assert.equal(r.bodyReview.rawModelReview.validTime,'2026년 10월 17일 17:00 발표 (오늘~그글피)');
  assert.deepEqual(r.bodyReview.validationFailures,[]);
  assert.equal(evidenceRequestMismatch(l.question,r,r.bodyReview,l.now),'');
  assert.match(renderWeatherEvidence({results:[r]},l.question,l.now),/가끔 구름많다가 밤부터 흐려짐/);
  for(const weatherFields of [[exact+' 99℃'],[exact,'10~50mm']])
    assert.equal(evidenceRequestMismatch(l.question,r,{...r.bodyReview,weatherFields},l.now),'weather-bulletin-scope-mismatch');
});

test('full mixed replay keeps identity and actually answers weather with the selected URL',async()=>{
  const {generate} = generator(l.responses.slice(0,2).map(e=>e.raw));
  const planned = await generate(l.question,{});
  const plan = resolveChatSourcePlan(planned,l.question);
  const data = await collectWebBodyEvidence('부산 날씨',{status:'success',results:[{url:source.url,title:source.discoveredTitle}]},generate,{
    originalPrompt:l.question,now:l.now,search:emptySearch,readPage:async()=>({url:source.url,title:source.title,text:source.pageText,metadataText:source.metadataText}),
  });
  assert.equal(data.bodyVerification.requestedSatisfied,true);
  const answer = await answerChatBySource(l.question,{searchIntent:plan.intent,plannedAnswer:planned,originalPrompt:l.question,now:l.now,webEvidence:data.results,
    evidenceDecision:resolveChatEvidence(plan.intent,{webSearchData:data}),verifiedExternalAnswer:renderWeatherEvidence(data,l.question,l.now)},async()=>assert.fail('no invented answer response'));
  assert.match(answer.answer,/CODEX.*깐냥/);
  assert.ok(answer.answer.includes(exact));
  assert.ok(answer.answer.includes(source.url));
  assert.doesNotMatch(answer.answer,/18일|10~50mm|99℃/);
  assert.equal(answer.answerVerification.status,'success');
});

test('publication date cannot authorize past/future forecast or another region',()=>{
  for(const replacement of ['○ (내일, 18일)','○ (어제, 16일)','○ (오늘, 16일)']) {
    const s={...source,pageText:source.pageText.replace('○ (오늘, 17일)',replacement)};
    assert.equal(extractKmaDailyForecast(query,s,l.now),null);
  }
  assert.equal(extractKmaDailyForecast(query,{...source,discoveredTitle:'예보 통보문(서울·인천·경기)'},l.now),null);
  assert.equal(extractKmaDailyForecast(query,{...source,url:source.url.replace('159','108')},l.now),null);
  assert.equal(extractKmaDailyForecast(query,{...source,pageText:source.pageText.replaceAll('부산, 울산, 경상남도','서울, 인천, 경기도')},l.now),null);
  assert.equal(extractKmaDailyForecast(query,{...source,evidenceKind:'search-snippet'},l.now),null);
  assert.equal(extractKmaDailyForecast(query.replace('부산 날씨','서울 날씨').replace('오늘 부산','오늘 서울'),source,l.now),null);
  assert.equal(extractKmaDailyForecast(query.replace('부산 날씨','부산 기온'),source,l.now),null);
  assert.equal(extractKmaDailyForecast(query.replace('날씨는', '날씨와 강수량은'),source,l.now),null);
});

test('a fresh publication with only past/future fields is rejected through review and rendering',async()=>{
  for(const heading of ['○ (내일, 18일)','○ (어제, 16일)','○ (오늘, 16일)']) {
    const page={...source,pageText:source.pageText.replace('○ (오늘, 17일)',heading)};
    const [r]=await reviewSourceBodies(query,[page],async()=>({evidenceReviews:[{id:0,relevant:true,requestSatisfied:true,region:'부산',validTime:'2026년 10월 17일',kind:'forecast',dataType:'prose',quote:page.pageText.slice(0,550),weatherFields:['가끔 구름많다가 밤부터 흐려짐']}]}),{now:l.now});
    assert.equal(r.bodyReview.relevant,false);
    assert.equal(renderWeatherEvidence({results:[r]},l.question,l.now),'');
  }
});

test('official fallback is actually fetched when search offers only a regional home screen',async()=>{
  const urls=[];
  const data=await collectWebBodyEvidence('부산 날씨',{status:'success',results:[{url:'https://www.weather.go.kr/busan/html/main/index.jsp',title:'부산지방기상청'}]},
    async()=>({evidenceReviews:[{id:0,relevant:false,requestSatisfied:false,quote:'',reason:'모델 인용 미확보'}]}),{
      originalPrompt:l.question,now:l.now,search:async()=>assert.fail('no extra search needed'),
      readPage:async url=>{urls.push(url);return {url,title:source.title,text:source.pageText};},
    });
  assert.deepEqual(urls,[source.url]);
  assert.equal(data.results[0].bodyReview.modelReviewUsed,false);
  assert.ok(renderWeatherEvidence(data,l.question,l.now).includes(exact));
});

test('blog amount needs country, exact test and applicable dates even when labelled estimate',()=>{
  const quote='한국 TOEFL iBT 응시료 약 35만원, 적용 기간 2026-01-01 ~ 2026-12-31';
  const review={relevant:true,requestSatisfied:true,quote,feeApplicability:{scope:'estimate',country:'한국',examType:'TOEFL iBT',validFrom:'2026-01-01',validThrough:'2026-12-31',quote}};
  const page={pageText:quote};
  assert.equal(evidenceRequestMismatch('한국 TOEFL iBT 응시료',page,review,l.now),'');
  for(const key of ['country','examType','validFrom','validThrough']) {
    const changed={...review,feeApplicability:{...review.feeApplicability,[key]:''}};
    assert.ok(evidenceRequestMismatch('한국 TOEFL iBT 응시료',page,changed,l.now));
  }
  assert.equal(evidenceRequestMismatch('미국 TOEFL iBT 응시료',page,review,l.now),'fee-country-mismatch');
  assert.equal(evidenceRequestMismatch('한국 TOEFL iBT 응시료',page,review,'2027-01-01T00:00:00Z'),'fee-not-valid-at-request-time');
});

test('independent extraction never overrides a rejected final-answer verification',async()=>{
  const [r]=await reviewSourceBodies(query,[source],async()=>({evidenceReviews:[{id:0,relevant:false,requestSatisfied:false,quote:'',reason:'답변의 기온이 원문에 없음'}]}),{now:l.now,finalVerification:true});
  assert.equal(r.bodyReview.relevant,false);
});

test('TOEFL actual official body/response yield sourced partial, distinct from outage',async()=>{
  const log=logs['toefl-fact']; const original=log.reads[0];
  const {generate}=generator(log.responses.filter(e=>e.stage==='evidence-review').map(e=>e.raw));
  const data=await collectWebBodyEvidence('토플 응시료',{status:'success',results:[{url:original.requestedUrl,title:original.searchTitle}]},generate,{
    originalPrompt:log.question,now:log.now,search:async()=>assert.fail('country required'),
    readPage:async()=>({url:original.fetchedUrl,title:original.extractedTitle,text:original.extractedBody}),
  });
  assert.equal(data.status,'sourced-partial');
  assert.equal(data.bodyVerification.requestedSatisfied,false);
  const intent={requiresExternal:true,externalPrompt:log.question};
  const decision=resolveChatEvidence(intent,{webSearchData:data});
  assert.equal(decision.hasPartialEvidence,true);
  assert.equal(decision.hasEvidence,false);
  const r=await answerChatBySource(log.question,{searchIntent:intent,evidenceDecision:decision},async()=>assert.fail());
  assert.equal(r.answerVerification.status,'sourced-partial');
  assert.match(r.answer,/시험 장소를 선택/);
  assert.match(r.answer,/국가·지역을 알려/);
  assert.doesNotMatch(r.answer,/한국|220|15,729/);
  assert.ok(r.answer.includes(original.fetchedUrl));
  const knownCountry=resolveChatEvidence({...intent,externalPrompt:'한국 TOEFL iBT 응시료'},{webSearchData:data});
  assert.match(knownCountry.unavailable,/한국의 현재 기본 응시료/);
  assert.doesNotMatch(knownCountry.unavailable,/국가·지역을 알려/);
  const report=summarizeVerification([{event:'tryBuildWebSearchData',result:data},{event:'answer-verification',result:r.answerVerification}],[r.answer]);
  assert.equal(report.qualityStatus,'sourced-partial');
  assert.equal(report.claimSourceMatch,'partial');
  assert.equal(report.failurePath,null);
  assert.equal(report.qualityPassed,false);
  const outage=resolveChatEvidence(intent,{webSearchData:{status:'retrieval-failed',failed:true}});
  assert.equal(outage.hasPartialEvidence,false);
  assert.match(outage.unavailable,/조회 요청이 실패/);
});
