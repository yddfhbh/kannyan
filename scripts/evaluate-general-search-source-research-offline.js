#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectGeneralSearchSources, scoreSourceCandidate } from '../src/general-search-source-selection.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const inputFile = arg('--input', path.join(root, 'tmp/general-search-source-research-live-20261024T035949Z.json'));
const v2File = arg('--v2', inputFile);
const v3File = arg('--v3', '');
const outputFile = arg('--output', path.join(root, 'tmp/general-search-source-research-offline-report-20261024.json'));
const input = JSON.parse(await fs.readFile(inputFile, 'utf8'));
const v2Input = JSON.parse(await fs.readFile(v2File, 'utf8'));
const v3Input = v3File ? JSON.parse(await fs.readFile(v3File, 'utf8')) : null;
const six = input.questions || [];
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const siteOf = (query) => query.match(/\bsite:([^\s]+)/i)?.[1]?.split('/')[0].replace(/^www\./, '').replace(/\/$/, '') || '';
const sameHost = (url, domain) => { const host = hostOf(url); return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`)); };
const bodyLength = (row, url) => Number(row.reads?.find((read) => read.url === url)?.bodyLength || 0);
const truncated = (length) => length >= 7999 ? { status: 'likely-truncated', observedLength: length, limit: 8000 } : { status: 'not-observed', observedLength: length, limit: 8000 };

function evaluate(row) {
  const candidates = row.candidates || [];
  const improved = selectGeneralSearchSources(row.question, candidates, { siteQueries: row.searchQueries });
  const oldUrls = row.selectedUrls || [];
  const improvedUrls = improved.selected.map((candidate) => candidate.url);
  const oldUnrelated = oldUrls.filter((url) => {
    const score = scoreSourceCandidate(row.question, { url });
    return score.signals.requiredHosts.length > 0 && !score.signals.requiredSourceMatch;
  });
  const fallback = (row.searchQueries || []).map((query) => {
    const domain = siteOf(query);
    const queryCandidates = candidates.filter((candidate) => !domain || sameHost(candidate.url, domain));
    const queryEligible = queryCandidates.filter((candidate) => {
      const assessed = selectGeneralSearchSources(row.question, [candidate], { siteQueries: [query] });
      return assessed.counts.eligibleCandidateCount > 0;
    });
    return { query, domain, rawCandidateCount: queryCandidates.length, eligibleCandidateCount: queryEligible.length, fallbackRequired: queryEligible.length === 0, reason: queryEligible.length === 0 ? 'no-eligible-results-after-http-200' : '' };
  });
  return {
    question: row.question,
    profile: improved.profile,
    rawCandidateCount: candidates.length,
    eligibleCandidateCount: improved.counts.eligibleCandidateCount,
    officialEligibleCount: improved.counts.officialEligibleCount,
    selectedRelevantCount: improved.counts.selectedRelevantCount,
    unrelatedSelectedUrlCount: oldUnrelated.length,
    previousSelectedUrls: oldUrls,
    improvedSelectedUrls: improvedUrls,
    fallback,
    finalSelection: improved.selected.map((candidate) => candidate.url),
    bodyTruncation: row.reads?.map((read) => ({ url: read.url, ...truncated(Number(read.bodyLength || 0)) })) || [],
    additionalSearchNeeded: improved.counts.eligibleCandidateCount === 0,
    unknowns: ['본문 전체가 fixture에 없으므로 본문 의미 적합성·실제 절단 내용·가격/코드 누락 여부는 unknown으로 유지', 'HTTP 200 응답의 HTML 메뉴/푸터/광고 여부는 저장된 후보 메타데이터만으로 확정할 수 없음'],
    diagnostics: improved.diagnostics,
  };
}

const cases = six.map(evaluate);
const v3ByQuestion = new Map((v3Input?.questions || []).map((row) => [row.question, row]));
for (const item of cases) {
  const v3 = v3ByQuestion.get(item.question);
  const v2 = v2Input.questions?.find((row) => row.question === item.question);
  item.comparison = {
    v2RawCandidateCount: v2?.candidates?.length ?? null,
    v3FilterAppliedCandidateCount: v3?.candidates?.length ?? null,
    filterFixedCandidateCount: item.rawCandidateCount,
    v2SelectedUrls: v2?.selectedUrls ?? [],
    v3SelectedUrls: v3?.selectedUrls ?? [],
    fixedSelectedUrls: item.finalSelection,
    officialDocumentPreservation: item.finalSelection.filter((url) => item.profile?.requiredHosts?.some((host) => sameHost(url, host))).length,
    unrelatedUrlRemovalRate: item.rawCandidateCount ? (item.rawCandidateCount - item.eligibleCandidateCount) / item.rawCandidateCount : null,
    unknown: v3 ? [] : ['v3 fixture not supplied'],
  };
  item.fallbackDiagnostics = (v3?.attempts || []).filter((attempt) => attempt.phase === 'fallback' || attempt.status?.startsWith('fallback-skipped')).map((attempt) => ({
    query: attempt.query, engine: attempt.engine, status: ['blocked', 'transport-error', 'no-eligible-results', 'fallback-skipped-budget-exhausted', 'fallback-skipped-provider-blocked'].includes(attempt.status) ? attempt.status : 'unknown',
    httpStatuses: (attempt.httpAttempts || []).map((http) => http.httpStatus).filter(Boolean),
  }));
  if (v3) {
    const primaryNoEligible = (v3.attempts || []).filter((attempt) => attempt.phase === 'primary' && attempt.status === 'no-eligible-results').map((attempt) => attempt.query);
    const recordedFallback = new Set((v3.attempts || []).filter((attempt) => attempt.phase === 'fallback').map((attempt) => attempt.query));
    if (Number(v3.totals?.actualSearchHttpAttempts || 0) >= Number(v3.budgets?.maxTotalSearches || 0)) {
      for (const query of primaryNoEligible.filter((query) => !recordedFallback.has(query))) item.fallbackDiagnostics.push({ query, engine: 'duckduckgo', status: 'fallback-skipped-budget-exhausted', httpStatuses: [] });
    }
  }
  item.plannedConditionalFallbackRequests = v3 ? (v3.attempts || []).filter((attempt) => attempt.phase === 'primary' && attempt.status === 'no-eligible-results').length : null;
  item.actualFallbackRequests = v3 ? (v3.attempts || []).filter((attempt) => attempt.phase === 'fallback' && (attempt.httpAttempts || []).length > 0).length : null;
}
const report = {
  version: 2,
  type: 'offline-general-search-source-research-evaluation',
  generatedAt: new Date().toISOString(),
  noWebSearch: true,
  noGeminiCalls: true,
  inputFile, v2File, ...(v3File ? { v3File } : {}),
  budgets: { maxSearchHttpAttempts: 12, maxBodyHttpAttempts: 24, maxSelectedPages: 4 },
  questions: cases,
  summary: {
    rawCandidateCount: cases.reduce((sum, item) => sum + item.rawCandidateCount, 0),
    eligibleCandidateCount: cases.reduce((sum, item) => sum + item.eligibleCandidateCount, 0),
    officialEligibleCount: cases.reduce((sum, item) => sum + item.officialEligibleCount, 0),
    selectedRelevantCount: cases.reduce((sum, item) => sum + item.selectedRelevantCount, 0),
    unrelatedSelectedUrlCount: cases.reduce((sum, item) => sum + item.unrelatedSelectedUrlCount, 0),
    newFallbackQuestions: cases.filter((item) => item.fallback.some((entry) => entry.fallbackRequired)).map((item) => item.question),
    additionalSearchNeededQuestions: cases.filter((item) => item.additionalSearchNeeded).map((item) => item.question),
    searchBudgetExceeded: Number(input.totals?.actualSearchHttpAttempts || 0) > 12,
    bodyBudgetExceeded: Number(input.totals?.actualReadHttpAttempts || 0) > 24,
    v2RawCandidateCount: cases.reduce((sum, item) => sum + (item.comparison.v2RawCandidateCount || 0), 0),
    v3FilterAppliedCandidateCount: cases.reduce((sum, item) => sum + (item.comparison.v3FilterAppliedCandidateCount || 0), 0),
    filterFixedCandidateCount: cases.reduce((sum, item) => sum + item.comparison.filterFixedCandidateCount, 0),
    officialDocumentPreservation: cases.reduce((sum, item) => sum + item.comparison.officialDocumentPreservation, 0),
    fallbackPlannedConditionally: cases.reduce((sum, item) => sum + (item.plannedConditionalFallbackRequests || 0), 0),
    fallbackActuallyRequested: cases.reduce((sum, item) => sum + (item.actualFallbackRequests || 0), 0),
    fallbackBlocked: cases.flatMap((item) => item.fallbackDiagnostics).filter((entry) => entry.status === 'blocked').length,
    fallbackSkippedBudgetExhausted: cases.flatMap((item) => item.fallbackDiagnostics).filter((entry) => entry.status === 'fallback-skipped-budget-exhausted').length,
    unknown: ['웹 검색 원본 응답 본문과 원문 선택기 실행 기록이 저장되지 않아 최종 의미 적합성·본문 기준 무관 URL 제거율은 unknown'].concat(v3Input ? [] : ['v3 비교 자료 미제공']),
  },
  limitations: ['저장 결과를 덮어쓰지 않음', '본문 전체·HTML 원문이 없어 파서가 메뉴/푸터/광고를 읽었는지는 unknown', '8,000자 bodyLength는 절단 가능성만 표시하며 내용 누락을 단정하지 않음'],
};
try { await fs.access(outputFile); throw new Error(`Refusing to overwrite existing report: ${outputFile}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputFile, noWebSearch: true, noGeminiCalls: true, summary: report.summary }, null, 2));
