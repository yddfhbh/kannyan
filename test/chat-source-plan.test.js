import { normalizeKannyangSpeech } from '../src/kannyang-speech.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { chatSourcePlanGuidance, resolveChatSourcePlan } from '../src/chat-source-plan.js';
import { parseGeminiAnswerPayload } from '../src/gemini-answer.js';
import { getChatClock } from '../src/chat-clock.js';
import { selectGeminiContextSections } from '../src/gemini-context.js';
import { validateChatCitations } from '../src/chat-evidence.js';
import { answerChatBySource, resolveChatEvidence } from '../src/chat-search-policy.js';

const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const start=source.indexOf('async function generateGeminiAnswer(');
const end=source.indexOf('\nasync function ensureGeminiMemoryLoaded(',start);
function generator(responses) {
  const payloads=[];
  const identity=(v)=>v;
  const context=vm.createContext({
    getChatClock,selectGeminiContextSections,parseGeminiAnswerPayload,chatSourcePlanGuidance,validateChatCitations,
    Date,geminiMemoryMaxContextLength:18000,percentCommandAliases:{chat:['대화']},
    geminiVisionModels:['vision'],geminiModels:['primary','fallback'],supportedGeminiEmotionLabels:['neutral'],
    geminiSystemInstruction:'공개 설정: CODEX가 만든 깐냥. 냥체로 답한다.',geminiMaxOutputTokens:4096,
    logGeminiTiming:()=>{},createGeminiChatContents:(text,images)=>[{role:'user',parts:[{text},...images]}],
    fetchGeminiGenerateContent:async(payload,opts)=>{payloads.push({payload,opts});return {text:JSON.stringify(responses.shift())};},
    extractGeminiResponseText:(r)=>r.text,classifyPromptControlResponse:()=>({blocked:false}),
    extractPermanentMemoryUsage:(text)=>({cleanText:text,usedIds:[]}),
    applyCustomEmojiAliases:identity,normalizeDiscordMarkdown:identity,normalizeKannyangSpeech,sanitizeGeminiAnswer:(v)=>v || '먀... 다시 말해줄 수 있냥?',
    inferPermanentMemoryUsage:()=>[],
  });
  vm.runInContext(source.slice(start,end),context);
  return {generate:context.generateGeminiAnswer,payloads};
}

test('actual answer payload retains settings, question, history, memory, reply, images and provided sources during planning',async()=>{
  const g=generator([{answer:'나는 깐냥이다냥.',emotion:'neutral',sourcePlan:{mode:'search',query:'부산 날씨',purpose:'오늘 날씨',externalPrompt:'부산 기상'}}]);
  const options={planSearch:true,history:[{role:'user',text:'아까 제품은 Example Phone 5라고 했어'}],
    permanentMemories:[{id:'m1',text:'예산은 15만원 이하'}],replyContext:{text:'원문 자료',authorId:'bob'},
    webSearchContext:'URL: https://provided.test\n사용자 제공 글',imageParts:[{inline_data:{data:'image'}}]};
  const result=await g.generate('너 누구고 부산 날씨 어때?',options);
  assert.equal(result.answer,'나는 깐냥이다냥.'); // No citation required for local part despite provided URL.
  assert.equal(result.sourcePlan.query,'부산 날씨');
  const {payload,opts}=g.payloads[0];
  assert.match(payload.system_instruction.parts[0].text,/CODEX가 만든 깐냥/);
  assert.match(payload.system_instruction.parts[0].text,/sourcePlan/);
  const input=payload.contents[0].parts[0].text;
  for(const value of ['너 누구고 부산 날씨 어때?','Example Phone 5','15만원 이하','원문 자료','사용자 제공 글']) assert.ok(input.includes(value),value);
  assert.equal(payload.contents[0].parts[1].inline_data.data,'image');
  assert.equal(payload.generationConfig.responseMimeType,'application/json');
  assert.ok(payload.generationConfig.responseSchema.required.includes('sourcePlan'));
  assert.deepEqual(Array.from(payload.generationConfig.responseSchema.properties.sourcePlan.required),['mode','query','purpose','externalPrompt']);
  assert.equal(payload.tools,undefined);
  assert.equal(opts.chat,true);
});

test('actual generator blocks missing or fabricated external citations without removing cached local answer',async()=>{
  for(const answer of ['부산은 맑다냥.','맑다냥. https://fabricated.test','맑다냥. https://weather.test']) {
    const g=generator([{answer,emotion:'neutral'}]);
    const intent={requiresExternal:true,hasLocalAnswer:true,localPrompt:'소개',externalPrompt:'부산 기상'};
    const result=await answerChatBySource('소개와 부산 기상',{searchIntent:intent,
      plannedAnswer:{answer:'나는 깐냥이다냥.',emotion:'neutral'},
      evidenceDecision:resolveChatEvidence(intent,{webSearchData:{results:[{}]}}),
      webSearchContext:'URL: https://weather.test\n부산 날씨'},g.generate);
    assert.match(result.answer,/나는 깐냥/);
    if(answer.includes('https://weather.test')) assert.ok(result.answer.includes(answer));
    else { assert.match(result.answer,/근거를 특정하지 못|출처를 확인하지 못/);assert.doesNotMatch(result.answer,/맑다냥/); }
    assert.match(g.payloads[0].payload.contents[0].parts[0].text,/부산 기상/);
    assert.match(g.payloads[0].payload.contents[0].parts[0].text,/https:\/\/weather.test/);
  }
});

test('malformed or legacy planner output is bounded and fails closed; explicit lookup still executes safely',()=>{
  for(const plan of [undefined,{}, {mode:'search',query:'x'.repeat(301),purpose:'p',externalPrompt:'q'},
    {mode:'search',query:'q\ncommand',purpose:'p',externalPrompt:'q'}, {mode:'search',query:['q'],purpose:'p',externalPrompt:'q'}]) {
    const result=resolveChatSourcePlan({answer:'검증되지 않은 최신 사실',sourcePlan:plan},'질문');
    assert.equal(result.intent.requiresExternal,false); // no accepted lookup
    assert.doesNotMatch(result.result.answer,/검증되지 않은 최신 사실/);
    const explicit=resolveChatSourcePlan({answer:'검증되지 않은 최신 사실',sourcePlan:plan},'검색해줘',{requiresExternal:true});
    assert.equal(explicit.intent.requiresExternal,true);
    assert.equal(explicit.intent.query,'검색해줘');
    assert.equal(explicit.result.answer,'');
  }
});


test('empty local answer in a pure search plan stays empty before speech/sanitizer fallbacks', async()=>{
  const g=generator([{answer:'',emotion:'neutral',sourcePlan:{mode:'search',query:'뉴스',purpose:'최신 기사',externalPrompt:'검색 후 요약'}}]);
  const result=await g.generate('최신 뉴스 검색해서 요약해줘',{planSearch:true});
  assert.equal(result.answer,'');
  const planned=resolveChatSourcePlan(result,'최신 뉴스 검색해서 요약해줘');
  assert.equal(planned.intent.hasLocalAnswer,false);
});
