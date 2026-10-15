import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { answerClockQuestion } from '../src/chat-clock.js';
import { createGeminiInteractionMessage } from '../src/gemini-interaction.js';
import { shouldUseWebSearch, deriveWebSearchQuery, shouldIncludeWebSearchSources } from '../src/web-search.js';
import { isExplicitPyhokWikiPrompt, isPyhokWikiLinkRequest, wikiSearchUnavailableReply, answerWikiAgeQuestion, parsePyhokWikiSearchResponse } from '../src/pyhok-wiki-search.js';
import { isLikelyContextDependentPrompt } from '../src/gemini-followup.js';
import { analyzePromptSecurity } from '../src/prompt-security.js';
import { classifyPromptControlAttempt } from '../src/gemini-prompt-guard.js';

// Execute actual entry functions without logging in to Discord or loading data files.
const source = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
function declaration(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const rest = source.slice(start);
  const end = rest.slice(1).search(/\n(?:async )?function /);
  return end < 0 ? rest : rest.slice(0, end + 1);
}
function runtime({ images = [], history = [], wiki = null, search = null, reply = null } = {}) {
  const sent=[], queries=[], generated=[], stored=[];
  const context = vm.createContext({
    answerClockQuestion, shouldUseWebSearch, deriveWebSearchQuery, shouldIncludeWebSearchSources,
    isExplicitPyhokWikiPrompt, isPyhokWikiLinkRequest, wikiSearchUnavailableReply, answerWikiAgeQuestion,
    isLikelyContextDependentPrompt, analyzePromptSecurity, classifyPromptControlAttempt,
    Date, console, parseChessImageAnalysisPrompt:()=>null,
    collectEmojiOnlyTextDetails:()=>({matchedTextCount:0}),
    getCanonicalPercentCommand:()=>null,
    ensureGeminiMemoryLoaded:async()=>{}, getGeminiSessionKey:()=> 'g:c',
    getMessageAuthorName:(m)=>m.author.username,
    appendGeminiMemoryEntry:(_key,e)=>stored.push(e), saveGeminiMemory:async()=>{},
    sendReplyOrChannelMessage:async(_m,p)=>sent.push(p.content),
    normalizeDiscordTextForGemini:(_m,p)=>p,
    getGeminiMentionContext:()=>'',getGeminiCurrentUserContext:()=> 'bob',
    extractHexColorPreviewRequest:()=>null,isUnsupportedEmojiPrompt:()=>false,
    safeSendTyping:async()=>{},geminiApiKeys:['mock-key'],
    geminiPermanentMemory:{ensureLoaded:async()=>{},search:async()=>[]},
    getGeminiSessionHistory:()=>history,resolveReferencedMessageChain:async()=>[],
    getGeminiReplyContext:async()=>reply,createPermanentMemoryScope:()=> 'g',
    getGeminiImageParts:async()=>images,shouldUseReplyImagesForGeminiPrompt:()=>true,
    getChessImageAnalysisContext:async()=>({context:'',detectedChessboard:false}),
    looksLikeChessTopicPrompt:()=>false,shouldForceWebSearchForChessPrompt:()=>false,
    tryBuildWebSearchData:async(q,opts)=>{if(opts.force||shouldUseWebSearch(q)){queries.push(q);return search ?? {query:q,status:'success',results:[{title:q,url:'https://source.test'}],context:'URL: https://source.test'};}return null;},
    tryBuildPyhokWikiSearchData:async()=>wiki,
    finalizeGeminiSearchReferenceData:(data)=>data,
    buildWebPageReferenceContext:async()=>({context:'',pages:[]}),
    shouldRequireStockfishForChessPrompt:()=>false,
    generateGeminiAnswer:async(q,opts)=>{generated.push({q,opts});return {answer:'확인한 내용이다냥. https://source.test',emotion:'neutral',usedPermanentMemoryIds:[]};},
    sendGeminiChatUsageLog:async()=>{},getGeminiEmotionReplyFiles:()=>[],formatPermanentMemoryAttribution:()=>'',
    chunkDiscordMessage:(text)=>[text],getGeminiUserErrorMessage:(e)=>{throw e;},
  });
  for (const name of ['parseGeminiFallbackPrompt','getImmediatePreviousWebSearchQuery','sendChatFactReply','handleGeminiFallbackMessage','createWebSearchResponse']) vm.runInContext(declaration(name),context);
  return {context,sent,queries,generated,stored};
}
const now = new Date('2026-10-14T15:00:00Z');
const message=(content)=>({content,author:{id:'bob',username:'Bob'},guildId:'g',channelId:'c',client:{user:{username:'깐냥'}},attachments:new Map(),channel:{send:async()=>{}}});

