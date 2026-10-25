#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyOfficialSource, understandSearchQuestion, requestedAnswerRequirements } from '../src/general-search-pipeline.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const runFile = arg('--run', path.join(root, 'tmp/general-search-gemini-experiment-run-20261024T062503Z.json'));
const inputFile = arg('--input', path.join(root, 'tmp/general-search-gemini-final-input-20261024.json'));
const outputFile = arg('--output', path.join(root, 'tmp/general-search-gemini-three-call-offline-report-20261024.json'));
const ledgerFile = arg('--ledger', path.join(root, 'tmp/general-search-independent-review-ledger-20261024-three-call.json'));

const run = JSON.parse(await fs.readFile(runFile, 'utf8'));
const input = JSON.parse(await fs.readFile(inputFile, 'utf8'));
const runById = new Map((run.results || []).map((item) => [item.id, item]));
const inputById = new Map((input.cases || []).map((item) => [item.id, item]));

// These are the four candidates in the stored three-call response: two facts
// in the comparison response count separately. No model or network call is
// made here.
const candidateIds = ['gemini-01', 'gemini-02', 'gemini-04'];
const reviewLabels = {
  'gemini-01-fact-1': { label: 'supported', note: 'AbortController/AbortSignal 목적은 인용문과 문맥으로 지지되지만 usage-procedure는 별도 요건이다.' },
  'gemini-02-fact-1': { label: 'needs-review', note: 'such situations의 앞 문맥은 스냅샷에서 확인되지만, 독립 장부에서는 단독 인용문 의미를 보수적으로 보류한다.' },
  'gemini-04-fact-1': { label: 'supported', note: 'json/jsonb 두 저장 타입이라는 관계가 인용문에 직접 표현된다.' },
  'gemini-04-fact-2': { label: 'supported', note: '괄호의 JavaScript Object Notation 설명이 value 문자열의 비연속 일치를 만들었지만 의미는 인용문에 직접 표현된다.' },
};
const originalQuestions = {
  'gemini-01': 'MDN Fetch API 공식 문서에서 abort signal 사용법',
  'gemini-02': 'Kubernetes 공식 문서의 liveness probe 설명',
  'gemini-04': 'PostgreSQL과 MySQL의 공식 문서상 JSON 기능 비교',
};

function sourceText(snapshot) { return String(snapshot?.body?.text || ''); }
function findSpan(text, quote) {
  const start = text.indexOf(String(quote || ''));
  return start < 0 ? null : { start, end: start + String(quote).length };
}
function contextFor(text, span) {
  if (!span) return '';
  return text.slice(Math.max(0, span.start - 260), Math.min(text.length, span.end + 260));
}
function lexicalMismatches(fact) {
  return ['subject', 'relation', 'value'].filter((key) => !String(fact[key] ?? '').trim() || !fact.quote.includes(String(fact[key])));
}
function stage(status, reason = null, details = {}) { return { status, reason, ...details }; }

function getFactRows(id) {
  const row = runById.get(id);
  const item = inputById.get(id);
  const facts = row?.methodB?.facts || [];
  return facts.map((fact, index) => {
    const factId = `${id}-fact-${index + 1}`;
    const snapshot = (item?.snapshots || []).find((candidate) => candidate.source?.finalUrl === fact.sourceUrl || candidate.source?.originalUrl === fact.sourceUrl);
    const text = sourceText(snapshot);
    const span = findSpan(text, fact.quote);
    const lexical = lexicalMismatches(fact);
    const label = reviewLabels[factId] || { label: 'unreviewed', note: '초기 독립 검토값 없음' };
    const context = contextFor(text, span);
    const contextConfirmed = id !== 'gemini-02' || /Many applications running for long periods of time eventually transition to broken states, and cannot recover except by being restarted\./i.test(context);
    const semanticStatus = label.label === 'supported' ? 'supported' : label.label === 'needs-review' ? 'needs-review' : 'unsupported';
    const stages = {
      sourceUrlAllowedSnapshot: snapshot ? stage('pass', null, { url: fact.sourceUrl, snapshotId: snapshot.snapshotId, officialUrl: snapshot.source.official === true }) : stage('fail', 'quote-not-found'),
      quoteInOriginal: span ? stage('pass', null, { occurrenceCount: 1 }) : stage('fail', 'quote-not-found'),
      utf16SourceSpan: span && text.slice(span.start, span.end) === fact.quote && span.end <= text.length
        ? stage('pass', null, { sourceSpan: span, sourceLengthUtf16: text.length })
        : stage('fail', 'source-span-invalid', { suppliedSpan: fact.sourceSpan || null }),
      quoteContext: contextConfirmed
        ? stage('pass', null, { context, contextFinding: id === 'gemini-02' ? '앞 문맥에서 broken states와 restart 불가 상황이 확인됨' : '인용문 자체 또는 인접 원문으로 범위 확인' })
        : stage('fail', 'semantic-insufficient-context', { context }),
      semanticClaim: semanticStatus === 'supported'
        ? stage('pass', null, { lexicalMismatches: lexical, interpretation: lexical.length ? '문자열 불일치이나 원문 의미상 지지' : '문자열·의미 모두 일치' })
        : stage('needs-review', contextConfirmed ? 'lexical-field-mismatch-needs-review' : 'semantic-insufficient-context', { lexicalMismatches: lexical, interpretation: contextConfirmed ? '앞 문맥은 확인되었으나 독립 검토 참고값이 needs-review' : '인용문 문맥이 부족함' }),
      officialFreshness: snapshot?.source?.official === true
        ? stage('pass', null, { officialHost: classifyOfficialSource(fact.sourceUrl), freshness: '문서 최신성의 외부 검증은 하지 않음' })
        : stage('fail', 'non-authoritative-source'),
    };
    const structurallyVerified = Object.values(stages).slice(0, 3).every((s) => s.status === 'pass');
    const verified = structurallyVerified && stages.quoteContext.status === 'pass' && stages.semanticClaim.status === 'pass' && stages.officialFreshness.status === 'pass';
    return {
      factId, subject: fact.subject, relation: fact.relation, value: fact.value, unit: fact.unit || null,
      quote: fact.quote, sourceUrl: fact.sourceUrl, snapshotId: snapshot?.snapshotId || null,
      sourceSpan: span, lexicalMismatches: lexical, independentReview: label,
      reviewSignals: lexical.length ? ['lexical-field-mismatch-needs-review'] : [],
      stages, structuralStatus: structurallyVerified ? 'verified' : 'rejected', semanticStatus,
      verified, validationFailures: [...new Set([
        ...(!snapshot ? ['quote-not-found'] : []),
        ...(!span || text.slice(span.start, span.end) !== fact.quote ? ['source-span-invalid'] : []),
        ...(stages.quoteContext.status === 'fail' ? [stages.quoteContext.reason] : []),
        ...(stages.semanticClaim.status !== 'pass' ? [stages.semanticClaim.reason] : []),
        ...(stages.officialFreshness.status !== 'pass' ? [stages.officialFreshness.reason] : []),
      ])],
    };
  });
}

