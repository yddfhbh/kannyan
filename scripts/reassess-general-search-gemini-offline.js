#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyOfficialSource, understandSearchQuestion } from '../src/general-search-pipeline.js';
import { assessRequiredAnswerItems, validateExtractedEvidenceFact } from '../src/general-search-llm-extraction.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const runFile = arg('--run', path.join(root, 'tmp/general-search-gemini-experiment-run-20261024T015845Z.json'));
const inputFile = arg('--input', path.join(root, 'tmp/general-search-gemini-experiment-input-20261024-ab.json'));
const outputFile = arg('--output', path.join(root, `tmp/general-search-offline-reassessment-${new Date().toISOString().replace(/[-:.TZ]/g, '')}.json`));
const previousFile = arg('--previous', path.join(root, 'tmp/general-search-offline-reassessment-20261024-source-span-final-5.json'));
const independentFile = arg('--independent', path.join(root, 'tmp/general-search-independent-review-ledger-20261024-semantic-consistent-final.json'));
const run = JSON.parse(await fs.readFile(runFile, 'utf8'));
const input = JSON.parse(await fs.readFile(inputFile, 'utf8'));
const independent = JSON.parse(await fs.readFile(independentFile, 'utf8'));
const independentById = new Map((independent.cases || []).map((item) => [item.id, item]));
const inputById = new Map((input.cases || []).map((item) => [item.id, item]));

function semanticReview(question, fact, structural) {
  const q = String(question);
  const text = `${fact.subject || ''} ${fact.relation || ''} ${fact.value || ''} ${fact.quote || ''}`;
  const reasons = [];
  if (!structural.semanticSupport) reasons.push(...(structural.semanticValidationFailures || []));
  if (/최신 안정 버전/.test(q) && !/공식|python\.org/i.test(fact.sourceUrl || '')) reasons.push('installation-article-is-not-current-official-version-evidence');
  if (/최신 버전/.test(q) && !classifyOfficialSource(fact.sourceUrl)) reasons.push('latest-version-official-source-required');
  if (/React/.test(q) && (!fact.sourceUrl || !fact.quote)) reasons.push('react-source-claim-not-grounded');
  const hardReasons = reasons.filter((reason) => !reason.startsWith('field-not-supported-by-quote:'));
  const status = hardReasons.length ? (/공식|최신|React/.test(q) ? 'unsupported' : 'needs-review') : 'supported';
  return { status, supported: status === 'supported', reasons, hardReasons };
}

