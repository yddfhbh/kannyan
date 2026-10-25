#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const repositoryRoot = process.cwd();
const questionsPath = path.join(repositoryRoot, 'test/fixtures/general-search-questions.json');
const holdoutPath = path.join(repositoryRoot, 'test/fixtures/general-search-holdout.json');
const bodiesPath = process.env.GENERAL_SEARCH_BODIES_INPUT
  || path.join(repositoryRoot, 'tmp/general-search-bodies-final-semantic.json');
const stamp = process.env.GENERAL_SEARCH_EXPERIMENT_STAMP || new Date().toISOString().replace(/[-:.TZ]/g, '');
const inputPath = process.env.GENERAL_SEARCH_EXPERIMENT_INPUT
  || path.join(repositoryRoot, `tmp/general-search-gemini-experiment-input-${stamp}.json`);
const ledgerPath = process.env.GENERAL_SEARCH_REVIEW_LEDGER
  || path.join(repositoryRoot, `tmp/general-search-independent-review-ledger-${stamp}.json`);
const allInputPath = process.env.GENERAL_SEARCH_ALL_INPUT
  || path.join(repositoryRoot, `tmp/general-search-offline-reassessment-input-${stamp}.json`);
const referenceTime = process.env.GENERAL_SEARCH_REFERENCE_TIME || '2026-10-24T00:19:00+09:00';
const timezone = process.env.GENERAL_SEARCH_TIMEZONE || 'Asia/Seoul';
const preparedAt = new Date().toISOString();

const selection = [
  { question: 'MDN Fetch API AbortSignal 사용법', sourceQuestion: 'MDN Fetch API 공식 문서에서 abort signal 사용법', category: 'official-documentation', reason: '설명형 문장을 정규식 후보 0건이어도 직접 추출할 수 있는지 검증' },
  { question: 'Kubernetes 공식 문서의 liveness probe 설명', sourceQuestion: 'Kubernetes 공식 문서의 liveness probe 설명', category: 'official-documentation', reason: 'liveness와 readiness를 분리해 설명하는지 검증' },
  { question: 'Python 최신 안정 버전', sourceQuestion: 'Python 최신 안정 버전', category: 'software-version', reason: '공식 최신성 근거가 없으면 버전을 확정하지 않는지 검증' },
  { question: 'PostgreSQL과 MySQL의 JSON 기능 비교', sourceQuestion: 'PostgreSQL과 MySQL의 공식 문서상 JSON 기능 비교', category: 'comparison', reason: '양쪽 공식 원문이 모두 있어야 비교를 완료하는지 검증' },
  { question: 'AWS Lambda 요청 요금', sourceQuestion: 'AWS Lambda 요청 요금', category: 'price', reason: '모델명·단가·통화·과금 단위를 연결하고 무료 구간과 분리하는지 검증' },
  { question: 'React 최신 버전', sourceQuestion: 'React 최신 버전', category: 'software-version', reason: '공식 최신성 근거가 없으면 최신 버전을 확정하지 않는지 검증' },
];

async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
const questions = (await readJson(questionsPath)).questions;
const holdout = new Set((await readJson(holdoutPath)).questions);
const bodies = await readJson(bodiesPath);
const bodyByQuestion = new Map((bodies.cases || []).map((item) => [item.question, item]));
const selectedQuestions = new Set(selection.map((item) => item.question));
const overlap = selection.filter((item) => holdout.has(item.question)).map((item) => item.question);
if (overlap.length) throw new Error(`Selection overlaps holdout: ${overlap.join(', ')}`);
if (selection.some((item) => !questions.includes(item.sourceQuestion || item.question))) throw new Error('Selection contains a question outside the 24-question fixture');

const cases = selection.map((chosen, index) => {
  const stored = bodyByQuestion.get(chosen.sourceQuestion || chosen.question);
  if (!stored) throw new Error(`Stored body material missing: ${chosen.question}`);
  const sources = (stored.reads || []).map((page) => ({
    url: page.url, title: page.title, pageText: page.body, status: page.status,
    publishedAt: page.publishedAt || page.datePublished || null,
    fetchedAt: bodies.capturedAt || null, preparedAt, referenceTime, timezone, effectiveDate: null,
    canonicalUrl: page.canonicalUrl, redirectChain: page.redirectChain,
  }));
  return { id: `gemini-${String(index + 1).padStart(2, '0')}`, question: chosen.question, sourceQuestion: chosen.sourceQuestion || chosen.question,
    category: chosen.category, selectionReason: chosen.reason, sourceCaseId: stored.id,
    referenceTime, timezone, preparedAt,
    sources };
});
const storedSources = (stored) => (stored.reads || []).map((page) => ({
  url: page.url, title: page.title, pageText: page.body, status: page.status,
  publishedAt: page.publishedAt || page.datePublished || null, fetchedAt: bodies.capturedAt || null,
  preparedAt, referenceTime, timezone, effectiveDate: null,
  canonicalUrl: page.canonicalUrl, redirectChain: page.redirectChain,
}));
const allCases = (bodies.cases || []).map((stored, index) => ({
  id: stored.id || `offline-${String(index + 1).padStart(2, '0')}`, question: stored.question,
  sources: storedSources(stored), sourceCaseId: stored.id, referenceTime, timezone, preparedAt,
}));

const ledgerCases = cases.flatMap((item) => {
  const requirements = item.category === 'weather' ? ['weather-value']
    : item.category === 'software-version' ? ['version', 'release-status', 'freshness']
      : item.category === 'official-documentation' ? ['service-a', 'comparison-attributes']
        : item.category === 'price' ? ['price', 'currency-and-plan', ...(item.question.includes('Lambda') ? ['free-tier', 'pricing-conditions'] : [])]
          : item.category === 'news' ? ['fact-value', 'freshness']
            : item.category === 'event' ? ['event-name', 'date', 'location', 'authoritative-source']
              : ['service-a', 'service-b', 'comparison-attributes'];
  return item.sources.flatMap((source, sourceIndex) => [{
    reviewId: `${item.id}-source-${sourceIndex + 1}`, question: item.question,
    candidateFacts: [], sourceQuote: '', sourceUrl: source.url, sourceTitle: source.title,
    sourceDate: null, requiredAnswerItems: requirements, label: 'unreviewed',
    reviewerNote: '자동 확정 금지: 원문과 후보 사실을 대조한 뒤 독립 검토자가 라벨링',
  }]);
});

await fs.writeFile(inputPath, `${JSON.stringify({ version: 2, preparedAt, referenceTime, timezone, sourceBodies: bodiesPath, holdoutExcluded: [...holdout], cases }, null, 2)}\n`);
await fs.writeFile(allInputPath, `${JSON.stringify({ version: 2, preparedAt, referenceTime, timezone, sourceBodies: bodiesPath, cases: allCases }, null, 2)}\n`);
await fs.writeFile(ledgerPath, `${JSON.stringify({ version: 2, preparedAt, referenceTime, timezone, labelPolicy: ['supported', 'contradicted', 'insufficient', 'irrelevant', 'unreviewed'], cases: ledgerCases }, null, 2)}\n`);
console.log(JSON.stringify({ inputPath, allInputPath, ledgerPath, selectedCount: cases.length, holdoutCount: holdout.size, sourceQuestionCount: bodyByQuestion.size, unusedDevelopmentQuestions: questions.filter((question) => !selectedQuestions.has(question) && !holdout.has(question)) }, null, 2));
