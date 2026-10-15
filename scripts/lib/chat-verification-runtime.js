import { resolveChatSourcePlan } from '../../src/chat-source-plan.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { resolveChatEvidence, answerChatBySource } from '../../src/chat-search-policy.js';
import { buildVerifiedWebAgeReply } from '../../src/chat-evidence.js';
import { answerClockQuestion } from '../../src/chat-clock.js';
import { createGeminiInteractionMessage } from '../../src/gemini-interaction.js';
import { classifyWebSearchIntent, shouldUseWebSearch, deriveWebSearchQuery, shouldIncludeWebSearchSources } from '../../src/web-search.js';
import { isExplicitPyhokWikiPrompt, isPyhokWikiLinkRequest, wikiSearchUnavailableReply, answerWikiAgeQuestion, parsePyhokWikiSearchResponse } from '../../src/pyhok-wiki-search.js';
import { isLikelyContextDependentPrompt } from '../../src/gemini-followup.js';
import { analyzePromptSecurity } from '../../src/prompt-security.js';
import { classifyPromptControlAttempt } from '../../src/gemini-prompt-guard.js';

// Execute actual entry functions without logging in to Discord or loading data files.
export const source = fs.readFileSync(new URL('../../src/index.js', import.meta.url), 'utf8');
export function declaration(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const rest = source.slice(start);
  const end = rest.slice(1).search(/\n(?:async )?function /);
  return end < 0 ? rest : rest.slice(0, end + 1);
}
export function runtime({ images = [], history = [], wiki = null, search = null, reply = null, plan = {mode:'local'}, localAnswer = '자체 문맥으로 답했다냥.', page = {context:'',pages:[]} } = {}) {
  const sent=[], queries=[], generated=[], stored=[];
  const context = vm.createContext({
    classifyWebSearchIntent, resolveChatSourcePlan, resolveChatEvidence, answerChatBySource, buildVerifiedWebAgeReply,
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
    tryBuildWebSearchData:async(q,opts)=>{if(opts.force||shouldUseWebSearch(q)){queries.push(q);if(search?.status==='throws') throw new Error('search offline');return search ?? {query:q,status:'success',results:[{title:q,url:'https://source.test'}],context:'URL: https://source.test'};}return null;},
    tryBuildPyhokWikiSearchData:async()=>wiki,
    finalizeGeminiSearchReferenceData:(data)=>data,
    buildWebPageReferenceContext:async()=>page,
    shouldRequireStockfishForChessPrompt:()=>false,
    generateGeminiAnswer:async(q,opts)=>{generated.push({q,opts});return {sourcePlan:plan,answer:opts.planSearch?localAnswer:'확인한 내용이다냥. https://source.test',emotion:'neutral',usedPermanentMemoryIds:[]};},
    sendGeminiChatUsageLog:async()=>{},getGeminiEmotionReplyFiles:()=>[],formatPermanentMemoryAttribution:()=>'',
    chunkDiscordMessage:(text)=>[text],getGeminiUserErrorMessage:(e)=>{throw e;},
  });
  for (const name of ['parseGeminiFallbackPrompt','getImmediatePreviousWebSearchQuery','sendChatFactReply','handleGeminiFallbackMessage','createWebSearchResponse']) vm.runInContext(declaration(name),context);
  return {context,sent,queries,generated,stored};
}
