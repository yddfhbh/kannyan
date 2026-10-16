import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runtime } from '../scripts/lib/chat-verification-runtime.js';
import { extractWikiBirthDate, extractWikiBirthEvidence, parsePyhokWikiSearchResponse, answerWikiAgeQuestion, searchPyhokWiki, resolvePyhokWikiLookup } from '../src/pyhok-wiki-search.js';
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/chat-live-regressions.json', import.meta.url)));

test('reported wiki markup and compact birth field preserve field evidence before truncation', () => {
  for (const text of [fixture.wiki.content, fixture.wiki.raw,
    '파이호크프로필국적대한민국생일2007년 9월 14일본명…',
    '파이호크의 생일은 2007년&nbsp;9월&nbsp;14일이다.',
    '<table><tr><th><b>생일</b></th><td>2007년 9월 14일</td></tr></table>',
    '== 프로필 ==\n생일2007년 9월 14일[* 1999년 1월 2일 행사]본명…',
  ]) {
    assert.equal(extractWikiBirthDate(text,fixture.wiki.title),fixture.wiki.expectedBirthDate);
    assert.match(extractWikiBirthEvidence(text,fixture.wiki.title).quote,/생일/);
  }
  const results = parsePyhokWikiSearchResponse({hits:[{
    ...fixture.wiki, content:'설명 '.repeat(4000), anyoneReadable:true,
  }]},{query:fixture.wiki.title, originalQuery:'푝무위키 파이호크 나이'});
  assert.equal(results[0].verifiedBirthDate,fixture.wiki.expectedBirthDate);
  assert.equal(results[0].birthDateEvidence.field,'생일');
  assert.match(answerWikiAgeQuestion('푝무위키 파이호크 나이',{results},'2026-10-15'),/만 19세/);
  assert.equal(extractWikiBirthDate("||'''생일''' ||1998년 3월 6일||",'다른대상'),'1998-03-06');
});

test('neighbours, event dates, footnotes, invalid or conflicting birthdays are not birth evidence', () => {
  for (const text of [
    '== 주변 인물 ==\n생일2007년 9월 14일',
    '== 주변 인물 ==\n=== 프로필 ===\n생일2007년 9월 14일',
    '<h2>주변 인물</h2><table><tr><th>생일</th><td>2007년 9월 14일</td></tr></table>',
    '친구 생일2007년 9월 14일',
    '다른사람의 생일2007년 9월 14일',
    "|| 데뷔 ||2007년 9월 14일||",
    '생일[* 2007년 9월 14일 행사]미상',
    '생일<sup>2007년 9월 14일</sup>미상',
    '생일2007년 2월 30일',
    '생일2007년 9월 14일\n생일2008년 9월 14일',
    '생일2007년 9월 14일 또는 2008년 9월 14일',
  ]) assert.equal(extractWikiBirthDate(text,fixture.wiki.title),null,text);
  const results = parsePyhokWikiSearchResponse({hits:[{
    title:fixture.wiki.title, raw:fixture.wiki.raw,
    content:'생일2008년 9월 14일',anyoneReadable:true,
  }]},{query:fixture.wiki.title});
  assert.equal(results[0].verifiedBirthDate,null);
  const conflicting = parsePyhokWikiSearchResponse({hits:[{
    title:fixture.wiki.title,raw:fixture.wiki.raw+'\n생일2008년 9월 14일',content:fixture.wiki.content,anyoneReadable:true,
  }]},{query:fixture.wiki.title});
  assert.equal(conflicting[0].verifiedBirthDate,null);
});

