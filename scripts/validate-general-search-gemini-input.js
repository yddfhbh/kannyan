#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildEvidenceExtractionInput } from '../src/general-search-llm-extraction.js';
import { classifyOfficialSource, understandSearchQuestion, requestedAnswerRequirements } from '../src/general-search-pipeline.js';
import { selectRelevantSourceSpans } from '../src/general-search-source-selection.js';

const root = process.cwd();
const arg = (name, fallback) => process.argv.find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const inputFile = arg('--input', 'tmp/general-search-gemini-experiment-input-20261024-final-validation.json');
const bodiesFile = arg('--bodies', 'tmp/general-search-bodies-final-semantic.json');
const researchFile = arg('--research', 'tmp/general-search-source-research-offline-report-20261024-v2.json');
const outputFile = arg('--output', 'tmp/general-search-gemini-final-input-validation-20261024.json');
const read = async (file) => JSON.parse(await fs.readFile(path.resolve(root, file), 'utf8'));
const [input, bodies, research] = await Promise.all([read(inputFile), read(bodiesFile), read(researchFile)]);
const bodyCases = new Map((bodies.cases || []).map((item) => [item.question, item]));
const researchText = JSON.stringify(research);
const targets = {
  kubernetes: [
    'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/',
    'https://kubernetes.io/docs/concepts/workloads/pods/probes/',
  ],
  react: ['https://react.dev/blog/2025/10/01/react-19-2'],
  mdn: [
    'https://developer.mozilla.org/ko/docs/Web/API/Window/fetch',
    'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
    'https://developer.mozilla.org/en-US/docs/Web/API/AbortController',
    'https://developer.mozilla.org/en-US/docs/Web/API/AbortController/signal',
  ],
  aws: ['https://aws.amazon.com/ko/lambda/pricing/'],
};
const targetFor = (url) => Object.values(targets).flat().find((candidate) => candidate === url) || url;
const bodyText = (page) => String(page?.body ?? page?.pageText ?? page?.text ?? '');
const questionStatus = (item, stored) => {
  const pages = item.sources || [];
  const selectedUrls = new Set(pages.map((p) => p.url));
  const candidates = stored?.candidates || [];
  const reads = stored?.reads || [];
  const sourceRows = pages.map((page) => {
    const body = bodyText(page);
    const span = selectRelevantSourceSpans(item.sourceQuestion || item.question, { ...page, pageText: body });
    const spanText = span.blocks.map((b) => b.text).join('\n');
    const relevantWords = item.question.match(/[A-Za-z][A-Za-z0-9.-]{2,}|[가-힣]{2,}/g) || [];
    const coreWords = [...new Set(relevantWords.filter((word) => !/^(공식|문서|최신|사용법|설명|요금|버전|기능|비교)$/u.test(word)))];
    return {
      url: page.url, selected: selectedUrls.has(page.url), official: classifyOfficialSource(page.url),
      bodySnapshotExists: Boolean(body.trim()), bodyLength: body.length,
      truncation: body.length >= 7900 ? 'unknown-near-8000-limit' : 'not-observed',
      normalizedBody: Boolean(body), sourceSpanBasis: 'body.text; identical to extractPageEvidence.body',
      relevantSegmentLength: spanText.length, relevantSegmentTokenEstimate: 'unknown',
      relevantSegmentHasCoreTerms: coreWords.some((word) => spanText.toLocaleLowerCase().includes(word.toLocaleLowerCase())),
      relevantSegmentCount: span.blocks.length,
      geminiInputMode: 'full-page-blocks; source-selection spans are not passed as bounded segments',
    };
  });
  const required = requestedAnswerRequirements(understandSearchQuestion(item.sourceQuestion || item.question, input.referenceTime));
  const officialCount = sourceRows.filter((r) => r.official && r.bodySnapshotExists).length;
  const bodyCount = sourceRows.filter((r) => r.bodySnapshotExists).length;
  const hasRequiredOfficial = officialCount > 0;
  const insuff = !bodyCount || (required.length > 0 && !hasRequiredOfficial && /공식|최신|비교|요금|문서/u.test(item.question));
  return {
    id: item.id, originalQuestion: item.sourceQuestion || item.question, requiredAnswerItems: required,
    selectedOriginalUrls: pages.map((p) => p.url),
    officiality: { selectedOfficialBodyCount: officialCount, officialEvidenceSufficient: hasRequiredOfficial },
    sources: sourceRows,
    gemini: { sourceUrlsActuallyPassed: pages.map((p) => p.url), relatedSegmentsPassedAsSegments: false, fullBodyContainsRelatedText: sourceRows.some((r) => r.relevantSegmentLength > 0), inputTokens: 'unknown', outputTokens: 'unknown', cost: 'unknown' },
    latestnessRequired: /최신|최근|현재|이번|오늘|내일/u.test(item.question),
    execution: { evidenceStatus: insuff ? 'insufficient-evidence' : 'available-for-dry-run', experimentCallAllowed: true, answerOutcome: insuff ? 'hold' : 'partial' },
    sourceDiscoveryAudit: pages.map((p) => ({ url: p.url, candidateFoundInFinalBodies: candidates.some((c) => c.url === p.url), selectedInFinalInput: true, bodySnapshotExists: Boolean(bodyText(p).trim()) })),
  };
};
const cases = (input.cases || []).map((item) => questionStatus(item, bodyCases.get(item.sourceQuestion || item.question)));
const targetAudit = Object.fromEntries(Object.entries(targets).map(([group, urls]) => [group, urls.map((url) => {
  const finalCandidate = (bodies.cases || []).flatMap((c) => c.candidates || []).find((p) => p.url === url);
  const finalRead = (bodies.cases || []).flatMap((c) => c.reads || []).find((p) => p.url === url);
  return { url, discoveredInRecentResearch: researchText.includes(url), discoveredInFinalCandidates: Boolean(finalCandidate), selectedInFinalGeminiInput: cases.some((c) => c.selectedOriginalUrls.includes(url)), bodySnapshotExists: Boolean(bodyText(finalRead)), bodyLength: bodyText(finalRead).length, near8000: bodyText(finalRead).length >= 7900, official: classifyOfficialSource(url), status: finalRead ? 'snapshot-present' : 'missing-from-final-snapshot' };
})]));
const report = {
  version: 1, generatedAt: new Date().toISOString(), noWebSearch: true, noGeminiCalls: true, noHoldout: true,
  inputFile, bodiesFile, researchFile, maxQuestions: 6, maxGeminiCalls: 6, actualGeminiCalls: 0,
  tokenUsage: { input: 'unknown', output: 'unknown', cost: 'unknown', reason: 'No tokenizer or model response was used in dry-run' },
  targetUrlAudit: targetAudit, cases,
  integrationAudit: {
    prepareUsesFinalBodies: input.sourceBodies === bodiesFile || String(input.sourceBodies).endsWith(bodiesFile),
    prepareUsesSnapshotSelection: false,
    runnerUsesPreparedSources: true,
    runnerUsesRelatedSegments: false,
    extractionAndQuoteValidationImplemented: true,
    semanticValidationImplemented: true,
    independentMeaningReviewImplemented: false,
    completePartialHoldConnected: true,
    overall: 'partial: snapshot and extraction/validation exist, but bounded source-selection segments and independent semantic review are not connected in the runner',
  },
  sensitiveDetection: {
    githubActionsBlockPreserved: true, actualSecretValuesIncluded: false,
    ruleTypes: ['credential assignment (API key/access token/secret/password/client secret)', 'provider key prefix', 'PEM private key header', 'Authorization or x-api-key bearer header'],
    falsePositiveRisk: 'possible: generic documentation words can trigger only when followed by an assignment-like value; review blocked source manually without exposing the value',
  },
  sshCommand: 'ssh <user>@<host> "cd /home/ubuntu/discord-bot-new && GEMINI_API_KEYS=\"<redacted>\" node scripts/run-general-search-gemini-experiment.js --input=<absolute-path-to-this-worktree>/tmp/general-search-gemini-experiment-input-20261024-final-validation.json --output=<absolute-path-to-this-worktree>/tmp/general-search-gemini-experiment-run-20261024-final.json --limit=6"',
  note: 'The SSH command is a template with a redacted key placeholder; do not print or store a personal API key. Actual execution remains disabled for this validation.',
};
await fs.writeFile(path.resolve(root, outputFile), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputFile, cases: cases.length, actualGeminiCalls: 0, targetGroups: Object.keys(targetAudit).length }, null, 2));
