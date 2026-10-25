#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchWeb } from '../src/web-search.js';
import { fetchWebPageText } from '../src/web-page-content.js';
import { buildSnapshotLedger } from '../src/general-search-snapshot.js';
import { selectGeneralSearchSources } from '../src/general-search-source-selection.js';

// Bounded, separate source-reacquisition experiment. It deliberately does not
// call Gemini and does not invoke the production pipeline/evidence verifier.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => process.argv.find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const referenceTime = '2026-10-24T00:00:00+09:00';
const output = arg('--output', path.join(root, 'tmp/general-search-focused-source-research-20261024.json'));
const baselineFile = arg('--baseline', path.join(root, 'tmp/general-search-bodies-final-semantic.json'));
const baselineEvalFile = arg('--baseline-eval', path.join(root, 'tmp/general-search-evaluation-current.json'));
const questions = [
  { id: 'focus-01', question: 'PostgreSQL 최신 안정 버전', queries: ['PostgreSQL latest stable release official download', 'site:postgresql.org PostgreSQL current version release'] },
  { id: 'focus-02', question: 'GitHub Actions 요금제', queries: ['GitHub Actions pricing billing official', 'site:docs.github.com GitHub Actions 비용 청구'] },
  { id: 'focus-03', question: '2026-10-24 서울 날씨', queries: ['2026-10-24 서울 날씨 기상청', 'site:weather.go.kr 2026-10-24 서울 날씨'] },
  { id: 'focus-04', question: '2026-10-18~24 반도체 뉴스', queries: ['2026-10-18 2026-10-24 반도체 뉴스', '2026 semiconductor news October 18 24'] },
  { id: 'focus-05', question: '2026-10-24 기준 과학기술정보통신부 장관', queries: ['2026-10-24 과학기술정보통신부 장관 site:msit.go.kr', '2026-10-24 과학기술정보통신부 장관 site:korea.kr'] },
  { id: 'focus-06', question: '2026년 10월 서울 무료 개발자 행사 일정', queries: ['2026년 10월 서울 무료 개발자 행사', 'October 2026 Seoul free developer events'] },
];
const maxSearches = 12;
const maxReads = 24;
const readJson = async (file, fallback) => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; } };
const baseline = await readJson(baselineFile, { cases: [] });
const baselineByQuestion = new Map((baseline.cases || []).map((item) => [item.question, item]));
const previousEval = await readJson(baselineEvalFile, { cases: [] });
const previousByQuestion = new Map((previousEval.cases || []).map((item) => [item.question, item]));
const sourceCache = new Map();
for (const item of baseline.cases || []) {
  for (const page of item.reads || []) {
    const text = String(page.body || page.pageText || page.text || '');
    if (page.url && text) sourceCache.set(page.url, { ...page, text, reused: true });
  }
}

