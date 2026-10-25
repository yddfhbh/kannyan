#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchWeb } from '../src/web-search.js';
import { fetchWebPageText } from '../src/web-page-content.js';
import { buildGeneralSearchPlan } from '../src/general-search-pipeline.js';
import { selectGeneralSearchSources } from '../src/general-search-source-selection.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const questions = ['MDN Fetch API 공식 문서에서 abort signal 사용법', 'Kubernetes 공식 문서의 liveness probe 설명', 'Python 최신 안정 버전', 'PostgreSQL과 MySQL의 공식 문서상 JSON 기능 비교', 'AWS Lambda 요청 요금', 'React 최신 버전'];
const holdout = new Set((JSON.parse(await fs.readFile(path.join(root, 'test/fixtures/general-search-holdout.json'), 'utf8')).questions || []));
if (questions.some((question) => holdout.has(question))) throw new Error('Selected question overlaps holdout');
const maxSearchAttemptsPerQuestion = 4;
const maxTotalSearches = 12;
const maxRetriesPerQuery = 1;
const maxReadsPerQuestion = 4;
const maxTotalReads = 24;
const outputFile = arg('--output', path.join(root, `tmp/general-search-source-research-${new Date().toISOString().replace(/[-:.TZ]/g, '')}.json`));
const dryRun = process.argv.includes('--dry-run');
const plans = questions.map((question) => ({ question, plan: buildGeneralSearchPlan(question, { maxSearches: 2, maxReads: maxReadsPerQuestion }) }));
const planByQuestion = new Map(plans.map((entry) => [entry.question, entry.plan]));

// Search terms are scheduled globally in rounds. The first round gives every
// term one Naver attempt (including both official terms in the comparison),
// before any query can consume a fallback or retry slot. This keeps the
// minimum opportunity fair even when an early provider is slow or blocked.
const queryJobs = [];
for (const { question, plan } of plans) {
  for (const query of plan.queries) queryJobs.push({ question, query, required: true });
}
const primaryJobs = [...queryJobs];
const fallbackJobs = queryJobs.slice(0, Math.max(0, maxTotalSearches - primaryJobs.length));
const scheduledRequests = [
  ...primaryJobs.map((job) => ({ ...job, engine: 'naver', phase: 'primary' })),
  ...fallbackJobs.map((job) => ({ ...job, engine: 'duckduckgo', phase: 'fallback' })),
];
const scheduledByQuestion = new Map(questions.map((question) => [question, scheduledRequests.filter((request) => request.question === question)]));
const report = {
  version: 2, type: 'limited-general-search-source-research', generatedAt: new Date().toISOString(), dryRun, noGeminiCalls: true,
  budgets: { maxSearchAttemptsPerQuestion, maxTotalSearches, maxRetriesPerQuery, maxReadsPerQuestion, maxTotalReads, searchBudgetUnit: 'actual HTTP attempts; includes search-engine fallback and retries', bodyReadBudgetUnit: 'actual HTTP attempts; includes redirects and retries', searchEngines: ['naver', 'duckduckgo'], searchPriority: 'naver-first, globally round-robin primary terms before fallback', exhaustionPolicy: 'check immediately before every HTTP attempt; when exhausted, skip retries and stop retrieval' },
  questions: plans.map(({ question, plan }) => {
    const requests = scheduledByQuestion.get(question) || [];
    const scheduledQueries = new Set(requests.map((request) => request.query));
    return { question, searchQueries: plan.queries, plannedSearches: plan.queries.length, plannedEngineRequests: requests, plannedRequestCount: requests.length, skippedSearchQueries: plan.queries.filter((query) => !scheduledQueries.has(query)).map((query) => ({ query, reason: 'search-budget-reserved-for-fair-primary-round' })), plannedReads: maxReadsPerQuestion, searchBudget: maxSearchAttemptsPerQuestion, readBudget: maxReadsPerQuestion, status: dryRun ? 'planned' : 'pending' };
  }),
  totals: { plannedSearchQueries: plans.reduce((n, item) => n + item.plan.queries.length, 0), plannedEngineRequests: scheduledRequests.length, plannedBodyReads: questions.length * maxReadsPerQuestion },
};

