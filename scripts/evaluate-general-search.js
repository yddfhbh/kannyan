import fs from 'node:fs/promises';
import { searchWeb } from '../src/web-search.js';
import { runGeneralSearchPipeline } from '../src/general-search-pipeline.js';
import { createGeminiFactReviewer } from '../src/general-search-gemini.js';

const args = new Set(process.argv.slice(2));
const live = args.has('--live');
const useGemini = args.has('--gemini');
const holdout = args.has('--holdout');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = Math.max(1, Number(limitArg?.slice(8) || (live ? 4 : 999)));
// Only a positional JSON argument is a fixture. Report/input options also end
// in .json and must never replace the selected question set.
const fixturePath = process.argv.find((arg) => arg.endsWith('.json')
  && !arg.startsWith('--report=') && !arg.startsWith('--saved-report='))
  || 'test/fixtures/general-search-evaluation.json';
const cachePath = process.env.GENERAL_SEARCH_CACHE || 'tmp/general-search-web-cache.json';
const diagnosticPath = process.env.GENERAL_SEARCH_DIAGNOSTICS || 'tmp/general-search-web-diagnostics.json';
const bodyPath = process.env.GENERAL_SEARCH_BODIES || '';
const reportPath = process.env.GENERAL_SEARCH_REPORT || process.argv.find((arg) => arg.startsWith('--report='))?.slice(9) || '';
const savedReportPath = process.argv.find((arg) => arg.startsWith('--saved-report='))?.slice(15) || '';
const labelPath = process.env.GENERAL_SEARCH_LABELS || 'test/fixtures/general-search-labels.json';
const now = process.env.GENERAL_SEARCH_NOW || new Date().toISOString();

