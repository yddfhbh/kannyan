import test from 'node:test';
import assert from 'node:assert/strict';
import { answerClockQuestion, getChatClock, calculateAge, getAgeReferenceDate } from '../src/chat-clock.js';
import { createGeminiChatContents } from '../src/gemini-memory.js';
import { selectGeminiContextSections } from '../src/gemini-context.js';
import { shouldUseWebSearch, classifyWebSearchIntent, searchWeb } from '../src/web-search.js';
import { buildPyhokWikiSearchData, parsePyhokWikiSearchResponse, answerWikiAgeQuestion, derivePyhokWikiSearchQuery, extractWikiBirthDate, wikiSearchUnavailableReply } from '../src/pyhok-wiki-search.js';
import { requestChatWithFallback, classifyChatRequestError } from '../src/gemini-chat-request.js';
import { selectRelevantSearchResults, validateChatCitations } from '../src/chat-evidence.js';

const now = new Date('2026-10-14T15:00:00Z');
const prompt = '푝무위키 파이호크 나이';
const wikiData = (content, title = '파이호크') => ({ results: parsePyhokWikiSearchResponse({ hits: [{ title, content, anyoneReadable: true }] }, { query: '파이호크', originalQuery: prompt }) });

test('clock variants, explicit date search, KST midnight, timezone and non-clock prompts', () => {
  for (const q of ['오늘날짜', '오늘 날짜', '오늘 날짜 검색해서 알아와', '오늘 날짜가 뭐야?']) assert.match(answerClockQuestion(q, now), /2026-10-15 목요일/);
  assert.equal(getChatClock('2026-10-14T14:59:59Z').date, '2026-10-14');
  assert.equal(getChatClock(now).date, '2026-10-15');
  assert.match(answerClockQuestion('뉴욕 오늘 날짜', now), /2026-10-14/);
  assert.match(answerClockQuestion('UTC 현재 시간', now), /15:00:00/);
  assert.equal(answerClockQuestion('오늘 날짜로 열리는 경기 일정', now), '');
  assert.equal(answerClockQuestion('오늘 날짜를 영어로 번역해줘', now), '');
  assert.equal(answerClockQuestion('오늘 날짜와 내일 날씨', now), '');
});

test('age calculation validates birthdays, leap days, before birthday and on birthday', () => {
  assert.equal(calculateAge('2000-10-15', '2026-10-14'), 25);
  assert.equal(calculateAge('2000-10-15', '2026-10-15'), 26);
  assert.equal(calculateAge('2000-02-29', '2025-02-28'), 24);
  assert.equal(calculateAge('2000-02-29', '2025-03-01'), 25);
  assert.equal(calculateAge('2000-02-30', '2026-10-15'), null);
  assert.equal(calculateAge('2030-01-01', '2026-10-15'), null);
  assert.equal(getAgeReferenceDate('2026년 10월 14일 기준', now), '2026-10-14');
  assert.equal(getAgeReferenceDate('2026-02-30 기준', now), null);
});

test('recent context retains middle conditions, reply speaker IDs and room for grounding', () => {
  const condition = '조건: 예산은 15만원 이하이고 빨간색은 반드시 제외한다.';
  const history = [
    { role: 'user', authorName: '동명이름', authorId: 'alice', text: `${'앞부분 '.repeat(200)}\n${condition}\n${'뒷부분 '.repeat(200)}` },
    { role: 'model', text: '알겠어. 예전 추측은 사실이 아닐 수 있어.' },
  ];
  const result = selectGeminiContextSections({ history, prompt: '그럼 추천은?', currentAuthorId: 'bob', currentUserContext: 'bob', contextDependentPrompt: true, replyContext: { authorId: 'alice', authorName: '동명이름', text: '내 고양이 이름은 나비' }, webSearchContext: 'URL: https://example.org/source\n' + '검색 자료 '.repeat(6000), maxContextLength: 6000 });
  assert.match(result.prompt, /15만원 이하/);
  assert.match(result.prompt, /빨간색은 반드시 제외/);
  assert.match(result.prompt, /ID=alice/);
  assert.match(result.prompt, /미검증 대화/);
  assert.match(result.prompt, /개인 정보로 바꾸지/);
  assert.match(result.prompt, /그럼 추천은/);
  assert.equal(result.stats.immediateHistoryCount, 2);
  assert.ok(result.stats.includedHistoryChars > 320);
  assert.ok(result.prompt.length <= 6000);
});

