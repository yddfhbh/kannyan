#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Review correction is deliberately separate from the frozen verifier. It
// prevents JSON-type support from being misreported as a complete feature
// comparison without changing the verifier's acceptance rules.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputFile = process.argv.find((arg) => arg.startsWith('--input='))?.slice(8) || path.join(root, 'tmp/general-search-gemini-three-call-offline-report-20261024.json');
const outputFile = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9) || path.join(root, 'tmp/general-search-three-case-final-review-20261024.json');
const report = JSON.parse(await fs.readFile(inputFile, 'utf8'));
const postgres = report.cases.find((item) => item.id === 'gemini-04');
if (!postgres) throw new Error('gemini-04 case missing');
postgres.outcome = 'partial';
postgres.missingVerifiedItems = ['feature-differences'];
postgres.rationale = '양쪽 공식 원문은 JSON 저장/타입 지원이라는 동일 속성만 입증하며, 기능 차이 설명 근거가 없어 partial';
postgres.reviewCorrection = { originalAutomaticOutcome: 'complete', correctedOutcome: 'partial', reason: 'JSON 타입 지원 여부와 기능 차이 설명을 분리; 후자 근거 없음' };
report.correctedAutomatic.outcomes.complete -= 1;
report.correctedAutomatic.outcomes.partial += 1;
report.reviewPolicy = {
  verifierFrozen: true,
  correctionIsSeparateReview: true,
  actualFactAccuracy: null,
  notes: [
    'Kubernetes such situations은 저장 원문 앞 문맥을 확인했지만 독립 검토 needs-review를 supported로 승격하지 않음',
    'PostgreSQL/MySQL은 JSON 저장·타입 지원 사실과 기능 차이 설명을 분리했으며, 후자 근거 부족으로 partial',
    'MDN fact-value는 보존하고 usage-procedure 누락 상태를 유지',
  ],
};
report.comparison.correctedAutomaticOutcome = report.cases.map((item) => ({ id: item.id, outcome: item.outcome }));
await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputFile, noApiCalls: true, noWebSearch: true, outcomes: report.correctedAutomatic.outcomes, actualFactAccuracy: null }, null, 2));
