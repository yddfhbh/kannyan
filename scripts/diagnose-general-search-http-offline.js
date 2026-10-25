#!/usr/bin/env node
import fs from 'node:fs/promises';
import { searchWeb } from '../src/web-search.js';

const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9)
  || 'tmp/general-search-http-diagnostics-offline-20261024.json';

const naverHtml = '<main><a href="https://www.postgresql.org/download/">PostgreSQL Downloads</a></main>';
const ddgHtml = '<div class="result"><a class="result__title result__a" href="https://docs.github.com/en/billing">GitHub Actions billing</a><div class="result__snippet">Billing documentation</div></div>';
const emptyNaverHtml = '<main>검색 결과가 없습니다</main>';

async function runCase(name, fetchImpl, options = {}) {
  const calls = [];
  const result = await searchWeb(name, {
    queryVariants: options.queryVariants || [name],
    providerOrder: options.providerOrder || ['naver'],
    timeoutMs: 1000,
    fetchImpl: async (url, init) => {
      calls.push({ host: new URL(url).hostname, method: init?.method || 'GET', signal: Boolean(init?.signal) });
      return fetchImpl(url, init);
    },
    beforeHttpAttempt: options.beforeHttpAttempt,
  });
  return { name, calls, status: result.status, attempts: result.attempts, candidates: result.candidates?.length || 0 };
}

const cases = [];
cases.push(await runCase('valid-200', async () => new Response(naverHtml, { status: 200, headers: { 'content-type': 'text/html' } })));
cases.push(await runCase('valid-200-empty', async () => new Response(emptyNaverHtml, { status: 200, headers: { 'content-type': 'text/html' } })));
cases.push(await runCase('fetch-typeerror', async () => { const error = new TypeError('fetch failed'); error.cause = { code: 'ECONNRESET' }; throw error; }));
cases.push(await runCase('dns-failure', async () => { const error = new TypeError('fetch failed'); error.cause = { code: 'ENOTFOUND' }; throw error; }));
cases.push(await runCase('request-timeout', async () => { const error = new Error('The operation was aborted'); error.name = 'AbortError'; throw error; }));
cases.push(await runCase('http-202-blocked', async () => new Response('challenge', { status: 202 })));
cases.push(await runCase('fallback', async (url) => String(url).includes('search.naver.com')
  ? new Response('challenge', { status: 202 })
  : new Response(ddgHtml, { status: 200, headers: { 'content-type': 'text/html' } }), { providerOrder: ['naver', 'duckduckgo'] }));

let budgetReservations = 0;
let budgetFetches = 0;
const budget = await runCase('global-budget', async () => { budgetFetches += 1; throw new TypeError('fetch failed'); }, {
  queryVariants: Array.from({ length: 12 }, (_, index) => `global-budget-${index + 1}`),
  beforeHttpAttempt: () => { if (budgetReservations >= 12) return false; budgetReservations += 1; return true; },
});
cases.push({ ...budget, budgetReservations, budgetFetches });

const previous = JSON.parse(await fs.readFile('tmp/general-search-focused-source-research-20261024.json', 'utf8'));
const bodies = JSON.parse(await fs.readFile('tmp/general-search-bodies-final-semantic.json', 'utf8'));
const githubCase = bodies.cases.find((item) => item.question === 'GitHub Actions 요금제');
const githubSources = (githubCase?.reads || []).map((source) => {
  const body = String(source.body || '');
  const official = /(^|\.)github\.com$/i.test(new URL(source.url).hostname) || /\.github\.com$/i.test(new URL(source.url).hostname);
  const sensitive = /(?:api[_ -]?key|access[_ -]?token|secret|password|passwd|client[_ -]?secret)\s*[:=]\s*[^\s,;]+/i.test(body);
  return { url: source.url, official, sensitive, pricing: /요금|가격|price|pricing/i.test(body), freeAllowance: /무료|free/i.test(body), billing: /청구|billing/i.test(body), conditions: /초과|결제|공개 리포지토리|private/i.test(body) };
});
const observed = previous.questions.flatMap((question) => question.searches.map((search) => ({
  id: question.id,
  question: question.question,
  query: search.query,
  engine: search.engine,
  attempts: (search.attempts || []).map((attempt) => ({
    provider: attempt.provider,
    status: attempt.status,
    httpStatus: attempt.httpStatus ?? null,
    fetchInvoked: attempt.fetchInvoked ?? 'unknown',
    responseReceived: attempt.responseReceived ?? (attempt.httpStatus !== null ? true : 'unknown'),
    failureStage: attempt.failureStage ?? (attempt.httpStatus === null ? 'unknown' : 'unknown'),
    errorName: attempt.errorName ?? attempt.errorCode ?? 'unknown',
    errorMessage: attempt.errorMessage ?? 'unknown',
    errorCauseCode: attempt.errorCauseCode ?? 'unknown',
    abort: attempt.abort ?? 'unknown',
    requestAttemptCount: 1,
    budgetReason: 'one focused query reservation; original log did not expose reservation callback outcome',
  })),
  conclusion: search.attempts?.every((attempt) => attempt.httpStatus === null) ? 'no HTTP response recorded; fetch invocation and wire transmission unknown' : 'unknown',
})));

const report = {
  version: 1,
  type: 'offline-general-search-http-diagnostics',
  generatedAt: new Date().toISOString(),
  referenceTime: '2026-10-24T00:00:00+09:00',
  noNetworkRequests: true,
  noGeminiCalls: true,
  holdoutAccessed: false,
  observedFailedRequests: observed,
  mockCases: cases,
  githubActionsReassessment: {
    sourceCount: githubSources.length,
    sources: githubSources,
    officialPricingSourceSufficient: githubSources.some((source) => source.official && !source.sensitive && source.pricing && source.freeAllowance && source.billing && source.conditions),
    sensitiveBlockScope: 'source-local; itwiki/other contaminated pages do not invalidate the clean official GitHub billing page',
    recommendedStatus: 'extraction-testable-or-freshness-hold; not ready because the cached source does not independently establish 2026-10-24 freshness',
  },
  datePolicy: {
    referenceStart: '2026-10-24T00:00:00+09:00',
    retrievalTimeIsSeparate: true,
    weather: 'observation or forecast effective time must match the requested date/location',
    news: '[2026-10-18T00:00:00+09:00, 2026-10-25T00:00:00+09:00)',
    minister: 'incumbency evidence must be valid at answer time',
    events: 'actual October 2026 Seoul event schedule and free condition must be evidenced',
    unknownFreshnessNotReady: true,
  },
  interpretation: {
    fetchInvoked: 'The injected transport invocation is observable; it does not prove packets left the process.',
    httpSent: 'unknown when httpStatus is null; native fetch does not expose DNS/TCP/TLS wire completion.',
    budget: 'A budget reservation is not an HTTP attempt unless fetchInvoked is true; the mock budget case records the distinction.',
  },
};
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, observedRequests: observed.length, mockCases: cases.length, noNetworkRequests: true }, null, 2));