let searchAttempts = 0;
let readAttempts = 0;
const rows = [];
const request = async (row, query, engine) => {
  if (searchAttempts >= maxSearches) return { status: 'skipped-search-budget', attempts: [] };
  searchAttempts += 1;
  try {
    const result = await searchWeb(query, {
      maxResults: 12, timeoutMs: 8000, queryVariants: [query], providerOrder: [engine],
      beforeHttpAttempt: () => true,
    });
    row.searches.push({ query, engine, status: result.status || (result.failed ? 'failed' : 'ok'), attempts: result.attempts || [], candidates: (result.candidates || result.results || []).map((c) => ({ url: c.url, title: c.title, text: c.text || c.pageText || '' })) });
    return result;
  } catch (error) {
    row.searches.push({ query, engine, status: 'error', error: String(error?.code || error?.message || error), attempts: [] });
    return { failed: true, candidates: [] };
  }
};
for (const item of questions) {
  const row = { id: item.id, question: item.question, referenceTime, experimentDate: referenceTime, queries: item.queries, searches: [], candidates: [], selectedUrls: [], reads: [], snapshots: [], status: 'pending' };
  // One attempt per query gives each question equal opportunity. Engines are
  // alternated so one provider block cannot consume the whole question.
  for (let i = 0; i < item.queries.length; i += 1) await request(row, item.queries[i], i % 2 ? 'duckduckgo' : 'naver');
  const candidates = [...row.searches.flatMap((s) => s.candidates || []), ...((baselineByQuestion.get(item.question)?.reads || []).map((p) => ({ url: p.url, title: p.title, text: p.body || '', reused: true })))]
    .filter((c) => c.url)
    .reduce((map, c) => map.set(c.url, { ...map.get(c.url), ...c }), new Map());
  row.candidates = [...candidates.values()];
  // Rank discovered URLs before any body read. Discovery is not evidence of a
  // successful read, and the snapshot ledger below contains only read bodies.
  const selection = selectGeneralSearchSources(item.question, row.candidates, { siteQueries: [], budgets: { maxSearchCandidates: row.candidates.length, maxSelectedPages: 4 } });
  const selected = selection.selected;
  row.selectionDiagnostics = selection.diagnostics;
  row.selectedUrls = selected.map((c) => c.url);
  for (const candidate of selected) {
    if (readAttempts >= maxReads) { row.reads.push({ url: candidate.url, status: 'skipped-read-budget' }); continue; }
    const cached = sourceCache.get(candidate.url);
    if (cached) { row.reads.push({ url: candidate.url, title: cached.title || candidate.title, status: 'reused', body: cached.text, bodyLength: cached.text.length, reused: true }); continue; }
    readAttempts += 1;
    try {
      const page = await fetchWebPageText(candidate.url, { timeoutMs: 8000, beforeHttpAttempt: () => true });
      const text = String(page.text || '');
      row.reads.push({ url: candidate.url, title: page.title || candidate.title, status: 'success', body: text, bodyLength: text.length, finalUrl: page.url || candidate.url, redirectChain: page.redirectChain || [], textTruncated: page.textTruncated, fullTextLength: page.fullTextLength, maxTextLength: 8000, publishedAt: page.publishedAt || null });
    } catch (error) { row.reads.push({ url: candidate.url, title: candidate.title, status: 'failed', body: '', bodyLength: 0, error: String(error?.code || error?.message || error) }); }
  }
  const sourceRows = row.reads.filter((read) => read.bodyLength > 0).map((read) => ({ url: read.finalUrl || read.url, originalUrl: read.url, finalUrl: read.finalUrl || read.url, title: read.title, pageText: read.body, status: read.status, textTruncated: read.textTruncated, fullBodyLength: read.fullTextLength, maxTextLength: read.maxTextLength, redirectChain: read.redirectChain, publishedAt: read.publishedAt }));
  row.snapshots = buildSnapshotLedger(item.question, sourceRows, { requiredAnswerItems: [], searchEngine: 'bounded-focused-research', query: item.queries.join(' | ') });
  row.status = row.reads.some((read) => read.bodyLength > 0) ? 'body-obtained' : 'hold-no-body';
  const before = previousByQuestion.get(item.question);
  row.before = { officialUrls: before?.quality?.officialHostCandidateCount ?? null, bodyCount: before?.quality?.bodyExtractionSucceeded ?? null, requiredFacts: before?.prototype?.answerRequirements?.satisfied ?? null, freshness: before?.prototype?.answerRequirements?.status ?? null, gemini: before?.prototype?.status === 'verified' ? 'ready' : 'hold' };
  row.after = { discoveredUrlCount: row.candidates.filter((c) => row.searches.some((s) => (s.candidates || []).some((x) => x.url === c.url))).length, readSuccessCount: row.reads.filter((r) => r.bodyLength > 0).length, snapshotCount: row.snapshots.filter((s) => s.status === 'captured').length, selectedOfficialUrlCount: row.snapshots.filter((s) => s.status === 'captured' && s.source.official).length, bodyLengths: row.reads.map((r) => ({ url: r.url, length: r.bodyLength, status: r.status })) };
  rows.push(row);
}
const report = { version: 1, type: 'focused-general-search-source-research', generatedAt: new Date().toISOString(), referenceTime, experimentDate: referenceTime, noGeminiCalls: true, holdoutAccessed: false, semanticVerifierChanged: false, productionPathChanged: false, budgets: { maxSearches, maxReads, searchAttempts, bodyReadHttpAttempts: readAttempts, reusedBodiesNotCountedAsHttpReads: true }, questions: rows, baseline: { file: baselineFile, evaluationFile: baselineEvalFile, dateDistinction: 'experimentDate is retrieval time; source publication/observation/effective dates remain source fields and are not substituted' } };
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, searchAttempts, bodyReadHttpAttempts: readAttempts, reusedBodyCount: rows.flatMap((r) => r.reads).filter((r) => r.reused).length, noGeminiCalls: true, holdoutAccessed: false }, null, 2));
