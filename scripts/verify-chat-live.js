// Runs the real chat handler and generation/search functions with a local
// transport and isolated in-memory history. Never logs in to Discord or writes
// production memories. Only these public diagnostic fixtures may be traced.
import 'dotenv/config';
import vm from 'node:vm';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const codeHash = createHash('sha256');
for (const name of [...fs.readdirSync('src', { recursive: true }).filter((p) => p.endsWith('.js')).map((p) => `src/${p}`), 'scripts/verify-chat-live.js', 'scripts/lib/chat-verification-runtime.js'].sort()) codeHash.update(name).update('\0').update(fs.readFileSync(name));
const worktreeIdentity = { codeSha256: codeHash.digest('hex'), head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) };

import { createVerificationBudget, classifyVerificationError } from './lib/chat-verification-budget.js';
import { runtime, declaration, source } from './lib/chat-verification-runtime.js';

// Bound the whole run, including all configured key/model fallbacks and imported
// search/page fetches. Do not print request URLs, headers, keys, or error bodies.
const regressionQuestions = ['gpt 6 sol vs gpt 6.1 sol', 'llamafile vs llama.cpp',
  'llama.cpp vs llama-cpp-python', 'Aster Quill 97 sol vs Aster Quill 97 luna',
  'llamafile sol vs llamafile luna'];
// The default shared-session run covers all four reported questions.
// Unknown names in additional probes are never assertions of nonexistence.
const questions = process.argv.includes('--flight-time-only') ? ['naia to pus flight time']
  : process.argv.includes('--model-comparison-only') ? [regressionQuestions[0]]
  : process.argv.includes('--product-comparisons') ? regressionQuestions
  : ['너 누구고 오늘 부산 날씨는 어때?', '최신 AI 뉴스 검색해서 요약해줘', '푝무위키 파이호크 나이', 'gpt 6 sol vs gpt 6.1 sol'];

const limits = { modelRequests: 20, httpRequests: 36, durationMs: 180_000 };
const questionLimits = { modelRequests: process.argv.includes('--flight-time-only') ? 6 : 5, httpRequests: Math.floor(limits.httpRequests / questions.length), durationMs: process.argv.includes('--flight-time-only') ? 90_000 : 40_000 };
const budget = createVerificationBudget(limits, questionLimits);
const counts = budget.counts;
let questionErrors = [];
const secrets = Object.entries(process.env)
  .filter(([name, value]) => /key|token|secret|password|credential/i.test(name) && value.length >= 4)
  .flatMap(([, value]) => [value, ...value.split(',').map((item) => item.trim())])
  .filter((value) => value.length >= 4)
  .flatMap((value) => [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value)])
  .sort((a, b) => b.length - a.length);
const output = console.log.bind(console);
function report(value) {
  let serialized = JSON.stringify(value, null, 2);
  for (const secret of secrets) serialized = serialized.split(secret).join('[REDACTED]');
  output(serialized);
}
const deadline = setTimeout(() => {
  report({ status: 'failed', reason: 'verification-deadline', category: 'time-limit', code: 'VERIFY_TOTAL_TIME_LIMIT', limits, counts });
  process.exit(1);
}, limits.durationMs);
deadline.unref();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const modelRequest = url.origin === 'https://generativelanguage.googleapis.com';
  budget.consume(modelRequest);
  try {
    const signals = [budget.signal, options?.signal].filter(Boolean);
    const response = await originalFetch(input, { ...options, signal: AbortSignal.any(signals) });
    if (!response.ok) trace.push({ event: 'http-error', service: modelRequest ? 'model' : 'retrieval', category: 'api', status: response.status });
    return response;
  } catch (error) {
    trace.push({ event: 'http-error', service: modelRequest ? 'model' : 'retrieval', ...classifyVerificationError(budget.signal.aborted ? budget.signal.reason : error) });
    throw error;
  }
};

