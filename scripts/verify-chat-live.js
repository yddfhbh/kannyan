// Runs the real chat handler and generation/search functions with a local
// transport and isolated in-memory history. Never logs in to Discord or writes
// production memories. Only these public diagnostic fixtures may be traced.
import 'dotenv/config';
import vm from 'node:vm';
import { runtime, declaration, source } from './lib/chat-verification-runtime.js';

const questions = ['너 누구고 오늘 부산 날씨는 어때?', '최신 AI 뉴스 검색해서 요약해줘', '푝무위키 파이호크 나이'];
const exports = {};
for (const name of ['chat-clock', 'chat-source-plan', 'chat-evidence', 'chat-search-policy', 'gemini-chat-request', 'gemini-context', 'gemini-answer', 'gemini-memory', 'gemini-permanent-memory', 'gemini-prompt-guard', 'gemini-style-guidance', 'kannyang-speech', 'discord-markdown', 'web-search', 'web-page-content', 'pyhok-wiki-search']) {
  Object.assign(exports, await import(`../src/${name}.js`));
}
const r = runtime();
const trace = [];
const quietConsole = Object.fromEntries(['log', 'warn', 'error'].map((level) => [level, (message) => trace.push({event:'diagnostic', message:String(message)})]));
Object.assign(r.context, exports, {
  process, fetch, AbortController, setTimeout, clearTimeout, console: quietConsole,
  logGeminiTiming: () => {}, customEmojis: {},
});
const names = ['parseCommaSeparatedValues', 'getPreferredEnvValue', 'getEnvModelList', 'getUniqueValues',
  'generateGeminiAnswer', 'fetchGeminiGenerateContent', 'requestGeminiGenerateContent',
  'extractGeminiResponseText', 'sanitizeGeminiAnswer', 'stripLeakedAnalysisLines', 'isLeakedAnalysisLine', 'extractQuotedFinalAnswer',
  'formatGeminiErrorStatus', 'wait', 'applyCustomEmojiAliases', 'formatKstTime',
  'tryBuildWebSearchData', 'tryBuildPyhokWikiSearchData', 'finalizeGeminiSearchReferenceData'];
for (const name of names) vm.runInContext(declaration(name), r.context);
// Evaluate the exact production defaults, rather than duplicating model lists.
for (const [start, end] of [
  ['const geminiApiKeys =', 'const port ='],
  ['const geminiApiBaseUrl =', 'const discordMessageChunkMaxLength ='],
  ['const geminiSystemInstruction =', 'const defaultRatingDeviation ='],
  ['const webSearchMaxResults =', 'const liveRatingTypes ='],
]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), r.context);
vm.runInContext(`const geminiMemoryMaxContextLength = Number(process.env.GEMINI_MEMORY_MAX_CONTEXT_LENGTH) || 32000;
const pyhokWikiSearchConfig = getPyhokWikiSearchConfig();`, r.context);
if (!vm.runInContext('geminiApiKeys.length', r.context)) {
  console.log(JSON.stringify({status:'unverified',reason:'No configured model API keys in this runtime',questions}, null, 2));
  process.exitCode = 2;
} else {
  r.context.getGeminiSessionHistory = () => [...r.stored];
  const resolve = r.context.resolveChatSourcePlan;
  r.context.resolveChatSourcePlan = (...args) => {
    const result = resolve(...args);
    trace.push({event:'source-plan',...result});
    return result;
  };
  const select = r.context.selectGeminiContextSections;
  r.context.selectGeminiContextSections = (options) => {
    const selected = select(options);
    trace.push({event:'model-input',grounding:selected.groundingText,stats:selected.stats});
    return selected;
  };
  const request = r.context.requestGeminiGenerateContent;
  r.context.requestGeminiGenerateContent = async (model, payload, key) => {
    try {
      const result = await request(model, payload, key);
      trace.push({event:'model-response',model,responseModel:result.modelVersion,raw:r.context.extractGeminiResponseText(result)});
      return result;
    } catch (error) {
      trace.push({event:'model-error',model,status:error.status ?? error.name});
      throw error;
    }
  };
  for (const name of ['tryBuildWebSearchData', 'tryBuildPyhokWikiSearchData']) {
    const operation = r.context[name];
    r.context[name] = async (query, options) => {
      const result = await operation(query, options);
      trace.push({event:name,query,result});
      return result;
    };
  }
  const validator = r.context.validateChatCitations;
  r.context.validateChatCitations = (answer, evidence) => {
    const result = validator(answer, evidence);
    trace.push({event:'citation-validation',answer,result,accepted:answer===result});
    return result;
  };
  for (const question of questions) {
    trace.length = 0;
    r.sent.length = 0;
    try {
      await r.context.handleGeminiFallbackMessage({content:`%${question}`,author:{id:'verification',username:'Verification'},guildId:'verification',channelId:'verification',client:{user:{username:'깐냥'}},attachments:new Map(),channel:{send:async()=>{}}});
      console.log(JSON.stringify({question,now:new Date().toISOString(),trace,final:r.sent}, null, 2));
    } catch (error) {
      console.log(JSON.stringify({question,status:'failed',statusCode:error.status ?? error.name,trace}, null, 2));
      process.exitCode = 1;
    }
  }
}
