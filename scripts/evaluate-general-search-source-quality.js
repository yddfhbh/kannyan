#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankGeneralCandidates, selectGeneralSearchSources, selectRelevantSourceSpans, classifyStoredFailure } from '../src/general-search-source-selection.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const inputFile = arg('--input', path.join(root, 'tmp/general-search-bodies-final-semantic.json'));
const questionsFile = arg('--questions', path.join(root, 'test/fixtures/general-search-questions.json'));
const holdoutFile = arg('--holdout', path.join(root, 'test/fixtures/general-search-holdout.json'));
const outputFile = arg('--output', path.join(root, 'tmp/general-search-source-quality-20261024.json'));
const read = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const [bodies, questionFixture, holdoutFixture] = await Promise.all([read(inputFile), read(questionsFile), read(holdoutFile)]);
const holdout = new Set(holdoutFixture.questions || []);
const allQuestions = (questionFixture.questions || []).filter((question) => !holdout.has(question));
const bodyCases = new Map((bodies.cases || []).map((item) => [item.question, item]));
const safeCase = (question) => bodyCases.get(question);

function metrics(rows, key) {
  const values = rows.map((row) => row[key]).filter((value) => Number.isFinite(value));
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
function compareCase(question, stored) {
  const candidates = (stored?.reads || []).map((page) => ({ url: page.url, title: page.title, pageText: page.body, publishedAt: page.publishedAt || page.datePublished || null }));
  const legacy = rankGeneralCandidates(question, candidates).slice(0, 4).map((entry) => entry.candidate);
  const improved = selectGeneralSearchSources(question, candidates);
  const legacySpans = legacy.map((source) => selectRelevantSourceSpans(question, source));
  const improvedSpans = improved.selected.map((source) => selectRelevantSourceSpans(question, source));
  const body = (source) => String(source.pageText || source.text || '');
  const count = (sources, predicate) => sources.filter(predicate).length;
  const legacyBody = legacy.filter((source) => body(source).trim());
  const improvedBody = improved.selected.filter((source) => body(source).trim());
  const legacySpanCount = legacySpans.reduce((n, item) => n + item.blocks.length, 0);
  const improvedSpanCount = improvedSpans.reduce((n, item) => n + item.blocks.length, 0);
  return {
    question, sourceCaseId: stored?.id || null, storedCandidateCount: candidates.length,
    storedBodyCount: count(candidates, (source) => body(source).trim()),
    legacy: { selectedUrls: legacy.map((source) => source.url), selectedCount: legacy.length, bodyCount: legacyBody.length, spanCount: legacySpanCount,
      sourceTokens: legacyBody.reduce((n, source) => n + body(source).split(/\s+/u).filter(Boolean).length, 0), officialHostCount: count(legacy, (source) => rankGeneralCandidates(question, [source])[0].signals.officialHost) },
    improved: { selectedUrls: improved.selected.map((source) => source.url), selectedCount: improved.selected.length, bodyCount: improvedBody.length, spanCount: improvedSpanCount,
      sourceTokens: improvedBody.reduce((n, source) => n + body(source).split(/\s+/u).filter(Boolean).length, 0), officialHostCount: improved.selected.filter((source) => improved.ranked.find((entry) => entry.candidate === source)?.signals.officialHost).length,
      selectedContextTokens: improvedSpans.reduce((n, item) => n + item.selectedTokens, 0), omittedBlocks: improvedSpans.reduce((n, item) => n + item.omittedBlocks, 0), noiseRatio: metrics(improvedSpans, 'bodyNoiseRatio') },
    diagnostics: { profile: improved.profile, candidates: improved.diagnostics, spans: improvedSpans.map((item) => ({ url: item.url, originalTokens: item.originalTokens, selectedTokens: item.selectedTokens, blocks: item.blocks.map((block) => ({ start: block.start, end: block.end, text: block.text, selectionSignals: block.selectionSignals })) })) },
    failureStages: classifyStoredFailure(question, candidates, improved.selected, improvedSpans),
  };
}

const rows = allQuestions.map((question) => compareCase(question, safeCase(question)));
const six = ['MDN Fetch API 공식 문서에서 abort signal 사용법', 'Kubernetes 공식 문서의 liveness probe 설명', 'Python 최신 안정 버전', 'PostgreSQL과 MySQL의 공식 문서상 JSON 기능 비교', 'AWS Lambda 요청 요금', 'React 최신 버전'];
const sixRows = six.map((question) => rows.find((row) => row.question === question)).filter(Boolean);
const report = {
  version: 1, type: 'offline-general-search-source-quality', generatedAt: new Date().toISOString(), noWebSearch: true, noGeminiCalls: true,
  inputFile, holdoutFile, holdoutExcluded: [...holdout], budgets: { maxSearchCandidates: 12, maxSelectedPages: 4, maxSourceTokens: 3200, maxContextTokensPerPage: 900 },
  scope: { developmentQuestions: rows.length, storedCases: rows.filter((row) => row.storedCandidateCount > 0).length, missingStoredCases: rows.filter((row) => row.storedCandidateCount === 0).map((row) => row.question) },
  sixQuestionFailureAnalysis: sixRows.map((row) => ({ question: row.question, sourceCaseId: row.sourceCaseId, failureStages: row.failureStages, legacy: row.legacy, improved: row.improved, selectedUrls: row.improved.selectedUrls })),
  comparison: { rows, aggregate: { legacySelectedPages: rows.reduce((n, row) => n + row.legacy.selectedCount, 0), improvedSelectedPages: rows.reduce((n, row) => n + row.improved.selectedCount, 0), legacySourceTokens: rows.reduce((n, row) => n + row.legacy.sourceTokens, 0), improvedSourceTokens: rows.reduce((n, row) => n + row.improved.sourceTokens, 0), improvedContextTokens: rows.reduce((n, row) => n + row.improved.selectedContextTokens, 0), improvedBodyNoiseRatio: metrics(rows.map((row) => row.improved), 'noiseRatio') } },
  limitations: ['저장 검색 결과 목록 밖의 공식 URL은 선택기 변경만으로 복구할 수 없다.', 'A~F 중 D/E/F는 독립 정답 라벨과 본문 의미 검토 없이는 unknown으로 유지한다.', '공식 hostname 분류는 소유권 신호이며 제목·본문의 공식 표현과 별도로 기록한다.'],
};
try { await fs.access(outputFile); throw new Error(`Refusing to overwrite existing report: ${outputFile}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputFile, developmentQuestions: rows.length, sixQuestionCount: sixRows.length, improvedSelectedPages: report.comparison.aggregate.improvedSelectedPages }, null, 2));