async function saveReport(value) {
  try { await fs.access(outputFile); throw new Error(`Refusing to overwrite existing report: ${outputFile}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.writeFile(outputFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
if (dryRun) { await saveReport(report); console.log(JSON.stringify({ ...report, outputFile }, null, 2)); process.exit(0); }

let searchAttempts = 0;
let readAttempts = 0;
const candidatesByQuestion = new Map(questions.map((question) => [question, []]));
const attemptsByQuestion = new Map(questions.map((question) => [question, []]));
let fallbackProviderBlocked = false;
const runScheduledRequest = async (request) => {
  const rowAttempts = attemptsByQuestion.get(request.question);
  if (request.phase === 'fallback' && fallbackProviderBlocked) {
    rowAttempts.push({ query: request.query, engine: request.engine, phase: request.phase, status: 'fallback-skipped-provider-blocked', httpAttempts: [] });
    return false;
  }
  try {
    const result = await searchWeb(request.query, { maxResults: 12, timeoutMs: 8000, queryVariants: [request.query], providerOrder: [request.engine], beforeHttpAttempt: () => { if (searchAttempts >= maxTotalSearches) return false; searchAttempts += 1; return true; } });
    const status = result.status || 'ok';
    rowAttempts.push({ query: request.query, engine: request.engine, phase: request.phase, status, httpAttempts: result.attempts || [] });
    if (request.phase === 'fallback' && (result.attempts || []).some((attempt) => attempt.httpStatus === 202 && attempt.status === 'blocked')) fallbackProviderBlocked = true;
    candidatesByQuestion.get(request.question).push(...(result.candidates || result.results || []));
    return !result.failed && (result.candidates || result.results || []).length > 0;
  } catch (error) {
    rowAttempts.push({ query: request.query, engine: request.engine, phase: request.phase, status: 'error', error: String(error?.code || error?.message || error) });
    return false;
  }
};

// Phase 1: every planned query gets one Naver request before any fallback.
const needsFallback = [];
for (const request of primaryJobs) {
  const found = await runScheduledRequest({ ...request, engine: 'naver', phase: 'primary' });
  if (!found) needsFallback.push(request);
}
// Phase 2: use only the remaining slots for fallback, in the same fair order.
const fallbackCapacity = Math.max(0, maxTotalSearches - searchAttempts);
for (const request of needsFallback.slice(0, fallbackCapacity)) {
  await runScheduledRequest({ ...request, engine: 'duckduckgo', phase: 'fallback' });
}
for (const request of needsFallback.slice(fallbackCapacity)) {
  attemptsByQuestion.get(request.question).push({ query: request.query, engine: 'duckduckgo', phase: 'fallback', status: 'fallback-skipped-budget-exhausted', httpAttempts: [] });
}
for (const row of report.questions) {
  const candidates = candidatesByQuestion.get(row.question);
  const attempts = attemptsByQuestion.get(row.question);
  row.requestCount = attempts.length;
  const attemptedQueries = new Set(attempts.map((attempt) => attempt.query));
  row.skippedSearchQueries = planByQuestion.get(row.question).queries.filter((query) => !attemptedQueries.has(query)).map((query) => ({ query, reason: searchAttempts >= maxTotalSearches ? 'search-budget-exhausted' : 'not-selected-after-primary-round' }));
  row.attempts = attempts;
  const unique = [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()];
  const selected = selectGeneralSearchSources(row.question, unique, { siteQueries: row.searchQueries }).selected.slice(0, maxReadsPerQuestion);
  row.candidates = unique; row.selectedUrls = selected.map((candidate) => candidate.url); row.reads = [];
  for (const candidate of selected) {
    if (readAttempts >= maxTotalReads || row.reads.length >= maxReadsPerQuestion) break;
    if (candidate.pageText || candidate.text) { row.reads.push({ url: candidate.url, status: 'provided' }); continue; }
    if (!candidate.url) continue;
    try {
      const page = await fetchWebPageText(candidate.url, { timeoutMs: 8000, beforeHttpAttempt: () => { if (readAttempts >= maxTotalReads) return false; readAttempts += 1; return true; } });
      row.reads.push({ url: candidate.url, status: 'success', bodyLength: String(page.text || '').length });
    } catch (error) { row.reads.push({ url: candidate.url, status: 'failed', error: String(error?.code || error?.message || error) }); }
  }
  row.status = row.selectedUrls.length ? 'completed-source-selection' : 'hold-no-candidates';
}
report.totals.actualSearchHttpAttempts = searchAttempts;
report.totals.actualReadHttpAttempts = readAttempts;
report.totals.plannedConditionalFallbackRequests = needsFallback.length;
report.totals.actualFallbackRequests = attemptsByQuestion.size ? [...attemptsByQuestion.values()].flat().filter((attempt) => attempt.phase === 'fallback' && attempt.httpAttempts?.length).length : 0;
report.totals.fallbackSkippedBudgetExhausted = [...attemptsByQuestion.values()].flat().filter((attempt) => attempt.status === 'fallback-skipped-budget-exhausted').length;
report.totals.fallbackSkippedProviderBlocked = [...attemptsByQuestion.values()].flat().filter((attempt) => attempt.status === 'fallback-skipped-provider-blocked').length;
await saveReport(report);
console.log(JSON.stringify({ outputFile, actualSearchHttpAttempts: searchAttempts, actualReadHttpAttempts: readAttempts, noGeminiCalls: true }, null, 2));
