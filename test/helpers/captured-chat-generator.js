import assert from 'node:assert/strict';
import vm from 'node:vm';
import { declaration } from '../../scripts/lib/chat-verification-runtime.js';
import { parseGeminiAnswerPayload } from '../../src/gemini-answer.js';
import { getChatClock } from '../../src/chat-clock.js';
import { selectGeminiContextSections } from '../../src/gemini-context.js';
import { validateChatCitationsWithStatus } from '../../src/chat-evidence.js';
import { chatSourcePlanGuidance } from '../../src/chat-source-plan.js';
export function generator(raws) {
  const identity = (s) => s;
  const payloads = [];
  const context = vm.createContext({
    Date, getChatClock, selectGeminiContextSections, parseGeminiAnswerPayload, chatSourcePlanGuidance, validateChatCitationsWithStatus,
    geminiMemoryMaxContextLength:18000, percentCommandAliases:{chat:['대화']},geminiVisionModels:['vision'],geminiModels:['replay'],
    supportedGeminiEmotionLabels:['neutral'],geminiSystemInstruction:'공개 설정: CODEX가 만든 챗봇 깐냥.',geminiMaxOutputTokens:4096,
    logGeminiTiming:()=>{},formatGeminiErrorStatus:(e)=>e.code,createGeminiChatContents:(text)=>[{role:'user',parts:[{text}]}],
    fetchGeminiGenerateContent:async(payload)=>{payloads.push(payload);assert.ok(raws.length,'No unrecorded model response may be fabricated');return {text:raws.shift()};},
    extractGeminiResponseText:(r)=>r.text,classifyPromptControlResponse:()=>({blocked:false}),extractPermanentMemoryUsage:(text)=>({cleanText:text,usedIds:[]}),
    transformKannyangProse:(s,fn)=>fn(s),applyCustomEmojiAliases:identity,normalizeDiscordMarkdown:identity,normalizeKannyangSpeech:identity,sanitizeGeminiAnswer:identity,inferPermanentMemoryUsage:()=>[],
  });
  vm.runInContext(declaration('generateGeminiAnswer'),context);
  return {generate:context.generateGeminiAnswer,payloads};
}
