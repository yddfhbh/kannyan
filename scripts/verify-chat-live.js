import { createVerificationSerializer } from './lib/chat-verification-redaction.js';
import { summarizeTimings, summarizeVerification } from './lib/chat-verification-report.js';
// Runs the real chat handler and generation/search functions with a local
// transport and isolated in-memory history. Never logs in to Discord or writes
// production memories. Only these public diagnostic fixtures may be traced.
import 'dotenv/config';
import vm from 'node:vm';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { createVerificationBudget, classifyVerificationError } from './lib/chat-verification-budget.js';
import { runtime, declaration, source } from './lib/chat-verification-runtime.js';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: DOTENV_CONFIG_PATH=/home/ubuntu/discord-bot-new/.env node scripts/verify-chat-live.js [option]');
  console.log('Options: --case <mixed|toefl-fact|toefl-search|self-answer|news|wiki|product-comparison|weather>');
  console.log('         --product-comparisons | --model-comparison-only | --flight-time-only');
  process.exit(0);
}

const codeHash = createHash('sha256');
for (const name of [...fs.readdirSync('src', { recursive: true }).filter((p) => p.endsWith('.js')).map((p) => `src/${p}`), 'scripts/verify-chat-live.js', ...fs.readdirSync('scripts/lib').filter((p) => p.startsWith('chat-verification-') && p.endsWith('.js')).map((p) => `scripts/lib/${p}`)].sort()) codeHash.update(name).update('\0').update(fs.readFileSync(name));
const worktreeIdentity = { codeSha256: codeHash.digest('hex'), head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) };

// Bound the whole run, including all configured key/model fallbacks and imported
// search/page fetches. Do not print request URLs, headers, keys, or error bodies.
const regressionQuestions = ['gpt 6 sol vs gpt 6.1 sol', 'llamafile vs llama.cpp',
  'llama.cpp vs llama-cpp-python', 'Aster Quill 97 sol vs Aster Quill 97 luna',
  'llamafile sol vs llamafile luna'];
// The default run covers mixed, explicit-search, ordinary external-fact, and
// self-answer cases, including the reported weather and comparison probes.
// Unknown names in additional probes are never assertions of nonexistence.
const defaultCases = [
  { id: 'mixed', question: '너 누구고 오늘 부산 날씨는 어때?', category: 'mixed' },
  { id: 'toefl-fact', question: '토플 응시료가 얼마야?', category: 'general-external-fact' },
  { id: 'toefl-search', question: '토플 응시료 검색해줘', category: 'explicit-search' },
  { id: 'self-answer', question: '너 누구고 기억하는 게 있어?', category: 'self-answer' },
  { id: 'news', question: '최신 AI 뉴스 검색해서 요약해줘', category: 'explicit-search' },
  { id: 'wiki', question: '푝무위키 파이호크 나이', category: 'general-external-fact' },
  { id: 'product-comparison', question: 'gpt 6 sol vs gpt 6.1 sol', category: 'general-external-fact' },
  { id: 'weather', question: '오늘 부산 날씨는 어때?', category: 'general-external-fact' },
];
const args = process.argv.slice(2);
const caseArgument = args.find((arg) => arg === '--case' || arg.startsWith('--case='));
const selectedCase = caseArgument === '--case' ? args[args.indexOf('--case') + 1] : caseArgument?.slice('--case='.length);
if (caseArgument && (!selectedCase || !defaultCases.some(({ id }) => id === selectedCase))) {
  console.error(`Unknown --case: ${selectedCase ?? '(missing value)'}`);
  process.exit(2);
}
const questions = selectedCase ? [defaultCases.find(({ id }) => id === selectedCase).question]
  : args.includes('--flight-time-only') ? ['naia to pus flight time']
  : args.includes('--model-comparison-only') ? [regressionQuestions[0]]
  : args.includes('--product-comparisons') ? regressionQuestions
  : defaultCases.map(({ question }) => question);
const questionCategory = (question) => defaultCases.find((entry) => entry.question === question)?.category
  ?? (question === 'naia to pus flight time' ? 'general-external-fact' : 'probe');

