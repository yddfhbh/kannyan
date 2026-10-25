#!/usr/bin/env node
import fs from 'node:fs/promises';
import { searchWeb } from '../src/web-search.js';

// Run only from an ordinary Ubuntu SSH shell with network access. The default
// mode reports local configuration and does not make any HTTP request.
const run = process.argv.includes('--run');
const output = process.argv.find((value) => value.startsWith('--output='))?.slice(9)
  || 'tmp/general-search-http-minimal-20261024.json';
const query = 'GitHub Actions pricing billing official';
const timeoutMs = 8000;
const environment = {
  nodeVersion: process.version,
  nodeExecutable: process.execPath,
  cwd: process.cwd(),
  user: process.env.USER || null,
  uid: process.getuid?.() ?? null,
  agentHebiSandbox: Boolean(process.env.CODEX_SANDBOX_NETWORK_DISABLED),
  sandboxVariableNames: Object.keys(process.env).filter((key) => /HEBI|SANDBOX/i.test(key)),
  proxyVariableNames: Object.keys(process.env).filter((key) => /^(?:https?_proxy|all_proxy|no_proxy)$/i.test(key)),
  httpClient: 'searchWeb -> performNaverSearch -> injected fetchImpl -> Node global fetch (undici)',
  fetchImplementation: String(globalThis.fetch).slice(0, 160),
  timeoutMs,
  abortController: 'searchWeb creates one AbortController per call and aborts at timeoutMs (or chat budget minus 14000 ms)',
  redirectPolicy: 'manual; HTTP 3xx is returned without following Location',
};

if (!run) {
  console.log(JSON.stringify({ mode: 'env-only', query, environment, actualFetchInvocations: 0 }, null, 2));
  process.exit(0);
}
if (environment.agentHebiSandbox) throw new Error('Refusing live HTTP in Agent-Hebi sandbox');
if (typeof globalThis.fetch !== 'function') throw new Error('Node global fetch is unavailable');

const report = {
  type: 'minimal-general-search-http-comparison',
  generatedAt: new Date().toISOString(), query, environment,
  maxActualFetchInvocations: 2, fallback: false, retries: false,
  redirectsFollowed: false, geminiCalls: 0, holdoutAccessed: false,
  paths: [], totalFetchInvocations: 0, wireTransmission: 'unknown',
};
// Exclusive creation makes rerunning the same command fail before either request.
const handle = await fs.open(output, 'wx');
await handle.close();
const save = () => fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await save();

async function onePath(pathName) {
  const row = {
    path: pathName, httpCallFunction: 'searchWeb -> performNaverSearch -> Node global fetch',
    query, engine: 'naver', options: { maxResults: 12, timeoutMs, queryVariants: [query], providerOrder: ['naver'] },
    fetchInvoked: false, responseReceived: false, httpStatus: null,
    rawCandidateCount: null, eligibleCandidateCount: null,
    errorName: null, errorMessage: null, errorCauseCode: null,
    failureStage: null, abort: false, timeout: false, durationMs: null,
    redirectReceived: false, fetchInvocationCount: 0, budgetReservations: 0,
  };
  const started = performance.now();
  const fetchImpl = async (url, init) => {
    if (row.fetchInvocationCount >= 1 || report.totalFetchInvocations >= 2) {
      throw new Error('Minimal HTTP budget exceeded');
    }
    row.fetchInvocationCount += 1;
    report.totalFetchInvocations += 1;
    await save();
    row.fetchInvoked = true;
    const response = await globalThis.fetch(url, { ...init, redirect: 'manual' });
    row.responseReceived = true;
    row.httpStatus = response.status;
    row.redirectReceived = response.status >= 300 && response.status < 400;
    return response;
  };
  const beforeHttpAttempt = pathName === 'A-general-search-source-research'
    ? () => { if (row.budgetReservations >= 1) return false; row.budgetReservations += 1; return true; }
    : () => { row.budgetReservations += 1; return true; };
  try {
    const result = await searchWeb(query, { ...row.options, fetchImpl, beforeHttpAttempt });
    const attempt = result.attempts?.[0] || {};
    row.searchStatus = result.status;
    row.fetchInvoked = row.fetchInvoked || Boolean(attempt.fetchInvoked);
    row.responseReceived = row.responseReceived || Boolean(attempt.responseReceived);
    row.httpStatus = row.httpStatus ?? attempt.httpStatus ?? null;
    row.rawCandidateCount = attempt.rawCandidateCount ?? 0;
    row.eligibleCandidateCount = attempt.eligibleCandidateCount ?? 0;
    row.errorName = attempt.errorName ?? null;
    row.errorMessage = attempt.errorMessage ?? null;
    row.errorCauseCode = attempt.errorCauseCode ?? null;
    row.failureStage = attempt.failureStage ?? null;
    row.abort = Boolean(attempt.abort);
    row.timeout = row.abort || result.status === 'timeout';
    row.attemptCount = result.attempts?.length ?? 0;
  } catch (error) {
    row.searchStatus = 'runner-error';
    row.errorName = error?.name || null;
    row.errorMessage = String(error?.message || error);
    row.errorCauseCode = error?.cause?.code || null;
    row.failureStage = row.fetchInvoked ? 'fetch-or-after' : 'before-fetch';
    row.abort = error?.name === 'AbortError' || error?.name === 'TimeoutError';
    row.timeout = row.abort;
  }
  row.durationMs = Math.round(performance.now() - started);
  report.paths.push(row);
  await save();
}

await onePath('A-general-search-source-research');
await onePath('B-focused-source-research');
console.log(JSON.stringify(report, null, 2));
