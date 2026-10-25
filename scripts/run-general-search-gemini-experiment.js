#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGeneralSearchPipeline } from '../src/general-search-pipeline.js';
import { assessRequiredAnswerItems, buildEvidenceExtractionInput, createGeminiEvidenceExtractor } from '../src/general-search-llm-extraction.js';
import { classifyOfficialSource } from '../src/general-search-pipeline.js';
import { assessFocusedCase } from '../src/general-search-focused-assessment.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let maxApiCalls = Math.min(3, Math.max(1, Number(process.argv.find((value) => value.startsWith('--max-calls='))?.slice('--max-calls='.length) || 3)));
const allowed = ['GEMINI_API_KEYS', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'GENERAL_SEARCH_GEMINI_MODEL', 'GENERAL_SEARCH_GEMINI_TIMEOUT_MS', 'GEMINI_TIMEOUT_MS'];
const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
function parseEnv(text) {
  const values = {};
  for (const line of String(text).split(/\r?\n/).map((value) => value.trim())) {
    const match = line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (match && allowed.includes(match[1])) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '').replace(/\\n/g, '\n');
  }
  return values;
}
const envFile = arg('--env-file', '/home/ubuntu/discord-bot-new/.env');
const inputFile = arg('--input', path.join(root, 'tmp/general-search-gemini-experiment-input-20261024.json'));
const outputFile = arg('--output', path.join(root, `tmp/general-search-gemini-experiment-run-${new Date().toISOString().replace(/[-:.TZ]/g, '')}.json`));
const aReportFile = arg('--a-report', path.join(root, 'tmp/general-search-gemini-experiment-run-20261024-ssh.json'));
const envValues = await fs.readFile(envFile, 'utf8').then(parseEnv).catch(() => ({}));
const input = await readJson(inputFile);
if (Number.isInteger(input.maxGeminiHttpRequests)) maxApiCalls = Math.min(maxApiCalls, input.maxGeminiHttpRequests);
const storedA = await readJson(aReportFile).catch(() => ({ results: [] }));
const storedAByQuestion = new Map((storedA.results || []).map((result) => [result.question, result]));
const requestedLimit = Math.max(1, Number(arg('--limit', '3')) || 3);
const callable = (input.cases || []).filter((item) => item.execution?.geminiCallAllowed === true);
const holdCases = (input.cases || []).filter((item) => item.execution?.geminiCallAllowed !== true);
const pagesFor = (item) => item.sources || (item.snapshots || []).map((snapshot) => ({
  sourceId: snapshot.snapshotId,
  snapshotId: snapshot.snapshotId,
  url: snapshot.source?.finalUrl || snapshot.source?.originalUrl || '',
  title: snapshot.source?.title || '',
  pageText: snapshot.body?.text || '',
  body: snapshot.body,
  relevantSegments: snapshot.relevantSegments || [],
  publishedAt: snapshot.source?.publishedAt || null,
}));
const sensitivePattern = /(?:api[_ -]?key|access[_ -]?token|secret|password|passwd|client[_ -]?secret)\s*[:=]\s*[^\s,;]+|(?:AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{16,}|gh[pousr]_[0-9A-Za-z_]{20,})|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:authorization|x-api-key)\s*:\s*bearer?\s+[^\s]+/i;
function preflight(item) {
  const pages = pagesFor(item);
  const failures = [];
  if (!item.question || !(item.requiredAnswerItems || []).length) failures.push('required-answer-items-missing');
  if (!pages.length) failures.push('official-snapshot-missing');
  for (const page of pages) {
    const body = String(page.pageText ?? page.body?.text ?? '');
    if (!page.snapshotId || !page.sourceId || page.sourceId !== page.snapshotId) failures.push(`snapshot-id-url-link-missing:${page.url || 'unknown'}`);
    if (!body || page.body?.truncated === true && !Array.isArray(page.relevantSegments)) failures.push(`body-snapshot-missing:${page.url || 'unknown'}`);
    if (!classifyOfficialSource(page.url)) failures.push(`official-source-required:${page.url || 'unknown'}`);
    if (sensitivePattern.test(body)) failures.push(`sensitive-content:${page.url || 'unknown'}`);
    const segments = Array.isArray(page.relevantSegments) ? page.relevantSegments : [];
    if (!segments.length) failures.push(`related-segment-missing:${page.url || 'unknown'}`);
    for (const segment of segments) {
      const start = segment.sourceSpan?.start ?? segment.start;
      const end = segment.sourceSpan?.end ?? segment.end;
      if (!Number.isInteger(start) || !Number.isInteger(end) || body.slice(start, end) !== segment.text) failures.push(`utf16-source-span-mismatch:${page.url || 'unknown'}`);
    }
  }
  try { buildEvidenceExtractionInput(item.question, pages, { requiredAnswerItems: item.requiredAnswerItems, referenceTime: input.referenceTime }); } catch { failures.push('extraction-input-build-failed'); }
  return { ok: failures.length === 0, failures };
}
const preflights = new Map((input.cases || []).map((item) => [item.id, preflight(item)]));
const callableAfterPreflight = callable.filter((item) => preflights.get(item.id)?.ok);
const preflightHolds = callable.filter((item) => !preflights.get(item.id)?.ok);
const runA = async (item) => runGeneralSearchPipeline(item.sourceQuestion || item.question, { candidates: pagesFor(item), maxReads: pagesFor(item).length, now: input.referenceTime });
if (process.argv.includes('--dry-run')) {
  const rows = callableAfterPreflight.slice(0, Math.min(maxApiCalls, requestedLimit)).map((item) => ({ id: item.id, question: item.question, officialUrls: pagesFor(item).map((page) => page.url), requiredAnswerItems: item.requiredAnswerItems || [], plannedHttpCalls: 1, status: 'ready', preflight: preflights.get(item.id) }));
  const holds = [...holdCases, ...preflightHolds].map((item) => ({ id: item.id, question: item.question, plannedHttpCalls: 0, status: 'hold', reason: preflights.get(item.id)?.ok === false ? preflights.get(item.id).failures : (item.execution?.reason || 'not-callable') }));
  console.log(JSON.stringify({ dryRun: true, inputFile, noWebSearch: true, webHttpRequests: 0, noHoldout: true,
    developmentQuestionDenominator: input.developmentQuestionDenominator ?? null, retryCalls: 0, fallbackCalls: 0,
    apiKeyConfigured: Boolean(envValues.GEMINI_API_KEYS || envValues.GEMINI_API_KEY), questionCount: rows.length, holdQuestionCount: holds.length, maxApiCalls, plannedCalls: rows.length, cases: rows, holds }, null, 2));
  process.exit(0);
}
for (const name of allowed) if (envValues[name] !== undefined) process.env[name] = envValues[name];
const extractor = createGeminiEvidenceExtractor({ maxAttempts: 1, maxCalls: maxApiCalls });
const started = Date.now();
const results = [];
for (const item of callableAfterPreflight.slice(0, Math.min(maxApiCalls, requestedLimit))) {
  const caseStarted = Date.now();
  const a = await runGeneralSearchPipeline(item.sourceQuestion || item.question, { candidates: pagesFor(item), maxReads: pagesFor(item).length, now: input.referenceTime,
    readPage: () => { throw new Error('Network page reads are disabled in this experiment'); } });
  const before = extractor.getMetrics().calls;
  const b = await extractor({ question: item.question, pages: pagesFor(item), referenceTime: input.referenceTime, requiredAnswerItems: item.requiredAnswerItems || a.answerRequirements.required });
  const after = extractor.getMetrics().calls;
  const verifiedFacts = (b.facts || []).filter((fact) => fact.status === 'verified');
  const assessment = assessFocusedCase(item, b.facts || [], assessRequiredAnswerItems(item.question, b.facts || [], { referenceTime: input.referenceTime }));
  results.push({ id: item.id, question: item.question, sourceQuestion: item.sourceQuestion || item.question, httpCalls: after - before, model: b.model || extractor.getMetrics().model, processingMs: Date.now() - caseStarted, inputTokens: b.usage?.promptTokenCount ?? null, outputTokens: b.usage?.candidatesTokenCount ?? null, methodA: { storedReport: storedAByQuestion.get(item.sourceQuestion || item.question) || null, replay: { facts: a.evidence.facts, verifiedFacts: a.evidence.verified, status: a.evidence.status, answerRequirements: a.answerRequirements } }, evaluation: { responseSchemaValid: b.responseSchemaValid === true, candidateFactCount: (b.facts || []).length, verifiedFactCount: verifiedFacts.length, structuralSemanticPassCount: verifiedFacts.filter((fact) => fact.semanticSupport === true).length, officialSourceSatisfied: assessment.officialSatisfied, satisfiedAnswerItems: assessment.satisfied, missingAnswerItems: assessment.missing, outcome: assessment.outcome, independentAccuracy: null }, methodB: { ...b, facts: b.facts || [], verifiedFacts } });
}
const metrics = extractor.getMetrics();
const report = { version: 3, experiment: 'general-search-llm-direct-extraction-final', generatedAt: new Date().toISOString(), inputFile, aReportFile, aReportFound: Boolean(storedA.results?.length), envFile, questionCount: callableAfterPreflight.length, holdQuestionCount: holdCases.length + preflightHolds.length, maxApiCalls, calls: metrics.calls, model: metrics.model, apiKeyConfigured: metrics.enabled, elapsedMs: Date.now() - started, results, holds: [...holdCases, ...preflightHolds].map((item) => ({ id: item.id, question: item.question, httpCalls: 0, finalOutcome: 'hold', reason: preflights.get(item.id)?.ok === false ? preflights.get(item.id).failures : (item.execution?.reason || 'not-callable') })), evaluation: { independentAnswerLabels: false, note: '모델 승인 자체는 정답이 아니다. 독립 검토 전 판정은 unreviewed.', totals: { candidateFactCount: results.reduce((n, r) => n + (r.evaluation?.candidateFactCount || 0), 0), verifiedFactCount: results.reduce((n, r) => n + (r.evaluation?.verifiedFactCount || 0), 0), structuralSemanticPassCount: results.reduce((n, r) => n + (r.evaluation?.structuralSemanticPassCount || 0), 0), complete: results.filter((r) => r.evaluation?.outcome === 'complete').length, partial: results.filter((r) => r.evaluation?.outcome === 'partial').length, hold: results.filter((r) => r.evaluation?.outcome === 'hold').length, inputTokens: results.reduce((n, r) => n + (r.inputTokens || 0), 0) || null, outputTokens: results.reduce((n, r) => n + (r.outputTokens || 0), 0) || null, independentAccuracy: null } } };
let serialized = JSON.stringify(report, null, 2);
for (const key of ['GEMINI_API_KEYS', 'GEMINI_API_KEY']) for (const secret of String(envValues[key] || '').split(',').map((v) => v.trim()).filter(Boolean)) serialized = serialized.split(secret).join('[REDACTED]');
try { await fs.access(outputFile); throw new Error(`Refusing to overwrite existing report: ${outputFile}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.writeFile(outputFile, `${serialized}\n`, 'utf8');
console.log(JSON.stringify({ outputFile, questionCount: report.questionCount, calls: report.calls, maxApiCalls, elapsedMs: report.elapsedMs }, null, 2));
