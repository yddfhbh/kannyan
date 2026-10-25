#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshotLedger } from '../src/general-search-snapshot.js';
import { understandSearchQuestion, requestedAnswerRequirements } from '../src/general-search-pipeline.js';

// Offline-only preparation. This script never searches, calls Gemini, reads the
// holdout, or modifies the production search path.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const questionsFile = arg('--questions', path.join(root, 'test/fixtures/general-search-questions.json'));
const holdoutFile = arg('--holdout', path.join(root, 'test/fixtures/general-search-holdout.json'));
const bodiesFile = arg('--bodies', path.join(root, 'tmp/general-search-bodies-final-semantic.json'));
const outputFile = arg('--output', path.join(root, 'tmp/general-search-general-evaluation-manifest-20261024.json'));
const dryRunFile = arg('--dry-run-output', path.join(root, 'tmp/general-search-general-evaluation-dry-run-20261024.json'));
const focusQuestions = new Set([
  'MDN Fetch API 공식 문서에서 abort signal 사용법', 'Kubernetes 공식 문서의 liveness probe 설명',
  'Python 최신 안정 버전', 'PostgreSQL과 MySQL의 공식 문서상 JSON 기능 비교',
  'AWS Lambda 요청 요금', 'React 최신 버전',
]);

const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const questions = (await readJson(questionsFile)).questions;
const holdout = new Set((await readJson(holdoutFile)).questions);
const bodies = await readJson(bodiesFile);
const bodyByQuestion = new Map((bodies.cases || []).map((item) => [item.question, item]));
const developmentQuestions = questions.filter((question) => !focusQuestions.has(question) && !holdout.has(question));
if (developmentQuestions.length !== 18) throw new Error(`Expected 18 remaining development questions, got ${developmentQuestions.length}`);

function sourceRows(item) {
  return (item?.reads || []).map((page) => ({
    url: page.url, title: page.title, pageText: page.body, status: page.status,
    publishedAt: page.publishedAt || page.datePublished || null,
    fetchedAt: bodies.capturedAt || null, canonicalUrl: page.canonicalUrl, redirectChain: page.redirectChain,
  }));
}
function tokensFor(understanding) {
  return [...new Set((understanding.target || []).filter((token) => String(token).length >= 2))];
}
function classify(question, understanding) {
  if (understanding.claimType === 'weather') return 'weather';
  if (understanding.claimType === 'version') return 'software-version';
  if (understanding.claimType === 'price') return 'price';
  if (understanding.claimType === 'comparison') return 'comparison';
  if (/뉴스/.test(question)) return 'news';
  if (understanding.claimType === 'event') return 'event';
  if (/누구인가|본부가/.test(question)) return 'fact';
  return understanding.claimType || 'fact';
}
function tokenEstimate(snapshots, question, requirements) {
  const bodyChars = snapshots.reduce((sum, snapshot) => sum + String(snapshot.body?.text || '').length, 0);
  return Math.ceil((bodyChars + question.length * 4 + requirements.join(' ').length * 4 + 900) / 4);
}
function evaluate(question, index) {
  const stored = bodyByQuestion.get(question);
  const understanding = understandSearchQuestion(question, bodies.now || undefined);
  const requirements = requestedAnswerRequirements(understanding);
  const sources = sourceRows(stored);
  const snapshots = buildSnapshotLedger(question, sources, { requiredAnswerItems: requirements });
  const bodySnapshots = snapshots.filter((snapshot) => snapshot.status === 'captured');
  const text = bodySnapshots.map((snapshot) => snapshot.body.text).join('\n');
  const tokens = tokensFor(understanding);
  const tokenHits = tokens.filter((token) => text.toLocaleLowerCase().includes(token.toLocaleLowerCase()));
  const officialSnapshots = bodySnapshots.filter((snapshot) => snapshot.source.official);
  const originalSearchResultExists = Boolean(stored && (stored.reads || []).length);
  const relatedSpanStatus = bodySnapshots.length === 0 ? 'missing' : tokenHits.length ? 'candidate-token-hit-unreviewed' : 'not-established';
  const officialFreshness = understanding.officialRequired || understanding.needsFreshness
    ? (officialSnapshots.length ? 'official-host-present; freshness-unverified' : 'missing-official-source')
    : 'not-required-by-question';
  const materialScore = (bodySnapshots.length ? 2 : 0) + (tokenHits.length ? 2 : 0) + (officialSnapshots.length ? 2 : 0)
    + (requirements.length <= 3 ? 1 : 0);
  return {
    id: `general-${String(index + 1).padStart(2, '0')}`, question, sourceCaseId: stored?.id || null,
    questionType: classify(question, understanding), claimType: understanding.claimType,
    requiredAnswerItems: requirements, originalRequiredConditions: understanding.target,
    searchResult: { exists: originalSearchResultExists, storedReadCount: sources.length, sourceBodyFile: bodiesFile },
    originalSnapshots: { exists: bodySnapshots.length > 0, capturedCount: bodySnapshots.length, totalCount: snapshots.length, officialCapturedCount: officialSnapshots.length },
    officialityFreshness: { officialRequired: understanding.officialRequired, freshnessRequired: understanding.needsFreshness, status: officialFreshness },
    relatedSpan: { status: relatedSpanStatus, tokenCount: tokens.length, tokenHits: tokenHits.slice(0, 20), independentlyVerified: false },
    gemini: { callAllowedThisRun: false, eligibleAfterApproval: materialScore >= 4, reason: '이번 작업의 실제 Gemini 호출 금지; 별도 승인 필요' },
    estimatedInputTokens: tokenEstimate(snapshots, question, requirements),
    currentEvidenceGaps: [
      ...(!originalSearchResultExists ? ['stored-search-result-missing'] : []),
      ...(!bodySnapshots.length ? ['related-original-snapshot-missing'] : []),
      ...(relatedSpanStatus !== 'candidate-token-hit-unreviewed' ? ['question-related-span-not-established'] : ['span-semantic-review-required']),
      ...(officialFreshness === 'missing-official-source' ? ['official-source-missing'] : []),
      ...((understanding.officialRequired || understanding.needsFreshness) && officialSnapshots.length ? ['freshness-not-independently-verified'] : []),
      ...['fact-accuracy-not-reviewed', 'answer-completeness-not-reviewed'],
    ],
    materialScore, snapshots: snapshots.map((snapshot) => ({ snapshotId: snapshot.snapshotId, status: snapshot.status, url: snapshot.source.finalUrl, title: snapshot.source.title, official: snapshot.source.official, bodyLength: snapshot.body.length, truncated: snapshot.body.truncated })),
  };
}