test('actual included memory count is separate from stored count', () => {
  const history = Array.from({length: 50}, (_, i) => ({role: i % 2 ? 'model' : 'user', text: `${i} ${'긴 메시지 '.repeat(500)}`}));
  const result = selectGeminiContextSections({history, prompt: '그럼?', maxContextLength: 2000});
  assert.equal(result.stats.originalHistoryCount, 50);
  assert.ok(result.stats.immediateHistoryCount < 16);
  assert.equal((result.prompt.match(/\[화자=/g) ?? []).length, result.stats.immediateHistoryCount + result.stats.olderRetrievedHistoryCount);
});

test('legacy factual lookup helper and deferred ordinary source decisions retain evidence checks', () => {
  for (const q of ['파이호크 나이', '아이유 생년월일', 'node 최신 버전', '삼성전자 주가', '사진 속 제품 최신 가격 검색해줘']) assert.equal(shouldUseWebSearch(q), true, q);
  for (const q of ['안녕', '오늘 좀 피곤하다', '이 문장을 번역해줘', '제공한 글 요약해줘', '2+2', '2+2는 뭐야?', '계산해줘 3*5', '오늘 내 생일이야']) assert.equal(classifyWebSearchIntent(q).reason, 'model-source-plan', q);
  assert.deepEqual(selectRelevantSearchResults('파이호크 나이', [{title:'유명인 김철수 생일',snippet:'2000년 1월 1일'}]), []);
  assert.equal(validateChatCitations('검색 결과에 따르면 20살 https://fake.test', 'URL: https://source.test'), '제공된 자료에서 답변의 출처를 확인하지 못했다냥.');
  assert.equal(validateChatCitations('20살이다냥. https://fake.test', '잘려서 URL이 없는 문맥'), '제공된 자료에서 답변의 출처를 확인하지 못했다냥.');
  assert.equal(validateChatCitations('20살이다냥.', ''), '제공된 자료만으로 답변의 근거를 특정하지 못했다냥.');
  assert.equal(validateChatCitations('생년월일을 확인하지 못했다냥.', ''), '생년월일을 확인하지 못했다냥.');
});

test('web network failure, blocking and genuine empty results stay distinct', async () => {
  const empty = await searchWeb('test', {fetchImpl: async () => new Response('<html></html>')});
  assert.equal(empty.status, 'empty');
  const blocked = await searchWeb('test', {fetchImpl: async () => new Response('', {status:403})});
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.failed, true);
  const failed = await searchWeb('test', {fetchImpl: async () => { throw new TypeError('network'); }});
  assert.equal(failed.status, 'failed');
});

test('wiki searches the subject and computes age solely from that exact document', () => {
  assert.equal(derivePyhokWikiSearchQuery(prompt), '파이호크');
  const data = wikiData('생년월일: 2000년 10월 15일\n친구 철수의 생일은 1990년 1월 2일이다.');
  assert.match(answerWikiAgeQuestion(prompt, data, now), /만 26세/);
  assert.match(answerWikiAgeQuestion(`${prompt} 2026-10-14 기준`, data, now), /만 25세/);
  assert.match(answerWikiAgeQuestion(prompt, data, '2026-10-14T14:59:59Z'), /만 25세/);
  assert.match(answerWikiAgeQuestion(prompt, data, now), /https:\/\/pyhok.com/);
  assert.match(answerWikiAgeQuestion(prompt, wikiData('친구 철수의 생일: 1990년 1월 2일'), now), /확인하지 못/);
  assert.match(answerWikiAgeQuestion(prompt, wikiData('생년월일: 1990년 1월 2일', '주변인물'), now), /대상 인물/);
  assert.equal(extractWikiBirthDate('== 주변 인물 ==\n생년월일: 1990-01-02', '파이호크'), null);
  assert.equal(extractWikiBirthDate('생년월일: 2000-10-15\n생년월일: 2001-10-15', '파이호크'), null);
});

