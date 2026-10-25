#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Offline adapter for the focused evidence review. The production search path is untouched.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFile = path.join(root, 'tmp/general-search-focused-offline-gemini-dry-run-20261024.json');
const evidenceFile = path.join(root, 'tmp/general-search-focused-offline-evidence-20261024.json');
const outputFile = path.join(root, 'tmp/general-search-focused-gemini-runner-input-20261024.json');
const [source, evidence] = await Promise.all([sourceFile, evidenceFile].map(async (file) => JSON.parse(await fs.readFile(file, 'utf8'))));
const selected = ['focus-02', 'focus-05'];
if (source.developmentQuestionDenominator !== 18 || evidence.developmentQuestionDenominator !== 18
  || JSON.stringify(source.selectedQuestionIds) !== JSON.stringify(selected)
  || JSON.stringify(source.cases.map((item) => item.id)) !== JSON.stringify(selected)
  || evidence.questions.length !== 6) throw new Error('Unexpected focused experiment population');
const byId = new Map(source.cases.map((item) => [item.id, item]));
const cases = evidence.questions.map((question) => {
  const focused = byId.get(question.id);
  if (!focused) return { id: question.id, question: question.originalQuestion, requiredAnswerItems: question.requiredAnswerItems,
    execution: { geminiCallAllowed: false, reason: 'focused-experiment-hold' } };
  const sources = focused.sourceSnapshots.map((snapshot) => ({
    sourceId: snapshot.snapshotId, snapshotId: snapshot.snapshotId,
    url: snapshot.source.finalUrl || snapshot.source.originalUrl, title: snapshot.source.title,
    pageText: snapshot.body.text, body: snapshot.body, relevantSegments: snapshot.relevantSegments,
    publishedAt: snapshot.source.publishedAt || null,
  }));
  if (!sources.length || sources.some((page) => !page.pageText || !page.relevantSegments.length
    || page.relevantSegments.some((segment) => page.pageText.slice(segment.sourceSpan.start, segment.sourceSpan.end) !== segment.text))) {
    throw new Error(`Invalid stored UTF-16 source span: ${question.id}`);
  }
  return { id: question.id, question: focused.originalQuestion, sourceQuestion: focused.originalQuestion,
    requiredAnswerItems: focused.requiredAnswerItems, missingAnswerItems: focused.missingAnswerItems,
    sources, execution: { geminiCallAllowed: true, focusedEvidenceOnly: true } };
});
if (cases.filter((item) => item.execution.geminiCallAllowed).map((item) => item.id).join(',') !== selected.join(',')) {
  throw new Error('Unexpected callable case set');
}
const input = { version: 1, type: 'focused-general-search-gemini-runner-input', referenceTime: source.referenceTime,
  developmentQuestionDenominator: 18, maxGeminiHttpRequests: 2, searchHttpRequests: 0, bodyHttpRequests: 0,
  holdoutAccessed: false, sourceFile: path.relative(root, sourceFile), cases };
await fs.writeFile(outputFile, `${JSON.stringify(input, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ outputFile, callable: selected, holds: cases.filter((item) => !item.execution.geminiCallAllowed).map((item) => item.id), developmentQuestionDenominator: 18 }, null, 2));