test('actual handler delivers the completed weather answer once through local transport',async()=>{
  const r=runtime({search:{status:'success',results:[{title:'부산 날씨',url:'https://weather.test/report'}],context:'부산 날씨'}});
  let calls=0;
  r.context.generateGeminiAnswer=async (_prompt,options)=>{
    calls++;
    if(options.planSearch) return {answer:fixture.weather.draft,sourcePlan:{mode:'search',query:'부산 날씨',purpose:'현재 날씨 확인',externalPrompt:'부산 날씨'}};
    assert.equal(options.completeAnswer,true);
    return {answer:fixture.weather.final,citationsValid:true};
  };
  await r.context.handleGeminiFallbackMessage({content:`%${fixture.weather.question}`,author:{id:'test',username:'test'},guildId:'g',channelId:'c',client:{user:{username:'깐냥'}},attachments:new Map(),channel:{send:async()=>{}}});
  assert.equal(calls,2);
  assert.deepEqual(r.sent,[fixture.weather.final]);
});


test('original wiki target survives rewritten plans, unrelated birthdays and retrieval rank', async () => {
  const question = '푝무위키 파이호크 나이';
  const rewrite = '파이호크 나이 검색하고 그 확인해줘';
  const calls = [];
  const data = await searchPyhokWiki(rewrite, {
    originalPrompt: question, plannedQuery: rewrite,
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body).q);
      return new Response(JSON.stringify({ hits: [
        { title: '다른 인물', raw: '생일1998년 3월 6일', anyoneReadable: true },
        { title: '파이호크 팬', raw: '생일2000년 1월 1일', anyoneReadable: true },
        { ...fixture.wiki, anyoneReadable: true },
      ] }));
    }, logger: {},
  });
  assert.deepEqual(calls, ['파이호크']);
  assert.deepEqual(data.lookup, resolvePyhokWikiLookup(question, rewrite));
  assert.equal(data.lookup.attribute, 'age');
  assert.equal(data.results[0].exactTitleMatch, true);
  assert.equal(data.results[0].normalizedSearchQuery, '파이호크');
  const r = runtime({wiki: data, localAnswer: '', plan: {mode:'search', query: rewrite, purpose:'나이 확인', externalPrompt:'푝무위키 다른 인물 나이'}});
  let wikiPrompt;
  r.context.tryBuildPyhokWikiSearchData = async (prompt) => { wikiPrompt = prompt; return data; };
  await r.context.handleGeminiFallbackMessage({content:`%${question}`,author:{id:'test',username:'test'},guildId:'g',channelId:'c',client:{user:{username:'깐냥'}},attachments:new Map(),channel:{send:async()=>{}}});
  assert.equal(wikiPrompt, question);
  assert.equal(r.sent.length, 1);
  assert.match(r.sent[0], /2007-09-14/);
  assert.match(answerWikiAgeQuestion(question, data, '2026-10-15'), /만 19세/);
  assert.doesNotMatch(r.sent[0], /1998|2000/);
  assert.match(answerWikiAgeQuestion(question, {results:data.results.filter(r=>!r.exactTitleMatch)}, '2026-10-15'), /확실히 확인하지 못/);
  assert.match(answerWikiAgeQuestion(question, {results:[data.results[0],data.results[0]]}, '2026-10-15'), /확실히 확인하지 못/);
});

test('shared session new topics never concatenate previous searches or duplicate current requests', async () => {
  const questions = ['최신 AI 뉴스 검색해서 요약해줘', 'gpt 6 sol vs gpt 6.1 sol'];
  const r = runtime({localAnswer:''});
  r.context.getGeminiSessionHistory = () => [...r.stored];
  r.context.generateGeminiAnswer = async (_prompt, options) => options.planSearch
    ? {answer:'',sourcePlan:{mode:'search',query:'부산 날씨 AI 뉴스 제품 비교',purpose:'확인',externalPrompt:'확인해줘'}}
    : {answer:'확인했다냥. https://source.test',citationsValid:true};
  for (const question of questions) await r.context.handleGeminiFallbackMessage({content:`%${question}`,author:{id:'test',username:'test'},guildId:'g',channelId:'c',client:{user:{username:'깐냥'}},attachments:new Map(),channel:{send:async()=>{}}});
  assert.deepEqual(r.queries, questions);
});
