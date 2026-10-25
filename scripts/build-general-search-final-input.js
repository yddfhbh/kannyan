#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchWebPageText } from '../src/web-page-content.js';
import { buildGeneralSearchSourceSnapshot } from '../src/general-search-snapshot.js';
import { buildEvidenceExtractionInput } from '../src/general-search-llm-extraction.js';
import { selectRelevantSourceSpans } from '../src/general-search-source-selection.js';
import { understandSearchQuestion, requestedAnswerRequirements, classifyOfficialSource } from '../src/general-search-pipeline.js';

const root = process.cwd();
const stamp = '20261024';
const snapshotOutput = path.join(root, `tmp/general-search-official-source-snapshots-${stamp}.json`);
const inputOutput = path.join(root, `tmp/general-search-gemini-final-input-${stamp}.json`);
const manifestOutput = path.join(root, `tmp/general-search-gemini-input-manifest-${stamp}.json`);
const referenceTime = '2026-10-24T00:19:00+09:00';
const offline = process.argv.includes('--offline');
const previousInput = offline ? JSON.parse(await fs.readFile(inputOutput, 'utf8')) : null;

// This is the complete direct-read budget for this run: one attempt per URL,
// no search, retry, or automatic fallback. Redirects are counted by the
// fetcher through beforeHttpAttempt as additional HTTP attempts.
const targets = [
  ['gemini-01', 'MDN Fetch API AbortSignal 사용법', 'https://developer.mozilla.org/ko/docs/Web/API/Fetch_API/Using_Fetch'],
  ['gemini-01', 'MDN Fetch API AbortSignal 사용법', 'https://developer.mozilla.org/en-US/docs/Web/API/AbortController/signal'],
  ['gemini-02', 'Kubernetes 공식 문서의 liveness probe 설명', 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/'],
  ['gemini-02', 'Kubernetes 공식 문서의 liveness probe 설명', 'https://kubernetes.io/docs/concepts/workloads/pods/probes/'],
  ['gemini-03', 'Python 최신 안정 버전', 'https://www.python.org/downloads/'],
  ['gemini-03', 'Python 최신 안정 버전', 'https://www.python.org/downloads/release/python-3913/'],
  ['gemini-04', 'PostgreSQL과 MySQL의 JSON 기능 비교', 'https://www.postgresql.org/docs/current/datatype-json.html'],
  ['gemini-04', 'PostgreSQL과 MySQL의 JSON 기능 비교', 'https://dev.mysql.com/doc/refman/8.4/en/json.html'],
  ['gemini-05', 'AWS Lambda 요청 요금', 'https://aws.amazon.com/ko/lambda/pricing/'],
  ['gemini-06', 'React 최신 버전', 'https://react.dev/blog/2025/10/01/react-19-2'],
];

const byQuestion = new Map();
let httpAttempts = 0;
const reads = [];
for (const [id, question, url] of targets) {
  const row = { id, question, requestedUrl: url, discoveredFromSourceSelection: true, officialUrl: classifyOfficialSource(url), attempts: 0 };
  const previous = previousInput?.cases?.flatMap((item) => item.snapshots || []).find((snapshot) => snapshot.source?.originalUrl === url);
  if (previous) {
    Object.assign(row, { status: previous.status === 'captured' ? 'success' : 'read-failed', finalUrl: previous.source.finalUrl || url, httpStatus: previous.source.httpStatus, title: previous.source.title, body: previous.body.text || '', fullBodyLength: previous.body.fullLength ?? previous.body.length, textTruncated: previous.body.truncated === true, redirectChain: previous.source.redirectChain || [], canonicalUrl: previous.source.canonicalUrl || '', bodySnapshotStatus: previous.status });
    reads.push(row); if (!byQuestion.has(question)) byQuestion.set(question, []); byQuestion.get(question).push(row); continue;
  }
  try {
    const page = await fetchWebPageText(url, {
      maxTextLength: 30000,
      beforeHttpAttempt: () => { httpAttempts += 1; row.attempts += 1; return httpAttempts <= 10; },
    });
    row.status = 'success'; row.finalUrl = page.url; row.httpStatus = page.status; row.title = page.title;
    row.body = page.text; row.fullBodyLength = page.fullTextLength ?? page.text.length; row.textTruncated = page.textTruncated === true;
    row.redirectChain = page.redirectChain || []; row.canonicalUrl = page.canonicalUrl || '';
    row.bodySnapshotStatus = page.text ? 'captured' : 'body-snapshot-missing';
  } catch (error) {
    row.status = error?.code === 'HTTP_BUDGET_EXHAUSTED' ? 'body-snapshot-missing' : 'read-failed';
    row.bodySnapshotStatus = 'body-snapshot-missing'; row.errorCategory = error?.code || error?.name || 'Error';
    row.body = ''; row.fullBodyLength = null; row.redirectChain = [];
  }
  reads.push(row);
  if (!byQuestion.has(question)) byQuestion.set(question, []);
  byQuestion.get(question).push(row);
}

const requiredById = {
  'gemini-01': ['fact-value', 'usage-procedure', 'authoritative-source'],
  'gemini-02': ['fact-value', 'authoritative-source'],
  'gemini-03': ['version', 'release-status', 'freshness', 'authoritative-source'],
  'gemini-04': ['service-a', 'service-b', 'comparison-attributes', 'authoritative-source'],
  'gemini-05': ['request-price', 'free-tier', 'pricing-conditions', 'authoritative-source'],
  'gemini-06': ['version', 'release-status', 'freshness', 'authoritative-source'],
};
const cases = [];
for (const [id, question] of [...new Map(targets.map(([caseId, q]) => [caseId, q])).entries()]) {
  const sourceRows = byQuestion.get(question) || [];
  const snapshots = sourceRows.map((row, index) => {
    const snapshot = buildGeneralSearchSourceSnapshot(question, {
      ...row, url: row.finalUrl || row.requestedUrl, originalUrl: row.requestedUrl,
      pageText: row.body, maxTextLength: 30000, fullBodyLength: row.fullBodyLength,
      bodyTruncated: row.textTruncated, snapshotId: `${id}-snapshot-${index + 1}`,
    }, { requiredAnswerItems: requiredById[id] });
    const bounded = selectRelevantSourceSpans(question, { ...row, url: row.finalUrl || row.requestedUrl, pageText: row.body, snapshotId: snapshot.snapshotId }, { budgets: { maxContextTokensPerPage: 900 } });
    snapshot.relevantSegments = bounded.blocks;
    snapshot.selection = { status: bounded.blocks.length ? 'bounded' : 'related-segment-missing', originalBodyLength: bounded.bodyLength, originalTokens: bounded.originalTokens, selectedTokens: bounded.selectedTokens, omittedBlocks: bounded.omittedBlocks };
    return snapshot;
  });
  const sources = snapshots.map((snapshot) => ({
    sourceId: snapshot.snapshotId, snapshotId: snapshot.snapshotId, url: snapshot.source.finalUrl || snapshot.source.originalUrl,
    title: snapshot.source.title, pageText: snapshot.body.text, body: snapshot.body,
    relevantSegments: snapshot.relevantSegments, publishedAt: snapshot.source.publishedAt,
    official: snapshot.source.official, originalUrl: snapshot.source.originalUrl, finalUrl: snapshot.source.finalUrl,
  }));
  const extractionInput = buildEvidenceExtractionInput(question, sources, { referenceTime, requiredAnswerItems: requiredById[id] });
  const officialBodyCount = snapshots.filter((s) => s.source.official && s.status === 'captured').length;
  const boundedCount = snapshots.filter((s) => s.selection.status === 'bounded').length;
  const relatedText = snapshots.map((s) => s.relevantSegments.map((segment) => segment.text).join('\n')).join('\n');
  const coreEvidence = id === 'gemini-01' ? /fetch/i.test(relatedText) && /abort|signal/i.test(relatedText) && /abort\s*\(|signal\s*[:=]|example|예제/i.test(relatedText)
    : id === 'gemini-02' ? /liveness/i.test(relatedText) && /probe|health|container/i.test(relatedText)
      : id === 'gemini-04' ? /json/i.test(relatedText) && /jsonb|native json|data type/i.test(relatedText)
        : id === 'gemini-05' ? /무료|free/i.test(relatedText) && /요청/i.test(relatedText) && /(?:\$|USD|달러)\s*\d|\d\s*(?:USD|달러)/i.test(relatedText)
          : false;
  const comparisonReady = id !== 'gemini-04' || (officialBodyCount >= 2 && boundedCount >= 2 && coreEvidence);
  const ready = snapshots.length > 0 && snapshots.every((s) => s.status === 'captured') && officialBodyCount > 0 && boundedCount > 0 && comparisonReady && coreEvidence && !['gemini-03', 'gemini-06'].includes(id);
  const inputJson = JSON.stringify(extractionInput);
  cases.push({ id, question, requiredAnswerItems: requiredById[id], snapshots, extractionInput, inputTokenEstimate: Math.ceil(inputJson.length / 4), execution: { status: ready ? 'ready' : 'hold', geminiCallAllowed: ready, reason: ready ? null : 'official-body-or-related-segment-insufficient' } });
}

const safeReads = reads.map(({ body, ...row }) => ({ ...row, bodySnapshotExists: Boolean(body), bodyLength: body.length }));
const snapshotDocument = { version: 2, generatedAt: new Date().toISOString(), directReadHttpAttempts: offline ? 10 : httpAttempts, directReadBudget: 10, noSearch: true, noGeminiCalls: true, reads: safeReads, cases: cases.map(({ extractionInput, ...row }) => row) };
const inputDocument = { version: 3, generatedAt: new Date().toISOString(), referenceTime, noWebSearch: true, noGeminiCalls: true, sourceSnapshotFile: path.relative(root, snapshotOutput), actualGeminiCalls: 0, cases };
const manifest = { version: 1, generatedAt: new Date().toISOString(), sourceSnapshotFile: path.relative(root, snapshotOutput), inputFile: path.relative(root, inputOutput), noGeminiCalls: true, questions: cases.map((item) => ({ id: item.id, question: item.question, urls: item.snapshots.map((s) => ({ requested: s.source.originalUrl, final: s.source.finalUrl, official: s.source.official, body: s.status, bodyLength: s.body.length, fullBodyLength: s.body.fullLength, truncated: s.body.truncated, snapshotId: s.snapshotId, relatedSegment: s.selection.status, relatedSegmentCount: s.relevantSegments.length, sourceSpanBasis: s.sourceSpanBasis })), requiredAnswerItems: item.requiredAnswerItems, inputTokenEstimate: item.inputTokenEstimate, geminiCallAllowed: item.execution.geminiCallAllowed, status: item.execution.status, holdReason: item.execution.reason })), actualGeminiCalls: 0, inputTokenEstimateTotal: cases.reduce((sum, item) => sum + item.inputTokenEstimate, 0) };
await fs.writeFile(snapshotOutput, `${JSON.stringify(snapshotDocument, null, 2)}\n`);
await fs.writeFile(inputOutput, `${JSON.stringify(inputDocument, null, 2)}\n`);
await fs.writeFile(manifestOutput, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ snapshotOutput, inputOutput, manifestOutput, directReadHttpAttempts: httpAttempts, actualGeminiCalls: 0, callableQuestions: cases.filter((item) => item.execution.geminiCallAllowed).length }, null, 2));