const cases = developmentQuestions.map(evaluate);
const byType = new Map();
for (const item of cases.filter((candidate) => candidate.gemini.eligibleAfterApproval).sort((a, b) => b.materialScore - a.materialScore || a.id.localeCompare(b.id))) {
  const list = byType.get(item.questionType) || [];
  if (list.length < 6) list.push(item);
  byType.set(item.questionType, list);
}
// Cover distinct question types first; the per-type ceiling remains six and
// the total HTTP budget is six. This makes the next experiment informative
// without changing any verification rule for a particular case.
const selected = [];
for (let round = 0; selected.length < 6; round += 1) {
  let added = false;
  for (const list of byType.values()) {
    if (list[round] && selected.length < 6) { selected.push(list[round]); added = true; }
  }
  if (!added) break;
}
const selectedIds = new Set(selected.map((item) => item.id));
const executionPolicy = { actualCallsMade: 0, maxModelHttpRequests: 6, retryAttemptsPerRequest: 1, fallbackAttemptsPerRequest: 1, retryAndFallbackIncludedInLimit: true, holdoutAccessed: false, webSearchPerformed: false, geminiCallsPerformed: false, requiresSeparateApproval: true };
const manifest = { version: 1, type: 'offline-general-search-general-evaluation-manifest', generatedAt: new Date().toISOString(), noWebSearch: true, noGeminiCalls: true, holdoutExcluded: [...holdout], focusQuestions: [...focusQuestions], remainingDevelopmentQuestionCount: cases.length, executionPolicy, cases, selectedForFutureExperiment: selected.map((item) => ({ id: item.id, question: item.question, questionType: item.questionType, estimatedInputTokens: item.estimatedInputTokens, materialScore: item.materialScore, selectionReason: '저장 본문·질문 관련 토큰·질문 유형별 최대 6개 제한을 만족; 독립 의미 검토와 최신성은 미완료', geminiCallAllowed: false })) };
const dryRun = { version: 1, type: 'offline-general-search-gemini-six-call-dry-run', generatedAt: new Date().toISOString(), manifestFile: outputFile, ...executionPolicy, plannedCalls: selected.length, plannedRetryAndFallbackBudget: 6, cases: selected.map((item) => ({ id: item.id, question: item.question, questionType: item.questionType, plannedHttpRequests: 1, maxHttpRequestsIncludingRetryFallback: 6, status: 'ready-after-separate-approval', reason: '실제 호출은 이번 작업에서 차단됨', estimatedInputTokens: item.estimatedInputTokens })), holds: cases.filter((item) => !selectedIds.has(item.id)).map((item) => ({ id: item.id, question: item.question, questionType: item.questionType, status: 'hold', reason: item.currentEvidenceGaps })) };
await fs.writeFile(outputFile, `${JSON.stringify(manifest, null, 2)}\n`);
await fs.writeFile(dryRunFile, `${JSON.stringify(dryRun, null, 2)}\n`);
console.log(JSON.stringify({ outputFile, dryRunFile, remainingDevelopmentQuestionCount: cases.length, selectedCount: selected.length, selected: selected.map((item) => item.question), actualCallsMade: 0 }, null, 2));
