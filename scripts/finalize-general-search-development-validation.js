#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

// Offline final validation. It consumes only the already prepared 18-case
// manifest and stored snapshots. It never reads the holdout, searches, or
// calls Gemini. The existing preparation/verification rules are unchanged.
const root = process.cwd();
const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const inputFile = arg('--input', 'tmp/general-search-general-evaluation-manifest-20261024.json');
const bodiesFile = arg('--bodies', 'tmp/general-search-bodies-final-semantic.json');
const outputFile = arg('--output', 'tmp/general-search-final-development-validation-20261024.json');
const dryRunFile = arg('--dry-run-output', 'tmp/general-search-final-development-validation-dry-run-20261024.json');
const read = async (file) => JSON.parse(await fs.readFile(path.resolve(root, file), 'utf8'));
const [base, bodies] = await Promise.all([read(inputFile), read(bodiesFile)]);
if (base.cases?.length !== 18) throw new Error(`Expected 18 development cases, got ${base.cases?.length}`);

const selectedQuestions = [
  'PostgreSQL 최신 버전', 'GitHub Actions 요금제', '오늘 서울 날씨',
  '최근 일주일 반도체 뉴스', '대한민국 과학기술정보통신부 장관은 누구인가',
  '서울 이번 달 무료 개발자 행사 일정',
];
const statusByQuestion = {
  '오늘 서울 날씨': ['insufficient-evidence', '저장 자료에 서울 값은 있으나 범용 검색 snapshot만 있고 기준일의 기상청 공식 근거가 없음'],
  '내일 제주 날씨': ['insufficient-evidence', '저장 기사와 예보 본문이 기준일의 내일 값으로 충분히 확정되지 않음'],
  '오늘 대전 미세먼지': ['insufficient-evidence', '저장 자료는 과거 월간/기사 자료이며 기준일의 대전 측정값을 확정하지 못함'],
  '내일 뉴욕 날씨': ['insufficient-evidence', '저장 snapshot이 1건이고 기준일·도시의 예보 필수값이 부족함'],
  'PostgreSQL 최신 버전': ['stale-evidence', '프로젝트 공식 최신 안정 버전 출처가 없고 RDS 2025 자료와 비공식/관리형 서비스 자료가 섞임'],
  'Docker Engine 최신 버전': ['stale-evidence', '기준일에 유효한 Docker 공식 안정 버전 근거가 저장 자료에 없음'],
  '최근 일주일 반도체 뉴스': ['stale-evidence', '기사 발행일과 사건 발생일을 최근 7일 범위로 모두 확정할 수 없음'],
  '최근 일주일 생성형 AI 뉴스': ['stale-evidence', '기사 발행일·사건 발생일과 기준일 포함 7일 범위의 연결이 미확정'],
  '최근 일주일 한국 과학기술 뉴스': ['stale-evidence', '저장 본문만으로 기준일 포함 최근 7일의 기사/사건 범위를 확정할 수 없음'],
  'OpenAI API 최신 가격': ['insufficient-evidence', '공식 최신 가격표의 모델·통화·요금 조건 전체가 저장 자료에서 확정되지 않음'],
  'GitHub Actions 요금제': ['extraction-testable', '저장된 공식 GitHub billing 문서에 무료 할당량·초과 청구 조건이 있어 추출 검증 가능; 기준일 최신성은 별도 확인 전까지 보류'],
  '서울 이번 달 무료 개발자 행사 일정': ['insufficient-evidence', '서울·무료·개발자·10월 일정 조건을 동시에 입증하는 행사 원문이 없음'],
  '부산 불꽃축제 올해 일정': ['insufficient-evidence', '올해 행사 날짜·장소·권위 있는 주최 출처의 전체 조합이 없음'],
  '대한민국 과학기술정보통신부 장관은 누구인가': ['stale-evidence', '현직 장관을 확인할 정부의 기준일 공식 인사 근거가 없고 기사/위키 snapshot만 있음'],
  'WHO 본부가 있는 도시와 기관 역할': ['extraction-testable', '본문과 관련 출처는 있으나 도시·기관 역할의 사실 추출과 독립 검증은 미실시'],
  'MacBook Air와 Dell XPS 13의 공식 사양 비교': ['insufficient-evidence', '두 제조사 공식 사양표가 모두 저장되지 않아 비교 필수 항목을 충족하지 못함'],
  '2024년 자료와 현재 자료가 섞인 Node.js 릴리스 역사에서 최신 LTS만 확인': ['stale-evidence', '현재 LTS를 기준일에 유효한 Node.js 공식 릴리스 자료로 고정하지 못함'],
  '한국에서 사용할 수 있는 두 가지 클라우드 저장소의 무료 용량과 월 요금 비교': ['insufficient-evidence', '두 서비스의 한국 이용 조건·무료 용량·월 요금을 같은 시점의 공식 자료로 맞추지 못함'],
};
const bodyByQuestion = new Map((bodies.cases || []).map((item) => [item.question, item]));
const tokenEstimate = (question, rows) => Math.ceil((rows.reduce((sum, row) => sum + String(row.body || '').length, 0) + question.length * 4 + 1400) / 4);
const coreInfo = (question, rows) => {
  const text = rows.map((row) => String(row.body || '')).join('\n');
  const checks = question.includes('날씨') ? ['서울|제주|대전|뉴욕', '2026-10-24|2026-10-25|오늘|내일']
    : question.includes('반도체') ? ['반도체', '2026-10-18|2026-10-19|2026-10-20|2026-10-21|2026-10-22|2026-10-23|2026-10-24']
      : question.includes('장관') ? ['장관', '과학기술정보통신부']
        : question.includes('행사') ? ['서울', '무료', '개발자', '10월|2026-10']
          : question.includes('GitHub') ? ['GitHub Actions', '요금|가격|무료']
            : ['PostgreSQL', '18|18.6|최신'];
  return checks.map((pattern) => ({ pattern, presentInStoredBody: new RegExp(pattern, 'i').test(text) }));
};
const cases = base.cases.map((baseCase) => {
  const [status, reason] = statusByQuestion[baseCase.question] || ['insufficient-evidence', '명시적 최종 판정 규칙에 없는 질문'];
  const stored = bodyByQuestion.get(baseCase.question);
  const reads = stored?.reads || [];
  const urls = reads.map((row) => row.url);
  const snapshots = reads.map((row) => ({ url: row.url, title: row.title, bodySnapshotExists: Boolean(String(row.body || '').trim()), bodyLength: String(row.body || '').length, status: row.status, publishedAt: row.publishedAt || row.datePublished || null, modifiedAt: row.modifiedAt || row.dateModified || null }));
  const selected = selectedQuestions.includes(baseCase.question);
  const githubSourceAssessment = baseCase.question === 'GitHub Actions 요금제'
    ? snapshots.map((row) => ({
      url: row.url,
      status: row.url === 'https://itwiki.kr/w/GitHub_Actions' ? 'sensitive-content-blocked'
        : row.url === 'https://docs.github.com/ko/billing/concepts/product-billing/github-actions' ? 'extraction-testable'
          : 'not-selected-for-billing-evidence',
      freshnessVerifiedForReferenceDate: false,
    }))
    : null;
  return {
    id: baseCase.id, question: baseCase.question, status, statusReason: reason,
    selectedCandidate: selected, sourceUrls: urls, bodySnapshots: snapshots,
    sourceSnapshotExists: snapshots.some((row) => row.bodySnapshotExists),
    officialSourcePresent: baseCase.originalSnapshots?.officialCapturedCount > 0,
    officialityFreshness: baseCase.officialityFreshness,
    ...(githubSourceAssessment ? { sourceAssessment: githubSourceAssessment, freshnessVerifiedForReferenceDate: false } : {}),
    coreInformationPresence: coreInfo(baseCase.question, reads),
    estimatedInputTokens: tokenEstimate(baseCase.question, reads),
    independentFactAccuracy: null, answerVerification: null,
    gemini: { callAllowed: false, automaticDecision: 'hold', reason: '실험 안전 조건상 이 검증 단계에서는 실제 호출 금지; 상태가 ready여도 별도 승인 필요' },
  };
});
const counts = Object.fromEntries(['ready', 'extraction-testable', 'insufficient-evidence', 'stale-evidence', 'sensitive-content-blocked', 'body-snapshot-missing'].map((status) => [status, cases.filter((item) => item.status === status).length]));
const selected = cases.filter((item) => item.selectedCandidate);
const manifest = {
  version: 1, type: 'final-general-search-development-validation-manifest', generatedAt: new Date().toISOString(),
  reference: { date: '2026-10-24', timezone: 'Asia/Seoul', today: '2026-10-24', recentSevenDays: '2026-10-18~2026-10-24', thisMonth: '2026-10-01~2026-10-31', latest: '기준 시점에 유효한 최신 안정 버전', incumbentMinister: '기준 시점에 재임한 인물', dateSemantics: ['기사 발행일과 사건 발생일을 분리', '문서 수정일과 실제 효력 발생일을 분리', '수집일만으로 기준일 정확성을 입증하지 않음'] },
  sourcePolicy: { inputFile, bodiesFile, noWebSearch: true, noGeminiCalls: true, holdoutRead: false, sourceSpanBasis: '기존 body.text snapshot과 기존 검증 규칙을 그대로 사용', githubActionsSensitiveContentBypass: false, weatherPathChanged: false },
  denominator: { developmentQuestions: 18, selectedCandidates: 6, excludedFromSelectionRemainInDenominator: true, holdoutQuestionsUsed: 0, focusExperimentSeparated: true },
  statusCounts: counts, cases,
  selectedCandidates: selected.map((item) => ({ id: item.id, question: item.question, status: item.status, geminiCallAllowed: false, automaticDecision: 'hold', estimatedInputTokens: item.estimatedInputTokens })),
  preparationRate: { originalSnapshotAvailable: cases.filter((item) => item.sourceSnapshotExists).length / cases.length, answerReady: cases.filter((item) => item.status === 'ready').length / cases.length, note: '원문 확보율과 답변 준비율은 분리하며, 수집일을 최신성 증거로 사용하지 않음' },
  experimentPolicy: { maxGeminiRequestsPerQuestion: 1, maxGeminiHttpAttempts: 6, retry: false, fallback: false, independentFactAccuracy: null, holdoutAllowed: false, actualGeminiCalls: 0, actualWebSearchCalls: 0, inputSourceFixed: true },
};
const dryRun = { version: 1, type: 'final-general-search-development-validation-dry-run', generatedAt: new Date().toISOString(), manifestFile: outputFile, noWebSearch: true, noGeminiCalls: true, holdoutRead: false, actualGeminiCalls: 0, actualWebSearchCalls: 0, maxGeminiHttpAttempts: 6, retry: false, fallback: false, plannedCalls: 0, callableQuestions: [], automaticHolds: selected.map((item) => ({ id: item.id, question: item.question, status: item.status, reason: item.statusReason })), totalEstimatedInputTokens: cases.reduce((sum, item) => sum + item.estimatedInputTokens, 0), selectedEstimatedInputTokens: selected.reduce((sum, item) => sum + item.estimatedInputTokens, 0), sshCommand: 'cd <this-worktree> && node scripts/finalize-general-search-development-validation.js'};
await fs.writeFile(path.resolve(root, outputFile), `${JSON.stringify(manifest, null, 2)}\n`);
await fs.writeFile(path.resolve(root, dryRunFile), `${JSON.stringify(dryRun, null, 2)}\n`);
console.log(JSON.stringify({ outputFile, dryRunFile, statusCounts: counts, developmentQuestions: cases.length, selectedCandidates: selected.length, callableQuestions: 0, actualGeminiCalls: 0, totalEstimatedInputTokens: dryRun.totalEstimatedInputTokens }, null, 2));