const cases = (run.results || []).map((row) => {
  const item = inputById.get(row.id);
  const originalQuestion = item?.sourceQuestion || row.question;
  const independentCase = independentById.get(row.id) || null;
  const pages = item?.sources || [];
  const structuralFacts = (row.methodB?.facts || []).map((fact) => validateExtractedEvidenceFact(fact, pages));
  const factRows = structuralFacts.map((fact) => {
    const semantic = semanticReview(originalQuestion, fact, fact);
    const sourcePage = pages.find((page) => page.url === fact.sourceUrl);
    const sourceBody = String(sourcePage?.pageText || sourcePage?.text || '');
    const boundedContext = fact.sourceSpan ? sourceBody.slice(Math.max(0, fact.sourceSpan.start - 180), Math.min(sourceBody.length, fact.sourceSpan.end + 180)) : fact.quote;
    return {
    subject: fact.subject, relation: fact.relation, value: fact.value, unit: fact.unit, quote: fact.quote, sourceUrl: fact.sourceUrl, status: fact.status,
    sourceUrlExists: pages.some((page) => page.url === fact.sourceUrl),
    quoteInSource: fact.quoteOccurrenceCount > 0,
    quoteOccurrenceCount: fact.quoteOccurrenceCount,
    spanRestored: Boolean(fact.sourceSpan) && fact.sourceSpanOrigin === 'quote-search',
    restoredSpan: fact.sourceSpan,
    sourceSliceMatches: Boolean(fact.sourceSpan) && fact.validationFailures?.includes('source-span-mismatch') !== true,
    structuralStatus: fact.status,
    structuralFailures: fact.validationFailures || [],
    boundedContext,
    semantic,
    semanticSupport: semantic.status === 'supported',
    officialSource: classifyOfficialSource(fact.sourceUrl),
    officialSourceRequired: /공식|최신 버전|최신 안정 버전/i.test(originalQuestion),
    };
  });
  const structurallyVerified = factRows.filter((fact) => fact.structuralStatus === 'verified');
  // Field-substring support is only a deterministic signal. A paraphrased
  // relation/value still needs semantic review, but it can be retained as a
  // partial candidate when the quote and provenance are sound.
  const semanticallySupported = structurallyVerified.filter((fact) => fact.semantic.supported);
  const answerRequirements = assessRequiredAnswerItems(originalQuestion, semanticallySupported, { understanding: understandSearchQuestion(originalQuestion, input.referenceTime), requirementQuestion: originalQuestion });
  const officialSourceRequired = /공식|최신 버전|최신 안정 버전/i.test(originalQuestion);
  const officialSourceSatisfied = answerRequirements.officialSatisfied;
  const semanticStatuses = factRows.map((fact) => fact.semantic.status);
  const meaningful = answerRequirements.answerEligible?.length > 0 && !answerRequirements.policyHold;
  const completeEligible = answerRequirements.missing.length === 0 && meaningful && factRows.every((fact) => fact.structuralStatus !== 'verified' || fact.semantic.status === 'supported') && (!officialSourceRequired || officialSourceSatisfied);
  const outcome = completeEligible ? 'complete' : meaningful ? 'partial' : 'hold';
  const potentialCoverage = answerRequirements.required.length ? answerRequirements.satisfied.filter((x) => answerRequirements.required.includes(x)).length / answerRequirements.required.length : 0;
  const answerEligibleUrls = new Set((answerRequirements.answerEligible || []).map((fact) => fact.sourceUrl));
  const referenceOnlyUrls = new Set((answerRequirements.referenceOnly || []).map((fact) => fact.sourceUrl));
  return { id: row.id, question: row.question, originalQuestion, independentReview: independentCase ? { sourceFile: independentFile, label: independentCase.label || 'unreviewed', factCount: (independentCase.facts || []).length } : null, existing: { candidateCount: row.methodB.facts.length, passedCount: row.methodB.verifiedFacts.length, failures: row.methodB.facts.flatMap((fact) => fact.validationFailures || []) }, facts: factRows.map((fact) => ({ ...fact, provenanceClass: referenceOnlyUrls.has(fact.sourceUrl) ? 'reference-only' : answerEligibleUrls.has(fact.sourceUrl) ? 'answer-eligible' : 'unusable' })),
    quoteLocationRestoredCount: factRows.filter((fact) => fact.spanRestored).length,
    structuralValidationSuccessCount: structurallyVerified.length,
    semanticValidationAdditionalCount: structurallyVerified.filter((fact) => fact.semantic.status !== 'supported').length,
    semanticStatusCounts: Object.fromEntries(['supported', 'unsupported', 'needs-review'].map((status) => [status, semanticStatuses.filter((value) => value === status).length])),
    officialSource: { required: officialSourceRequired, satisfied: officialSourceSatisfied }, answerRequirements,
    coverage: { verifiedCoverage: completeEligible ? 1 : 0, potentialCoverage },
    outcome, rationale: outcome === 'complete' ? '의미·출처·필수 항목이 모두 확정됨' : outcome === 'partial' ? '검증된 일부 사실은 보존하지만 필수 항목·공식성·의미 검토가 남음' : '근거·공식성·출처 위치 중 하나 이상이 답변을 보류시킴',
    evaluationMetrics: { quoteStructureValidated: factRows.some((fact) => fact.structuralStatus === 'verified'), claimSupportedByQuote: factRows.some((fact) => fact.structuralStatus === 'verified' && fact.semantic.status === 'supported'), policySatisfied: !answerRequirements.policyHold, answerEligible: meaningful, questionComplete: completeEligible, independentFactAccuracy: null } };
});