test('%대화, %질문 and /말걸기 use the same deterministic day and preserve authors', async()=>{
  for (const content of ['%대화 오늘날짜','%질문 오늘 날짜','%오늘 날짜 검색해서 알아와']) {
    const r=runtime();
    await r.context.handleGeminiFallbackMessage(message(content),{now});
    assert.match(r.sent[0],/2026-10-15/);
    assert.equal(r.generated.length,0);assert.equal(r.queries.length,0);
    assert.equal(r.stored[0].authorId,'bob');
  }
  const r=runtime();
  const interaction={user:{id:'bob',username:'Bob'},guildId:'g',channelId:'c',channel:{},options:{},editReply:async()=>{}};
  await r.context.handleGeminiFallbackMessage(createGeminiInteractionMessage(interaction,'오늘날짜'),{now});
  assert.match(r.sent[0],/2026-10-15/);
  const searched = await r.context.createWebSearchResponse('오늘 날짜 검색해서 알아와',{now});
  assert.match(searched.text,/2026-10-15/);assert.equal(r.queries.length,0);
});

test('image + factual request searches before generation; casual chat and translation do not',async()=>{
  for (const q of ['제품 최신 가격 검색해줘','안녕','이 문장 번역해줘']) {
    const image={inline_data:{mime_type:'image/png',data:'mock'}};
    const r=runtime({images:[image]});
    await r.context.handleGeminiFallbackMessage(message(`%${q}`),{now});
    assert.equal(r.queries.length,q.includes('검색')?1:0);
    assert.equal(r.generated.length,1);
    assert.equal(r.generated[0].opts.imageParts[0],image);
  }
});

test('new short topics and reply targets do not inherit unrelated previous web query',async()=>{
  const history=[{role:'user',text:'[웹 검색 요청]\n실제 검색 query: 삼성전자 주가'},{role:'model',text:'[웹 검색 답변]\n예전 검색'}];
  for (const [q,reply] of [['안녕',null],['환율',null],['그 사람 검색해줘',{authorId:'alice',text:'다른 대화 대상'}]]) {
    const r=runtime({history,reply});
    await r.context.handleGeminiFallbackMessage(message(`%${q}`),{now});
    assert.ok(r.queries.every((query)=>!query.includes('삼성전자')),q);
  }
});

test('%검색 wiki failures and empty results never fall through to public web or model memory',async()=>{
  for (const wiki of [{status:'unauthorized',failed:true,results:[],context:''},{status:'empty',results:[],context:''}]) {
    const r=runtime({wiki});
    const response=await r.context.createWebSearchResponse('푝무위키 파이호크 나이',{now});
    assert.equal(r.queries.length,0);assert.equal(r.generated.length,0);
    assert.match(response.text,wiki.failed?/인증 실패/:/찾지 못/);
  }
});

test('failed or unrelated ordinary search does not ask the model to invent an answer',async()=>{
  for (const status of ['failed','irrelevant']) {
    const r=runtime({search:{status,failed:status==='failed',results:[],context:'자료 없음'}});
    await r.context.handleGeminiFallbackMessage(message('%node 최신 버전'),{now});
    assert.equal(r.generated.length,0);assert.match(r.sent[0],/확인하지 못/);
  }
});

test('ordinary percent wiki age route uses exact document evidence and stores the answer without a model call', async () => {
  const prompt = '푝무위키 파이호크 나이';
  const results = parsePyhokWikiSearchResponse({ hits: [{ title: '파이호크', content: '생년월일: 2000-10-15', anyoneReadable: true }] }, { query: '파이호크', originalQuery: prompt });
  const r = runtime({ wiki: { status: 'success', results, context: '검증용 가상 생일' } });
  await r.context.handleGeminiFallbackMessage(message(`%${prompt}`), { now });
  assert.match(r.sent[0], /만 26세/);
  assert.match(r.sent[0], /https:\/\/pyhok.com/);
  assert.equal(r.queries.length, 0);
  assert.equal(r.generated.length, 0);
  assert.equal(r.stored.length, 2);
  assert.equal(r.stored[1].text, r.sent[0]);
});
