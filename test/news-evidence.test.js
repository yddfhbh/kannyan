import test from 'node:test';
import assert from 'node:assert/strict';
import { collectNewsEvidence, answerVerifiedNews } from '../src/news-evidence.js';
import { extractReadablePageText, fetchWebPageText } from '../src/web-page-content.js';
import { formatWebSearchContext } from '../src/web-search.js';
import { resolveChatEvidence } from '../src/chat-search-policy.js';
import { selectGeminiContextSections } from '../src/gemini-context.js';

const now='2026-10-15T12:00:00Z';
function article(url, overrides={}) {
  return {url,title:'AI 기술 기사',articleTitle:'새 AI 모델 공개',text:'AI 기술 발표에 관한 확인된 개별 기사 본문. '.repeat(15),
    publishedAt:'2026-10-14T09:00:00Z',publicationEvidence:'datePublished',isArticle:true,links:[],...overrides};
}

test('article metadata and related links are extracted before JSON-LD removal',()=>{
  const page=extractReadablePageText(`<title>뉴스룸</title><script type="application/ld+json">${JSON.stringify({
    '@context':'https://schema.org','@type':'NewsArticle',headline:'새 AI 모델 공개',datePublished:'2026-10-14T09:00:00Z',
  })}</script><article><h1>새 AI 모델 공개</h1><p>관련 본문</p><a href="/stories/new-model">새 모델에 관한 관련 기사</a></article>`);
  assert.equal(page.articleTitle,'새 AI 모델 공개');
  assert.equal(page.publicationEvidence,'datePublished');
  assert.equal(page.isArticle,true);
  assert.equal(page.links[0].url,'/stories/new-model');
  assert.doesNotMatch(page.text,/schema.org|datePublished/);
  assert.equal(extractReadablePageText('<title>뉴스룸</title><main>최신 기사 목록</main>').isArticle,false);
});

test('newsroom discovery follows bounded related links and only supplies verified articles',async()=>{
  const reads=[];
  const result=await collectNewsEvidence('최신 AI 뉴스',{
    status:'success',results:[{title:'AI 뉴스룸',url:'https://publisher.test/newsroom'}],
  },{now,search:async()=>({status:'empty',results:[]}),readPage:async(url)=>{
    reads.push(url);
    if(url.endsWith('/newsroom')) return {url,text:'뉴스룸 목록',links:[{url:'/stories/new-ai',title:'AI 발표 기사'},{url:'/tag/ai',title:'AI 태그'}]};
    return article(url);
  }});
  assert.equal(result.results.length,1);
  assert.deepEqual(reads,['https://publisher.test/newsroom','https://publisher.test/stories/new-ai']);
  assert.equal(result.results[0].url,'https://publisher.test/stories/new-ai');
  const context=formatWebSearchContext('AI 뉴스',result.results);
  const selected=selectGeminiContextSections({prompt:'요약해줘',webSearchContext:context}).groundingText;
  for(const text of ['새 AI 모델 공개','2026-10-14T09:00:00Z','확인된 개별 기사 본문','https://publisher.test/stories/new-ai']) assert.ok(selected.includes(text));
  assert.doesNotMatch(selected,/URL: https:\/\/publisher.test\/newsroom/);
});

test('a single more specific search can replace successful portal-only hits with dated articles',async()=>{
  let searches=0;
  const result=await collectNewsEvidence('최신 AI 뉴스',{
    status:'success',attempts:[{httpStatus:200,count:10}],
    results:Array.from({length:10},(_,i)=>({url:`https://portal.test/list-${i}`})),
  },{now,search:async(query)=>{
    searches++;
    assert.match(query,/2026-10-15 article/);
    return {status:'success',results:[{url:'https://publisher.test/story-a'},{url:'https://publisher.test/story-b'}]};
  },readPage:async(url)=>url.includes('portal')?{url,text:'뉴스룸 목록'}:article(url)});
  assert.equal(searches,1);
  assert.equal(result.newsVerification.pageReads,5);
  assert.equal(result.results.length,2);
});