const exports = {};
for (const name of ['chat-clock', 'chat-source-plan', 'chat-evidence', 'chat-search-policy', 'gemini-chat-request', 'gemini-context', 'gemini-answer', 'gemini-memory', 'gemini-permanent-memory', 'gemini-prompt-guard', 'gemini-style-guidance', 'kannyang-speech', 'discord-markdown', 'web-search', 'web-page-content', 'news-evidence', 'evidence-review', 'web-evidence', 'pyhok-wiki-search']) {
  Object.assign(exports, await import(`../src/${name}.js`));
}
const collectEvidence = exports.collectWebBodyEvidence;
exports.collectWebBodyEvidence = (query, initial, generate, options = {}) => collectEvidence(query, initial, generate, {
  ...options, getRemainingBudget: () => budget.remaining(),
});
const r = runtime();
const trace = [];
const quietConsole = Object.fromEntries(['log', 'warn', 'error'].map((level) => [level, (message) => trace.push({event:'diagnostic', message:String(message)})]));
// Imported search functions use the host console, while entry functions use VM
// console. Capture both so every diagnostic passes through the same redactor.
Object.assign(console, quietConsole);
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
  report({worktreeIdentity,status:'unverified',reason:'No configured model API keys in this runtime',questions,questionLimits,limits,counts});
  process.exitCode = 2;
} else {
  r.context.getGeminiSessionHistory = () => [...r.stored];
  const resolve = r.context.resolveChatSourcePlan;
  r.context.resolveChatSourcePlan = (...args) => {
    const result = resolve(...args);
    trace.push({event:'source-plan',...result});
    return result;
  };
  const decide = r.context.resolveChatEvidence;
  r.context.resolveChatEvidence = (...args) => { const result = decide(...args); trace.push({ event: 'evidence-decision', result }); return result; };
  const complete = r.context.answerChatBySource;
  r.context.answerChatBySource = async (...args) => { const result = await complete(...args); trace.push({ event: 'answer-verification', result: result.answerVerification || { status: 'not-applicable' } }); return result; };
  const select = r.context.selectGeminiContextSections;
  r.context.selectGeminiContextSections = (options) => {
    const selected = select(options);
    trace.push({event:'model-input',grounding:selected.groundingText,stages:selected.groundingStages,stats:selected.stats});
    return selected;
  };
  const request = r.context.requestGeminiGenerateContent;
  r.context.requestGeminiGenerateContent = async (model, payload, key) => {
    // Public fixed fixtures only. This is the actual payload handed to the API
    // request function, not a separately reconstructed diagnostic context.
    trace.push({event:'api-payload',model,responseSchema:payload.generationConfig?.responseSchema,contents:payload.contents});
    try {
      const result = await request(model, payload, key);
      trace.push({event:'model-response',model,responseModel:result.modelVersion,raw:r.context.extractGeminiResponseText(result)});
      return result;
    } catch (error) {
      trace.push({event:'model-error',model,...classifyVerificationError(error)});
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
  const validator = r.context.validateChatCitationsWithStatus;
  r.context.validateChatCitationsWithStatus = (answer, evidence) => {
    const result = validator(answer, evidence);
    trace.push({event:'citation-validation',answer,result:result.answer,accepted:result.valid});
    return result;
  };
  const generate = r.context.generateGeminiAnswer;
  r.context.generateGeminiAnswer = async (...args) => {
    try { return await generate(...args); }
    catch (error) {
      const failure = { stage: args[1]?.evidenceReview ? 'evidence-review' : args[1]?.planSearch ? 'planning' : 'answer', ...classifyVerificationError(error) };
      questionErrors.push(failure);
      trace.push({ event: 'generation-failed', ...failure });
      throw error;
    }
  };
  const answerNews = r.context.answerVerifiedNews;
  r.context.answerVerifiedNews = (data, generate, options) => answerNews(data, generate, {
    ...options, onVerificationFailure: (failure) => {
      questionErrors.push({ stage: 'news-summary', ...failure });
      trace.push({ event: 'summary-verification-failed', ...failure });
    },
  });
  for (const question of questions) {
    trace.length = 0;
    r.sent.length = 0;
    questionErrors = [];
    budget.begin();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { try { budget.expire(); } catch (error) { reject(error); } }, questionLimits.durationMs);
    });
    try {
      await Promise.race([timeout, r.context.handleGeminiFallbackMessage({content:`%${question}`,author:{id:'verification',username:'Verification'},guildId:'verification',channelId:'verification',client:{user:{username:'깐냥'}},attachments:new Map(),channel:{send:async()=>{}}})]);
      const failed = budget.failures.length > 0 || questionErrors.length > 0 || r.sent.length === 0
        || trace.some((event) => event.result?.failed || ['review-failed', 'retrieval-failed'].includes(event.result?.status));
      if (failed) process.exitCode = 1;
      report({worktreeIdentity,question,status:failed ? 'failed' : 'completed-needs-review',now:new Date().toISOString(),trace,final:r.sent,failures:[...budget.failures,...questionErrors],questionLimits,questionCounts:budget.questionCounts,limits,counts});
    } catch (error) {
      report({worktreeIdentity,question,status:'failed',error:classifyVerificationError(error),trace,questionLimits,questionCounts:budget.questionCounts,limits,counts});
      process.exitCode = 1;
    } finally { clearTimeout(timer); }
    // Cancellation must stop pending work before starting another question.
    // A timed-out task may still be unwinding, so end the process explicitly.
    if (budget.signal.aborted && budget.failures.some((f) => f.category === 'time-limit')) {
      for (const skipped of questions.slice(questions.indexOf(question) + 1)) report({question:skipped,status:'not-run',reason:'previous-question-timeout-cancelled-run'});
      process.exit(1);
    }
  }
}
clearTimeout(deadline);
globalThis.fetch = originalFetch;
