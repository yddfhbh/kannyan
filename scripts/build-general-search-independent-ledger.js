#!/usr/bin/env node
import fs from 'node:fs/promises';

const reportPath = process.argv.find((arg) => arg.startsWith('--report='))?.slice(9)
  || 'tmp/general-search-selected-12-offline-20261024.json';
const outputPath = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9)
  || 'tmp/general-search-independent-review-ledger-20261024.json';
const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
const cases = report.cases.map((item) => ({
  id: item.id, question: item.question, originalQuestion: item.originalQuestion || item.question,
  requiredAnswerItems: item.answerRequirements?.required || item.reassessment?.requiredAnswerItems || [],
  securedAnswerItems: item.answerRequirements?.satisfied || item.reassessment?.securedAnswerItems || [],
  missingAnswerItems: item.answerRequirements?.missing || item.reassessment?.missingAnswerItems || [],
  finalOutcome: item.outcome || 'hold',
  holdReasons: item.outcome === 'complete' ? [] : [item.rationale || '의미·출처·필수 항목 검토 필요'],
  officialSource: item.officialSource || { required: false, satisfied: false },
  coverage: item.coverage || { verifiedCoverage: 0, potentialCoverage: 0 },
  label: 'unreviewed',
  facts: item.facts.map((fact, index) => ({
    factId: `${item.id}-fact-${index + 1}`, reviewLabel: 'unreviewed', subject: fact.subject, relation: fact.relation,
    value: fact.value, unit: fact.unit, quote: fact.quote, boundedContext: fact.boundedContext || fact.quote,
    sourceUrl: fact.sourceUrl, sourceTitle: '', sourceDate: null,
    structuralValidation: { status: fact.structuralStatus, failures: fact.structuralFailures, sourceSpan: fact.restoredSpan, quoteInSource: fact.quoteInSource },
    semanticValidation: fact.semantic,
    officiality: { required: fact.officialSourceRequired, satisfied: fact.officialSource },
    requiredAnswerItems: item.answerRequirements?.required || [],
    validationFailures: fact.structuralFailures || [],
  })),
  reviewInstruction: '원문 URL의 실제 본문과 quote 및 bounded context를 대조해 supported/unsupported/needs-review 중 하나로 라벨링; 자동 확정 금지',
}));
await fs.writeFile(outputPath, `${JSON.stringify({ version: 2, generatedAt: new Date().toISOString(), reportPath, labelPolicy: ['supported', 'unsupported', 'needs-review', 'unreviewed'], cases }, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, caseCount: cases.length, factCount: cases.reduce((n, item) => n + item.facts.length, 0), allUnreviewed: cases.every((item) => item.label === 'unreviewed' && item.facts.every((fact) => fact.reviewLabel === 'unreviewed')) }, null, 2));