test('undated, stale, future, unrelated, category pages and unreadable bodies cannot establish news evidence',async()=>{
  const pages=[
    article('https://source.test/undated',{publishedAt:'',publicationEvidence:''}),
    article('https://source.test/stale',{publishedAt:'2025-01-01'}),
    article('https://source.test/future',{publishedAt:'2030-01-01'}),
    article('https://source.test/unrelated',{title:'스포츠',articleTitle:'경기 결과',text:'스포츠 경기 '.repeat(50)}),
    article('https://source.test/tag/ai'),
    article('https://source.test/short',{text:'본문 없음'}),
  ];
  let searches=0;
  const result=await collectNewsEvidence('최신 AI 뉴스',{
    status:'success',results:pages.slice(0,3),
  },{now,search:async()=>{searches++;return {status:'success',results:pages.slice(3)};},readPage:async(url)=>pages.find(p=>p.url===url)});
  assert.equal(searches,1);
  assert.equal(result.newsVerification.pageReads,6);
  assert.equal(result.status,'no-verified-articles');
  assert.equal(result.failed,false);
  assert.deepEqual(result.results,[]);
  const decision=resolveChatEvidence({requiresExternal:true,hasLocalAnswer:false},{webSearchData:result,wikiSearchData:{results:[{title:'AI 뉴스'}]}});
  assert.equal(decision.hasEvidence,false);
  assert.match(decision.unavailable,/검색 결과는 얻었지만/);
  assert.doesNotMatch(decision.unavailable,/검색 기능.*없|연결 실패/);
});

test('failed search transport stays distinguishable from inadequate successful results',async()=>{
  const result=await collectNewsEvidence('AI 뉴스',{status:'blocked',failed:true,results:[]},
    {now,search:async()=>({status:'blocked',failed:true,results:[]})});
  assert.equal(result.status,'blocked');
  assert.equal(result.failed,true);
});

test('news fetch keeps existing private address and redirect protection',async()=>{
  let calls=0;
  const result=await collectNewsEvidence('AI 뉴스',{status:'success',results:[{url:'https://public.test/story'}]},
    {now,search:async()=>({status:'empty',results:[]}),readPage:(url,options)=>fetchWebPageText(url,{
      ...options,resolveHostnames:async(host)=>host==='public.test'?['93.184.216.34']:['127.0.0.1'],
      fetchImpl:async()=>{calls++;return new Response('',{status:302,headers:{location:'http://private.test/story'}});},
    })});
  assert.equal(calls,1);
  assert.deepEqual(result.results,[]);
});


test('actual news final output retains one article date, title, summary, URL and scope', async () => {
  const { runtime } = await import('../scripts/lib/chat-verification-runtime.js');
  const verified = {status:'success',results:[{title:'새 AI 모델 공개',publishedAt:'2026-10-14T09:00:00Z',pageText:'새 AI 모델이 공개됐다. 개발사는 해당 모델의 언어 처리 기능과 제공 범위를 소개했다. 공개 시점의 지원 항목은 기사에 설명한 범위에 한정된다.',url:'https://publisher.test/stories/new-ai'}], newsVerification:{articles:1,freshnessDays:14},context:'기사 근거'};
  const r = runtime({search:verified,localAnswer:'',plan:{mode:'search',query:'AI 뉴스',purpose:'최신 기사 요약',externalPrompt:'AI 뉴스 요약'}});
  r.context.generateGeminiAnswer = async (_prompt, options) => {
    if (options.planSearch) return {answer:'',sourcePlan:{mode:'search',query:'AI 뉴스',purpose:'최신 기사 요약',externalPrompt:'AI 뉴스 요약'}};
    if(options.localOnly) return {answer:''};
    if(options.evidenceReview) return {evidenceReviews:[{id:0,relevant:true,quote:verified.results[0].pageText}]};
    assert.match(options.webSearchContext,/2026-10-14T09:00:00Z/);
    return {answer:'새 모델 공개 내용을 설명한 기사다냥.',citationsValid:true};
  };
  await r.context.handleGeminiFallbackMessage({content:'%최신 AI 뉴스 검색해서 요약해줘',author:{id:'test',username:'test'},guildId:'g',channelId:'c',client:{user:{username:'깐냥'}},attachments:new Map(),channel:{send:async()=>{}}});
  assert.equal(r.sent.length,1);
  for (const value of ['1건뿐','최근 14일','새 AI 모델 공개','게시일: 2026-10-14T09:00:00Z','요약: 새 모델 공개','https://publisher.test/stories/new-ai']) assert.ok(r.sent[0].includes(value),value);
  const fallback = await answerVerifiedNews(verified, async()=>({answer:'지원되지 않는 주장',citationsValid:false}));
  assert.match(fallback,/요약 검증에 실패/);
  assert.doesNotMatch(fallback,/지원되지 않는 주장/);
});