const counts = (predicate) => cases.reduce((sum, item) => sum + (predicate(item) ? 1 : 0), 0);
let previous = null;
try { previous = JSON.parse(await fs.readFile(previousFile, 'utf8')); } catch { previous = null; }
const beforeAfter = previous ? {
  previousFile,
  before: { outcomes: { complete: (previous.cases || []).filter((c) => c.outcome === 'complete').length, partial: (previous.cases || []).filter((c) => c.outcome === 'partial').length, hold: (previous.cases || []).filter((c) => c.outcome === 'hold').length },
    candidateCount: (previous.cases || []).reduce((n, c) => n + (c.facts || []).length, 0),
    potentiallyCompleteAnswerCases: (previous.cases || []).filter((c) => c.answerRequirements?.outcome === 'complete').length },
  after: { outcomes: { complete: counts((c) => c.outcome === 'complete'), partial: counts((c) => c.outcome === 'partial'), hold: counts((c) => c.outcome === 'hold') }, candidateCount: cases.reduce((n, c) => n + c.facts.length, 0), verifiedCoverage: cases.reduce((n, c) => n + c.coverage.verifiedCoverage, 0) / Math.max(1, cases.length), potentialCoverage: cases.reduce((n, c) => n + c.coverage.potentialCoverage, 0) / Math.max(1, cases.length) },
} : null;
const report = { version: 2, type: 'offline-general-search-gemini-reassessment', generatedAt: new Date().toISOString(), noApiCalls: true, noWebSearch: true, independentReviewFile: independentFile, runFile, inputFile, cases,
  comparison: { existingBCandidateCount: cases.reduce((n, c) => n + c.existing.candidateCount, 0), existingBPassed: cases.reduce((n, c) => n + c.existing.passedCount, 0), quoteLocationRestored: cases.reduce((n, c) => n + c.quoteLocationRestoredCount, 0), structuralValidationSuccess: cases.reduce((n, c) => n + c.structuralValidationSuccessCount, 0), semanticValidationAdditional: cases.reduce((n, c) => n + c.semanticValidationAdditionalCount, 0), officialSourceHold: counts((c) => c.outcome === 'hold' && c.officialSource.required && !c.officialSource.satisfied), preservedNormalFacts: cases.reduce((n, c) => n + c.facts.filter((f) => f.structuralStatus === 'verified' && f.semantic.supported).length, 0), rejectedUnrelatedOrUnsupportedFacts: cases.reduce((n, c) => n + c.facts.filter((f) => f.structuralStatus !== 'verified' || !f.semantic.supported).length, 0), requiredAnswerSatisfaction: cases.map((c) => ({ id: c.id, question: c.question, required: c.answerRequirements.required, satisfied: c.answerRequirements.satisfied, missing: c.answerRequirements.missing, rate: c.answerRequirements.required.length ? c.answerRequirements.satisfied.filter((x) => c.answerRequirements.required.includes(x)).length / c.answerRequirements.required.length : 0 })), evaluationMetrics: { quoteStructureValidated: cases.filter((c) => c.evaluationMetrics.quoteStructureValidated).length, claimSupportedByQuote: cases.filter((c) => c.evaluationMetrics.claimSupportedByQuote).length, officialFreshnessPolicySatisfied: cases.filter((c) => c.evaluationMetrics.policySatisfied).length, answerEligible: cases.filter((c) => c.evaluationMetrics.answerEligible).length, questionComplete: cases.filter((c) => c.evaluationMetrics.questionComplete).length, independentFactAccuracy: null }, finalOutcomes: { complete: counts((c) => c.outcome === 'complete'), partial: counts((c) => c.outcome === 'partial'), hold: counts((c) => c.outcome === 'hold') } },
  beforeAfter,
  consistency: { semanticFieldsUseSingleStatus: true, semanticContradictions: cases.flatMap((c) => c.facts.filter((f) => f.semantic.status === 'supported' ? f.semanticSupport !== true : f.semanticSupport === true).map((f) => `${c.id}:${f.sourceUrl}`)), completeWithUnmetOfficialOrSemanticRequirement: cases.filter((c) => c.outcome === 'complete' && (c.answerRequirements.missing.length || (c.officialSource.required && !c.officialSource.satisfied) || c.facts.some((f) => f.structuralStatus === 'verified' && f.semantic.status !== 'supported'))).map((c) => c.id) },
  notes: ['requiredAnswerItems는 모델 반환 배열을 사용하지 않고 원래 질문과 재검증된 facts로 다시 매핑했다.', 'quote 위치 복원 성공은 의미 검증 성공으로 집계하지 않았다.', 'verifiedCoverage는 의미·출처·필수 항목이 확정된 경우만 포함하고 potentialCoverage는 미확정 후보를 별도 표시한다.', '독립 정답 라벨이 없으므로 실제 정확도 점수는 산출하지 않았다.'] };
try { await fs.access(outputFile); throw new Error(`Refusing to overwrite existing report: ${outputFile}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ outputFile, noApiCalls: true, candidates: report.comparison.existingBCandidateCount, outcomes: report.comparison.finalOutcomes }, null, 2));