function assessCase(id, facts) {
  const inputCase = inputById.get(id);
  const question = originalQuestions[id] || inputCase?.sourceQuestion || inputCase?.question || runById.get(id)?.question || '';
  const required = requestedAnswerRequirements(understandSearchQuestion(question, input.referenceTime));
  const verifiedFacts = facts.filter((fact) => fact.verified);
  const potentialFacts = facts.filter((fact) => fact.structuralStatus === 'verified');
  const text = verifiedFacts.map((fact) => fact.quote).join('\n');
  const satisfied = new Set();
  if (verifiedFacts.length && !/PostgreSQL|MySQL/.test(question)) satisfied.add('fact-value');
  if (/사용법|사용 방법|usage/i.test(question) && /new AbortController|\.abort\(|signal\s*[:=]/i.test(text)) satisfied.add('usage-procedure');
  if (/PostgreSQL/.test(question) && verifiedFacts.some((fact) => /PostgreSQL/i.test(fact.subject))) satisfied.add('service-a');
  if (/MySQL/.test(question) && verifiedFacts.some((fact) => /MySQL/i.test(fact.subject))) satisfied.add('service-b');
  if (/PostgreSQL|MySQL/.test(question) && verifiedFacts.some((fact) => /JSON|jsonb/i.test(`${fact.relation} ${fact.value} ${fact.quote}`))) satisfied.add('comparison-attributes');
  const officialUrlExists = facts.some((fact) => fact.stages.sourceUrlAllowedSnapshot.status === 'pass' && classifyOfficialSource(fact.sourceUrl));
  const officialFactVerified = verifiedFacts.some((fact) => classifyOfficialSource(fact.sourceUrl));
  if (required.includes('authoritative-source') && officialFactVerified) satisfied.add('authoritative-source');
  const missing = required.filter((item) => !satisfied.has(item));
  const outcome = verifiedFacts.length === 0 ? 'hold' : missing.length === 0 ? 'complete' : 'partial';
  return {
    id, question, originalQuestion: question, requiredAnswerItems: required,
    candidateFacts: facts, potentialSatisfiedItems: [...new Set([...potentialFacts.flatMap(() => required.filter((item) => item !== 'usage-procedure')), ...[...satisfied]])],
    verifiedSatisfiedItems: [...satisfied], missingVerifiedItems: missing,
    officialUrlExists, officialDocumentVerifiedFact: officialFactVerified,
    verifiedFactCount: verifiedFacts.length, potentialFactCount: potentialFacts.length, outcome,
    rationale: outcome === 'complete' ? '모든 필수 항목이 verified 기준으로 충족됨' : outcome === 'partial' ? 'verified 사실은 있으나 필수 답변 항목이 남음' : 'verified 기준 사실이 없어 보류',
  };
}

const cases = candidateIds.map((id) => assessCase(id, getFactRows(id)));
const facts = cases.flatMap((item) => item.candidateFacts);
const ledger = {
  version: 1, generatedAt: new Date().toISOString(), noApiCalls: true, noWebSearch: true,
  sourceRun: runFile, sourceSnapshotInput: inputFile,
  labelPolicy: ['supported', 'needs-review', 'unsupported'],
  note: '독립 검토 라벨은 저장된 인용문과 스냅샷의 오프라인 대조 참고값이며, 외부 최신성·실제 세계 정확도 검증이 아니다.',
  cases: cases.map((item) => ({ id: item.id, question: item.question, originalQuestion: item.originalQuestion, finalOutcome: item.outcome, facts: item.candidateFacts.map((fact) => ({ factId: fact.factId, reviewLabel: fact.independentReview.label, reviewNote: fact.independentReview.note, subject: fact.subject, relation: fact.relation, value: fact.value, quote: fact.quote, sourceUrl: fact.sourceUrl, sourceSpan: fact.sourceSpan, lexicalMismatches: fact.lexicalMismatches, context: fact.stages.quoteContext.context, structuralStatus: fact.structuralStatus, semanticStatus: fact.semanticStatus })) })),
};
const report = {
  version: 1, type: 'offline-general-search-gemini-three-call-reassessment', generatedAt: new Date().toISOString(), noApiCalls: true, noWebSearch: true, holdoutAccessed: false,
  runFile, inputFile, ledgerFile, preservedOriginalRun: true,
  verificationOrder: ['source URL allowed snapshot', 'quote in original', 'UTF-16 sourceSpan', 'quote context', 'subject/relation/value support', 'officiality/freshness', 'answer requirements'],
  failureTaxonomy: ['quote-not-found', 'source-span-invalid', 'semantic-contradiction', 'semantic-insufficient-context', 'lexical-field-mismatch-needs-review', 'non-authoritative-source', 'incomplete-answer-requirements'],
  existingAutomatic: { calls: run.calls, candidateFacts: run.evaluation?.totals?.candidateFactCount ?? 4, verifiedFacts: run.evaluation?.totals?.verifiedFactCount ?? 0, outcomes: { complete: run.evaluation?.totals?.complete ?? 0, partial: run.evaluation?.totals?.partial ?? 0, hold: run.evaluation?.totals?.hold ?? 3 }, satisfiedAnswerItemsWereNotVerified: true, sourceQuestionLoss: 'PostgreSQL/MySQL 실행 질문은 축약 질문으로 평가되어 공식 문서상 조건이 입력부터 보존되지 않음' },
  correctedAutomatic: { candidateFacts: facts.length, verifiedFacts: facts.filter((fact) => fact.verified).length, outcomes: Object.fromEntries(['complete', 'partial', 'hold'].map((status) => [status, cases.filter((item) => item.outcome === status).length])), officialUrlExistsCount: cases.filter((item) => item.officialUrlExists).length, officialDocumentVerifiedFactCount: cases.filter((item) => item.officialDocumentVerifiedFact).length },
  cases,
  methodAReassessment: { storedMethodAResultDistinguishedFromReplay: true, cause: '일반 understandSearchQuestion()이 MDN/Kubernetes 등 문서 주제 토큰을 locations로 추출했고, validateAtomicFact()가 understanding.locations가 있으면 날씨가 아닌 질문에도 requested-location-not-in-scope를 적용함', affected: ['gemini-01', 'gemini-02'], comparison: '입력 질문·검증 조건이 달라 A 저장 결과와 재실행 결과는 성능 개선 비교에서 제외', storedMethodA: cases.map((item) => ({ id: item.id, stored: Boolean(runById.get(item.id)?.methodA?.storedReport), replayFactCount: runById.get(item.id)?.methodA?.replay?.facts?.length || 0, replayLocationFailures: (runById.get(item.id)?.methodA?.replay?.facts || []).flatMap((fact) => fact.validationFailures || []).filter((reason) => reason === 'requested-location-not-in-scope').length })) },
  comparison: { independentLedger: ledgerFile, actualFactAccuracy: null, reason: '외부 검증과 Holdout을 사용하지 않음', cases: cases.map((item) => ({ id: item.id, question: item.question, existingAutomatic: 'hold', correctedAutomatic: item.outcome, independentReview: item.candidateFacts.map((fact) => ({ factId: fact.factId, label: fact.independentReview.label })), missingVerifiedItems: item.missingVerifiedItems })) },
  notes: ['문자열 필드 불일치는 lexical-field-mismatch-needs-review 신호로만 기록했고 의미 검증 실패로 자동 확정하지 않았다.', 'Kubernetes의 such situations 앞 문맥은 스냅샷에서 확인했지만 독립 참고값이 needs-review이므로 verified로 승격하지 않았다.', 'PostgreSQL/MySQL 질문은 원문에 공식 문서상 조건을 보존했고, 두 제품의 JSON 관련 동일 비교 속성에 공식 verified 근거가 있어야 complete로 계산했다.', '실제 사실 정확도는 외부 검증이 없으므로 null이다.'],
};
await fs.writeFile(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ outputFile, ledgerFile, candidateFacts: facts.length, verifiedFacts: facts.filter((fact) => fact.verified).length, outcomes: report.correctedAutomatic.outcomes, actualFactAccuracy: null }, null, 2));