test('wiki extracts attributes deep in a document and protects public filtering', async () => {
  let request;
  const data = await buildPyhokWikiSearchData(prompt, {enabled:true, logger:{log(){},warn(){}}, fetchImpl: async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({hits:[{title:'파이호크',anyoneReadable:true,content: '설명 '.repeat(10000) + '\n생년월일: 2000-10-15\n' + '후반 '.repeat(1000)}]}));
  }});
  assert.equal(request.q, '파이호크');
  assert.deepEqual(request.filter, ['anyoneReadable = true']);
  assert.match(data.context, /2000-10-15/);
  assert.match(answerWikiAgeQuestion(prompt, data, now), /만 26세/);
  assert.match(answerWikiAgeQuestion(`${prompt} 2026-10-14 기준`, data, now), /만 25세/);
});

test('wiki disabled, unauthorized, timeout, malformed response and empty results differ', async () => {
  const disabled = await buildPyhokWikiSearchData(prompt, {enabled:false});
  assert.equal(disabled.status, 'disabled');
  for (const [status, expected] of [[401,'unauthorized'],[403,'unauthorized'],[429,'blocked']]) {
    const data = await buildPyhokWikiSearchData(prompt, {enabled:true,logger:{warn(){},log(){}},fetchImpl:async()=>new Response('{}',{status})});
    assert.equal(data.status, expected);
    assert.doesNotMatch(wikiSearchUnavailableReply(data), /찾지 못/);
  }
  const timeout = await buildPyhokWikiSearchData(prompt,{enabled:true,logger:{warn(){},log(){}},fetchImpl:async()=>{const e=new Error();e.name='AbortError';throw e;}});
  assert.equal(timeout.status,'timeout');
  const empty = await buildPyhokWikiSearchData(prompt,{enabled:true,logger:{warn(){},log(){}},fetchImpl:async()=>new Response('{"hits":[]}')});
  assert.equal(empty.status,'empty');
  const malformed = await buildPyhokWikiSearchData(prompt,{enabled:true,logger:{warn(){},log(){}},fetchImpl:async()=>new Response('{"error":"bad"}')});
  assert.equal(malformed.status,'http-error');
});

test('fallback tries another key on the same model before lowering quality; context is identical', async () => {
  const context = selectGeminiContextSections({prompt:'현재 질문',history:[{role:'user',authorId:'alice',text:'기억의 핵심 조건'}],webSearchContext:'검증 자료 URL: https://source.test',clockContext:'고정 실행 시각'});
  const payload = {contents:createGeminiChatContents(context.prompt,[{inline_data:{data:'image'}}])};
  assert.match(payload.contents[0].parts[0].text,/현재 질문/);
  assert.match(payload.contents[0].parts[0].text,/기억의 핵심 조건/);
  assert.match(payload.contents[0].parts[0].text,/검증 자료/);
  const calls=[];
  const result = await requestChatWithFallback(payload,{models:['primary','fallback'],keys:['a','b'],request:async(model,body,key)=>{
    calls.push([model,body,key]);
    if (calls.length<3) {const e=new Error();e.status=429;throw e;}
    return { modelVersion: 'fallback-version' };
  }});
  assert.deepEqual(calls.map(([model,,key])=>[model,key]), [['primary','a'],['primary','b'],['fallback','a']]);
  assert.ok(calls.every(([,body])=>body===payload));
  assert.equal(result._requestMeta.model,'fallback');
  assert.equal(result._requestMeta.responseModel,'fallback-version');
  assert.equal(classifyChatRequestError({status:400}), 'request');
  assert.equal(classifyChatRequestError({status:400,details:{details:[{reason:'API_KEY_INVALID'}]}}), 'key');
  let count=0;
  await assert.rejects(requestChatWithFallback(payload,{models:['primary','fallback'],keys:['a','b'],request:async()=>{count++;const e=new Error('bad payload');e.status=400;throw e;}}));
  assert.equal(count,1);
});