const limits = { modelRequests: 20, httpRequests: 36, durationMs: 180_000 };
// Multi-question runs divide the verifier pool explicitly; a selected case is
// handled above as a one-question run and is not divided by hidden fixtures.
const questionLimits = {
  // General: plan + two retrieval rounds + one repair/fallback + answer + final review + one retry.
  // News: plan + retrieval review + up to three summaries + final review + one retry.
  modelRequests: process.argv.includes('--flight-time-only') ? 6 : 7,
  // A selected --case is a one-question run and receives the whole verifier
  // HTTP budget; only multi-question runs divide it.
  httpRequests: Math.max(1, Math.floor(limits.httpRequests / questions.length)),
  durationMs: process.argv.includes('--flight-time-only') ? 90_000 : 40_000,
};
const budget = createVerificationBudget(limits, questionLimits);
const operationalLimits = { modelRequests: 'production-configured', httpRequests: 'production-configured', durationMs: 'production-configured' };
const counts = budget.counts;
let questionErrors = [];
const serialize = createVerificationSerializer(process.env);
const output = console.log.bind(console);
function report(value) { output(serialize(value)); }
const deadline = setTimeout(() => {
  report({ status: 'failed', reason: 'verification-deadline', category: 'time-limit', code: 'VERIFY_TOTAL_TIME_LIMIT', limits, verificationLimits: limits, operationalLimits, counts });
  process.exit(1);
}, limits.durationMs);
deadline.unref();
const originalFetch = globalThis.fetch;
let activeRequiredRequest = false;
let activeRequestStage = '';
let activeHttpStage = 'unclassified';
const trace = [];
globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const modelRequest = url.origin === 'https://generativelanguage.googleapis.com';
  const httpStarted = Date.now();
  const before = { ...budget.counts, remaining: budget.remaining() };
  budget.consume(modelRequest, { required: activeRequiredRequest });
  trace.push({ event: 'http-attempt', stage: modelRequest ? (activeRequestStage || 'model') : activeHttpStage, required: activeRequiredRequest, service: modelRequest ? 'model' : 'retrieval', before, after: { ...budget.counts, remaining: budget.remaining() } });
  try {
    const signals = [budget.signal, options?.signal].filter(Boolean);
    const response = await originalFetch(input, { ...options, signal: AbortSignal.any(signals) });
    trace.push({ event: 'http-response', stage: activeRequestStage || activeHttpStage, service: modelRequest ? 'model' : 'retrieval', status: response.status, durationMs: Date.now() - httpStarted });
    if (!response.ok) trace.push({ event: 'http-error', stage: activeRequestStage || activeHttpStage, service: modelRequest ? 'model' : 'retrieval', category: 'api', status: response.status, durationMs: Date.now() - httpStarted });
    return response;
  } catch (error) {
    trace.push({ event: 'http-error', stage: activeRequestStage || activeHttpStage, durationMs: Date.now() - httpStarted, service: modelRequest ? 'model' : 'retrieval', ...classifyVerificationError(budget.signal.aborted ? budget.signal.reason : error) });
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
  'formatGeminiErrorStatus', 'getGeminiUserErrorMessage', 'wait', 'applyCustomEmojiAliases', 'formatKstTime',
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
Object.assign(operationalLimits, vm.runInContext('({ models: geminiModels, requestTimeoutMs: geminiRequestTimeoutMs, maxAttemptsPerModel: geminiMaxAttemptsPerModel, maxOutputTokens: geminiMaxOutputTokens })', r.context));
if (!vm.runInContext('geminiApiKeys.length', r.context)) {
  report({worktreeIdentity,status:'unverified',reason:'No configured model API keys in this runtime',questions,questionLimits,limits,verificationLimits:limits,operationalLimits,counts});
  process.exitCode = 2;
} else {
  r.context.getGeminiSessionHistory = () => [...r.stored];
  const resolve = r.context.resolveChatSourcePlan;
  r.context.resolveChatSourcePlan = (...args) => {
    const started = Date.now();
    const result = resolve(...args);
    trace.push({event:'source-plan',durationMs:Date.now() - started,...result});
    return result;
  };
  const decide = r.context.resolveChatEvidence;
  r.context.resolveChatEvidence = (...args) => { const started = Date.now(); const result = decide(...args); trace.push({ event: 'evidence-decision', durationMs: Date.now() - started, result }); return result; };
  const complete = r.context.answerChatBySource;
  r.context.answerChatBySource = async (...args) => { const started = Date.now(); const result = await complete(...args); trace.push({ event: 'answer-verification', durationMs: Date.now() - started, result: result.answerVerification || { status: 'not-applicable' } }); return result; };
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
    const schema = payload.generationConfig?.responseSchema;
    const stage = schema?.properties?.sourcePlan ? 'planning' : payload[Symbol.for('chat.finalVerification')] ? 'final-verification' : schema?.properties?.evidenceReviews ? 'evidence-review' : 'answer';
    trace.push({event:'api-payload',stage,model,responseSchema:schema,inputChars:JSON.stringify(payload.contents).length,outputTokenLimit:payload.generationConfig.maxOutputTokens,stageTimeoutMs:r.context.chatStageTimeout(payload),contents:payload.contents});
    const started = Date.now();
    try {
      activeRequestStage = stage;
      activeRequiredRequest = budget.hasReservation(stage);
      budget.setStage(stage);
      const result = await request(model, payload, key);
      trace.push({event:'model-response',stage,startedAt:started,endedAt:Date.now(),durationMs:Date.now() - started,model,responseModel:result.modelVersion,raw:r.context.extractGeminiResponseText(result)});
      return result;
    } catch (error) {
      trace.push({event:'model-error',model,stage,durationMs:Date.now() - started,...classifyVerificationError(error), providerResponse: error.details ? { code: error.details.code, status: error.details.status, message: String(error.details.message || '').slice(0, 1500) } : undefined});
      throw error;
    } finally {
      activeRequestStage = '';
      activeRequiredRequest = false;
    }
  };
  r.context.requestGeminiGenerateContent.canAttempt = (payload) => {
    const properties = payload.generationConfig?.responseSchema?.properties;
    const stage = properties?.sourcePlan ? 'planning' : payload[Symbol.for('chat.finalVerification')] ? 'final-verification' : properties?.evidenceReviews ? 'evidence-review' : 'answer';
    return budget.canConsume(true, { required: budget.hasReservation(stage) });
  };
  for (const name of ['tryBuildWebSearchData', 'tryBuildPyhokWikiSearchData']) {
    const operation = r.context[name];
    r.context[name] = async (query, options) => {
      const started = Date.now();
      const result = await operation(query, options);
      if (name === 'tryBuildWebSearchData') budget.retainStage('evidence-review', 0);
      trace.push({event:name,query,startedAt:started,endedAt:Date.now(),durationMs:Date.now() - started,result});
      return result;
    };
  }
  const validator = r.context.validateChatCitationsWithStatus;
  r.context.validateChatCitationsWithStatus = (answer, evidence) => {
    const result = validator(answer, evidence);
    trace.push({event:'citation-validation',answer,result:result.answer,accepted:result.valid,reason:result.reason,allowedUrls:result.allowedUrls,citedUrls:result.citedUrls});
    return result;
  };
  const generate = r.context.generateGeminiAnswer;
  r.context.generateGeminiAnswer = async (...args) => {
    try { return await generate(...args); }
    catch (error) {
      const failure = { stage: args[1]?.finalVerification ? 'final-verification' : args[1]?.evidenceReview ? 'evidence-review' : args[1]?.planSearch ? 'planning' : 'answer', ...classifyVerificationError(error), reviewMetrics: error.reviewMetrics };
      questionErrors.push(failure);
      trace.push({ event: 'generation-failed', ...failure });
      throw error;
    }
  };
  const answerNews = r.context.answerVerifiedNews;
  r.context.answerVerifiedNews = (data, generate, options) => {
    budget.retainStage('answer', data.results?.length || 0);
    return answerNews(data, generate, {
    ...options, onVerificationResult: (result) => trace.push({ event: 'answer-verification', result }), onVerificationFailure: (failure) => {
      questionErrors.push({ stage: 'news-summary', ...failure });
      trace.push({ event: 'summary-verification-failed', ...failure });
    },
  });
  };
  for (const name of ['searchWeb', 'collectWebBodyEvidence', 'reviewSourceBodies']) {
    const operation = r.context[name];
    if (typeof operation !== 'function') continue;
    r.context[name] = async (...args) => {
      const started = Date.now();
      const previousStage = activeHttpStage;
      activeHttpStage = name === 'searchWeb' ? 'search' : 'evidence-collection';
      try {
        const result = await operation(...args);
        trace.push({ event: name, stage: name === 'searchWeb' ? 'search' : 'evidence-collection', startedAt:started, endedAt:Date.now(), durationMs: Date.now() - started, status: result?.status });
        return result;
      } catch (error) {
        trace.push({ event: name, stage: name === 'searchWeb' ? 'search' : 'evidence-collection', startedAt:started, endedAt:Date.now(), durationMs: Date.now() - started, error: classifyVerificationError(error) });
        throw error;
      } finally {
        activeHttpStage = previousStage;
      }
    };
  }
  for (const question of questions) {
    trace.length = 0;
    r.sent.length = 0;
    questionErrors = [];
    budget.begin({ stages: { 'evidence-review': selectedCase ? 2 : 1, answer: questionCategory(question) === 'explicit-search' && /뉴스/.test(question) ? 3 : 1, 'final-verification': 1 } });
    const questionStarted = Date.now();
    let timer;
    let timedOut = false;
    let handlerError;
    const handlerPromise = r.context.handleGeminiFallbackMessage({content:`%${question}`,author:{id:'verification',username:'Verification'},guildId:'verification',channelId:'verification',client:{user:{username:'깐냥'}},attachments:new Map(),channel:{send:async()=>{}}})
      .catch((error) => { handlerError = error; throw error; });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { timedOut = true; try { budget.expire(); } catch (error) { reject(error); } }, questionLimits.durationMs);
    });
    try {
      await Promise.race([timeout, handlerPromise]);
      if (handlerError) throw handlerError;
      const recoveredEvidence = trace.some(e => e.event === 'tryBuildWebSearchData' && e.result?.bodyVerification?.requestedSatisfied);
      const terminalErrors = questionErrors.filter(e => !(e.stage === 'evidence-review' && recoveredEvidence));
      const failed = budget.failures.length > 0 || terminalErrors.length > 0 || r.sent.length === 0
        || trace.some((event) => event.result?.failed || ['review-failed', 'retrieval-failed', 'insufficient-evidence', 'rejected'].includes(event.result?.status) || event.event === 'citation-validation' && !event.accepted);
      if (failed) process.exitCode = 1;
      report({worktreeIdentity,question,category:questionCategory(question),status:failed ? 'failed' : 'completed-needs-review',now:new Date().toISOString(),timings:summarizeTimings(trace, Date.now() - questionStarted),verification:summarizeVerification(trace,r.sent),trace,final:r.sent,failures:[...budget.failures,...questionErrors],questionLimits,questionCounts:budget.questionCounts,limits,verificationLimits:limits,operationalLimits,counts});
    } catch (error) {
      report({worktreeIdentity,question,category:questionCategory(question),status:'failed',error:classifyVerificationError(error),timings:summarizeTimings(trace, Date.now() - questionStarted),verification:summarizeVerification(trace,r.sent),trace,final:[...r.sent],failures:[...budget.failures,...questionErrors],questionLimits,questionCounts:budget.questionCounts,limits,verificationLimits:limits,operationalLimits,counts});
      process.exitCode = 1;
    } finally {
      clearTimeout(timer);
      if (timedOut || budget.signal.aborted) {
        await Promise.race([handlerPromise.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 5_000))]);
        // Do not allow an unfinished handler to share counters/trace with the next case.
        if (timedOut) break;
      }
    }
  }
}
clearTimeout(deadline);
globalThis.fetch = originalFetch;