async function readJson(path, fallback) { try { return JSON.parse(await fs.readFile(path, 'utf8')); } catch { return fallback; } }
async function writeJson(path, value) { await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function classifyLegacy(sources) {
  const usable = sources.filter((source) => String(source.pageText || source.text || '').trim());
  return { status: usable.length ? 'retrieved' : 'no-evidence', citations: usable.slice(0, 3).map((s) => ({ url: s.url, title: s.title })) };
}

const savedReport = savedReportPath ? await readJson(savedReportPath, {}) : null;
const replayInputPath = savedReport?.inputFile && !fixturePath.endsWith('general-search-evaluation.json') ? savedReport.inputFile : savedReport?.inputFile;
const fixture = await readJson(replayInputPath || fixturePath, { cases: [] });
const labels = await readJson(labelPath, { cases: [] });
const labelsByQuestion = new Map((labels.cases || []).map((item) => [item.question, item]));
let cases = fixture.cases || [];
if (live) {
  const questionFile = holdout ? 'test/fixtures/general-search-holdout.json' : 'test/fixtures/general-search-questions.json';
  cases = (await readJson(questionFile, { questions: [] })).questions.map((question, index) => ({ id: `live-${index + 1}`, question }));
}
cases = cases.slice(0, limit);
const cache = await readJson(cachePath, { version: 1, capturedAt: null, now, cases: {} });
if (!cache.cases) cache.cases = {};
const reviewer = useGemini ? createGeminiFactReviewer({ maxAttempts: 1, maxCalls: 12 }) : null;
const results = [];
const diagnostics = [];
const bodyRecords = [];

for (const item of cases) {
  let sources = item.sources || item.pages || [];
  let retrieval = { searches: 0, reads: 0, httpRequests: 0, cached: false };
  if (live) {
    const cached = cache.cases[item.question];
    if (cached?.sources?.length) { sources = cached.sources; retrieval = { ...cached.retrieval, cached: true }; }
  }
  const started = Date.now();
  let searchCalls = 0;
  const referenceTime = item.referenceTime || item.sources?.[0]?.referenceTime || now;
  const prototype = await runGeneralSearchPipeline(item.question, {
    ...(sources.length ? { candidates: sources } : { search: async (query) => { searchCalls += 1; return searchWeb(query, { maxResults: 8, timeoutMs: 8000 }); } }),
    now: referenceTime, maxReads: 4, ...(reviewer ? { semanticReview: reviewer } : {})
  });
  const searchAttempts = prototype.diagnostics.search?.attempts || [];
  const readAttempts = prototype.diagnostics.reads || [];
  retrieval = { ...retrieval, searches: searchCalls, reads: readAttempts.filter((r) => r.attempted).length,
    httpRequests: searchAttempts.length + readAttempts.filter((r) => r.attempted).length,
    searchStatus: prototype.diagnostics.search?.status || (searchCalls ? 'no-search-diagnostics' : 'cached-or-fixture'),
    searchAttempts,
    failures: readAttempts.filter((r) => r.status === 'failed').map((r) => ({ url: r.url, code: r.httpStatus || r.errorType })) };
  const ids = prototype.evidence.facts.map((fact) => fact.id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  const semanticIds = prototype.semanticReview ? [...(prototype.semanticReview.approveFactIds || []), ...(prototype.semanticReview.rejectFactIds || [])] : [];
  const mappingErrors = prototype.semanticReview ? semanticIds.filter((id, index) => !ids.includes(id) || semanticIds.indexOf(id) !== index).length + ids.filter((id) => !semanticIds.includes(id)).length : 0;
  const accepted = prototype.evidence.verified;
  const candidateDiagnostics = prototype.diagnostics.candidates || [];
  const readDiagnostics = prototype.diagnostics.reads || [];
  const extractedBodies = readDiagnostics.filter((read) => read.bodyLength > 0).length;
  const selectedCandidates = candidateDiagnostics.filter((candidate) => candidate.selected);
  const label = labelsByQuestion.get(item.question) || { status: '미평가', facts: [] };
  const failureCount = (name) => prototype.evidence.facts.filter((fact) => fact.status !== 'verified' && fact.validationFailures?.includes(name)).length;
  const factSourceUrls = new Set(prototype.evidence.facts.map((fact) => fact.sourceUrl));
  const relevantReadWithoutFact = (prototype.pages || []).filter((page) => {
    if (factSourceUrls.has(page.url)) return false;
    const body = String(page.pageText || page.text || '');
    const queryTokens = prototype.plan.understanding.target.filter((token) => token.length >= 2);
    return body && queryTokens.some((token) => body.toLocaleLowerCase().includes(token.toLocaleLowerCase()));
  }).map((page) => ({ url: page.url, title: page.title, label: 'unreviewed', note: '본문에 질문 토큰이 있으나 추출 사실이 없어 독립 원문 검토 필요' }));
  const structuralPassCount = prototype.evidence.facts.filter((fact) => fact.status === 'verified' || fact.verificationStage === 'structurally-verified').length;
  const structuralRejectedCount = prototype.evidence.facts.filter((fact) => fact.status !== 'verified').length;
  const semanticPendingCount = prototype.evidence.facts.filter((fact) => fact.status === 'verified' && fact.semanticRelevance !== 'reviewed').length;
  const holdReasons = [
    ...prototype.answerRequirements.missing.map((item) => `missing-answer-item:${item}`),
    ...(semanticPendingCount ? ['semantic-review-pending'] : []),
    ...(prototype.evidence.facts.length === 0 ? ['no-fact-candidate'] : []),
    ...(structuralRejectedCount ? ['structural-rejection-present'] : []),
  ];
  results.push({ id: item.id, question: item.question,
    legacy: item.baseline || classifyLegacy(sources),
    prototype: { status: prototype.evidence.status, answerStatus: prototype.answerRequirements.status, verifiedFacts: prototype.evidence.verified.length, partial: prototype.evidence.partial,
      answerRequirements: prototype.answerRequirements,
      facts: prototype.evidence.facts.map((fact) => ({ id: fact.id, status: fact.status, verificationStage: fact.verificationStage || (fact.status === 'verified' ? 'structurally-verified' : 'rejected'), semanticRelevance: fact.semanticRelevance || 'not-reviewed', claimType: fact.claimType, subject: fact.subject, predicate: fact.predicate, relation: fact.relation, value: fact.value, priceDetails: fact.priceDetails, normalizedQuantity: fact.normalizedQuantity, unit: fact.unit, targetDate: fact.targetDate, effectiveDate: fact.effectiveDate, targetLocation: fact.targetLocation, temporalResolutionConfidence: fact.temporalResolutionConfidence, publishedAt: fact.publishedAt, fetchedAt: fact.fetchedAt, preparedAt: fact.preparedAt, referenceTime: fact.referenceTime, attributes: fact.attributes, scopeText: fact.scopeText, contextSpan: fact.contextSpan, sourceSpan: fact.sourceSpan, quote: fact.quote, url: fact.sourceUrl, failures: fact.validationFailures })),
      citations: prototype.evidence.verified.map((fact) => ({ url: fact.sourceUrl, title: fact.sourceTitle })),
      metrics: { ...prototype.metrics, wallMs: Date.now() - started, httpRequests: retrieval.httpRequests } },
    retrieval, difference: prototype.evidence.verified.length ? 'prototype-has-verified-quote' : 'no-verified-quote', semanticReview: prototype.semanticReview,
    label: { status: label.status, independentlyReviewed: label.independentlyReviewed === true, facts: label.facts || [] },
    reassessment: {
      extractedFactCandidateCount: prototype.evidence.facts.length,
      structuralPassCount,
      semanticReviewPendingCount: semanticPendingCount,
      structuralRejectedCount,
      requiredAnswerItems: prototype.answerRequirements.required,
      securedAnswerItems: prototype.answerRequirements.satisfied,
      missingAnswerItems: prototype.answerRequirements.missing,
      evidencePresentButNotExtracted: relevantReadWithoutFact,
      holdReasons,
      note: 'evidencePresentButNotExtracted는 자동 정상 판정이 아니라 독립 검토 대기 후보다.',
    },
    quality: { candidateCount: candidateDiagnostics.length, selectedCandidateCount: selectedCandidates.length,
      maxModelCandidates: 12, candidatesOmittedByReadBudget: Math.max(0, candidateDiagnostics.length - selectedCandidates.length),
      bodyExtractionAttempted: readDiagnostics.filter((read) => read.attempted).length,
      bodyExtractionSucceeded: extractedBodies,
      bodyExtractionSuccessRate: readDiagnostics.length ? extractedBodies / readDiagnostics.length : null,
      boilerplateOrAdCandidateCount: candidateDiagnostics.filter((candidate) => candidate.signals?.titleNoise < 0).length,
      // Keep URL-host provenance separate from title/snippet/search wording.
      // A page saying “공식” is not an official host.
      officialHostCandidateCount: candidateDiagnostics.filter((candidate) => candidate.signals?.officialHost === true).length,
      officialTextSignalCandidateCount: candidateDiagnostics.filter((candidate) => candidate.signals?.officialTextSignal === true).length,
      officialSignalCandidateCount: candidateDiagnostics.filter((candidate) => candidate.signals?.officialHost === true).length,
      selectedUrls: selectedCandidates.map((candidate) => candidate.url).filter(Boolean) },
    evaluation: { duplicateIdCount: duplicateIds.length, mappingErrorCount: mappingErrors,
      duplicateEvidenceCount: prototype.evidence.facts.filter((fact) => fact.validationFailures?.includes('duplicate-evidence')).length,
      explicitlyVerifiedFacts: accepted.length,
      // No independent answer labels are available in this evaluator. Code
      // validation and factual correctness must never be conflated.
      clearlyWrongAcceptedFacts: null,
      codeDateIssueCount: failureCount('requested-date-not-in-scope') + failureCount('relative-date-mismatch') + failureCount('temporal-context-missing'),
      codeLocationIssueCount: failureCount('requested-location-not-in-scope'),
      codeSubjectValueMixCount: accepted.filter((fact) => fact.subject && fact.quote.match(/서울/) && fact.quote.match(/춘천|부산|제주/) && (fact.attributes || []).length > 1).length,
      unrelatedBodyAcceptedCount: accepted.filter((fact) => /(?:^|\s)(?:메뉴|광고|전화|이메일|상품)(?:$|\s)/i.test(fact.quote)).length,
      stageAQuotePresentCount: accepted.filter((fact) => fact.verificationStage === 'structurally-verified').length,
      semanticRelevanceReviewedCount: accepted.filter((fact) => fact.semanticRelevance === 'reviewed').length,
      structurallyVerifiedCount: accepted.filter((fact) => fact.verificationStage === 'structurally-verified').length,
      semanticallyVerifiedCount: accepted.filter((fact) => fact.verificationStage === 'semantically-verified').length,
      officialSourceRequiredFailureCount: failureCount('official-source-required'),
      extractedFactCandidateCount: prototype.evidence.facts.length,
      relationResolvedFactCount: prototype.evidence.facts.filter((fact) => fact.relation && fact.value).length,
      quotePresentCount: prototype.evidence.facts.filter((fact) => fact.validationFailures?.includes('quote-not-in-source') !== true).length,
      normalFactsRejected: prototype.evidence.facts.filter((fact) => fact.status !== 'verified' && fact.validationFailures?.length === 0).length,
      // Accuracy is intentionally calculated only for independently reviewed
      // labels. A code-pass is not an answer key.
      labeledAcceptedFacts: label.independentlyReviewed === true
        ? accepted.filter((fact) => (label.facts || []).some((expected) => expected.status === '근거에 의해 지지됨' && expected.quote === fact.quote)).length : null,
      labeledContradictionAcceptedFacts: label.independentlyReviewed === true
        ? accepted.filter((fact) => (label.facts || []).some((expected) => expected.status === '근거와 모순됨' && expected.quote === fact.quote)).length : null } });
  diagnostics.push({ id: item.id, question: item.question, retrieval, pipeline: prototype.diagnostics });
  bodyRecords.push({ id: item.id, question: item.question, search: prototype.diagnostics.search,
    candidates: candidateDiagnostics, reads: (prototype.pages || []).map((page) => ({
      url: page.url || '', title: page.title || '', status: page.status ?? null,
      canonicalUrl: page.canonicalUrl || '', redirectChain: page.redirectChain || [],
      body: String(page.pageText || page.text || '') })) });
  if (live && process.env.GENERAL_SEARCH_WRITE_CACHE === '1') {
    cache.cases[item.question] = { sources: prototype.pages || [], retrieval };
  }
}
// The historical cache is input-only by default. This prevents a sandbox or
// provider outage from becoming a durable empty-cache false negative.
if (live && process.env.GENERAL_SEARCH_WRITE_CACHE === '1') {
  if (!cache.capturedAt) cache.capturedAt = new Date().toISOString();
  await writeJson(cachePath, cache);
}
if (live) await writeJson(diagnosticPath, { version: 1, capturedAt: new Date().toISOString(), now, cases: diagnostics });
if (live && bodyPath) await writeJson(bodyPath, { version: 1, capturedAt: new Date().toISOString(), now, cases: bodyRecords });
const zeroCandidateAnalysis = results.filter((result) => result.prototype.facts.length === 0).map((result) => {
  const q = result.question;
  const retrieval = result.retrieval;
  const reason = retrieval.reads === 0 && retrieval.searches > 0 ? 'retrieval-no-pages'
    : result.quality.bodyExtractionSucceeded === 0 ? 'body-extraction-failed-or-empty'
      : 'extractor-overrestriction-or-no-matching-claim';
  return { id: result.id, question: q, cause: reason,
    retrieval: { searches: retrieval.searches, reads: retrieval.reads, httpRequests: retrieval.httpRequests },
    bodyExtractionSucceeded: result.quality.bodyExtractionSucceeded,
    semanticReview: result.semanticReview?.skipped || null,
    note: reason === 'extractor-overrestriction-or-no-matching-claim'
      ? '본문은 확보됐으나 현재 질문 유형의 관계·값 규칙과 맞는 후보를 만들지 못함'
      : '본문 후보가 없어 추출기 제한과 분리되는 검색/본문 확보 문제' };
});
const summary = { fixture: savedReportPath ? `replay:${savedReportPath}` : (live ? (holdout ? 'holdout-live' : 'development-live') : fixturePath), replayOf: savedReportPath || null, capturedAt: live ? cache.capturedAt : null, now, cases: results,
  comparison: { total: results.length, independentlyReviewedCases: results.filter((r) => r.label.independentlyReviewed).length,
    legacyRetrieved: results.filter((r) => r.legacy.status === 'retrieved' || r.legacy.evidence === 'verified').length,
    prototypeVerified: results.filter((r) => r.prototype.status === 'verified').length, prototypePartial: results.filter((r) => r.prototype.partial).length,
    structurallyVerifiedFacts: results.reduce((n, r) => n + r.evaluation.structurallyVerifiedCount, 0),
    semanticallyVerifiedFacts: results.reduce((n, r) => n + r.evaluation.semanticallyVerifiedCount, 0),
    unverifiedFacts: results.reduce((n, r) => n + r.prototype.facts.filter((f) => f.status !== 'verified').length, 0),
    duplicateIdCount: results.reduce((n, r) => n + r.evaluation.duplicateIdCount, 0),
    mappingErrorCount: results.reduce((n, r) => n + r.evaluation.mappingErrorCount, 0),
    explicitlyVerifiedFacts: results.reduce((n, r) => n + r.evaluation.explicitlyVerifiedFacts, 0),
    clearlyWrongAcceptedFacts: null,
    labeledAcceptedFacts: results.some((r) => r.label.independentlyReviewed) ? results.reduce((n, r) => n + (r.evaluation.labeledAcceptedFacts || 0), 0) : null,
    labeledContradictionAcceptedFacts: results.some((r) => r.label.independentlyReviewed) ? results.reduce((n, r) => n + (r.evaluation.labeledContradictionAcceptedFacts || 0), 0) : null,
    codeDateIssueCount: results.reduce((n, r) => n + r.evaluation.codeDateIssueCount, 0),
    codeLocationIssueCount: results.reduce((n, r) => n + r.evaluation.codeLocationIssueCount, 0),
    codeSubjectValueMixCount: results.reduce((n, r) => n + r.evaluation.codeSubjectValueMixCount, 0),
    unrelatedBodyAcceptedCount: results.reduce((n, r) => n + r.evaluation.unrelatedBodyAcceptedCount, 0),
    extractedFactCandidateCount: results.reduce((n, r) => n + r.evaluation.extractedFactCandidateCount, 0),
    relationResolvedFactCount: results.reduce((n, r) => n + r.evaluation.relationResolvedFactCount, 0),
    quotePresentCount: results.reduce((n, r) => n + r.evaluation.quotePresentCount, 0),
    officialSourceRequiredFailureCount: results.reduce((n, r) => n + r.evaluation.officialSourceRequiredFailureCount, 0),
    officialHostCandidateCount: results.reduce((n, r) => n + r.quality.officialHostCandidateCount, 0),
    officialTextSignalCandidateCount: results.reduce((n, r) => n + r.quality.officialTextSignalCandidateCount, 0),
    duplicateEvidenceCount: results.reduce((n, r) => n + r.evaluation.duplicateEvidenceCount, 0),
    normalFactsRejected: results.reduce((n, r) => n + r.evaluation.normalFactsRejected, 0),
    // Case status is intentionally independent from answer-requirement
    // completeness: the reassessment has 2 structurally verified cases, but
    // only one is partial. The remaining 10 are hold.
    answerOutcomes: { complete: results.filter((r) => r.prototype.status === 'verified' && !r.prototype.partial).length,
      partial: results.filter((r) => r.prototype.partial === true).length,
      hold: results.filter((r) => !(r.prototype.status === 'verified' && !r.prototype.partial) && !r.prototype.partial).length },
    failureReasons: Object.fromEntries(results.flatMap((r) => r.prototype.facts.flatMap((f) => f.failures || [])).reduce((m, reason) => m.set(reason, (m.get(reason) || 0) + 1), new Map())),
    conclusion: '코드 검증 통과 수치와 독립 정답 기반 사실 정확도를 분리함; 독립 검토가 끝나지 않은 항목은 정확도에서 제외', },
  zeroCandidateAnalysis,
  gemini: { ...(reviewer?.getMetrics?.() || { enabled: false, calls: 0 }),
    // The pipeline deliberately skips the reviewer when no rule candidate
    // exists. This is the measured execution plan, not the question count.
    expectedCallsWithoutExecution: results.filter((r) => r.prototype.facts.length > 0).length,
    skippedNoCandidateCount: results.filter((r) => r.prototype.facts.length === 0).length,
    estimatedInputTokens: results.filter((r) => r.prototype.facts.length > 0).reduce((n, r) => n + Math.min(12, r.prototype.facts.length) * 180, 0),
    estimatedOutputTokens: results.filter((r) => r.prototype.facts.length > 0).length * 120,
    estimatedCostUsd: null, costNote: '요금표 변동을 피하기 위해 단가가 제공되지 않으면 null; API 호출은 이번 평가에서 실행하지 않음' } };
if (reportPath) await writeJson(reportPath, summary);
console.log(JSON.stringify(summary, null, 2));
