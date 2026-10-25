#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSnapshotLedger } from '../src/general-search-snapshot.js';
import { understandSearchQuestion, requestedAnswerRequirements } from '../src/general-search-pipeline.js';

const root = process.cwd();
const input = process.argv.find((arg) => arg.startsWith('--input='))?.slice(8)
  || path.join(root, 'tmp/general-search-bodies-final-semantic.json');
const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9)
  || path.join(root, 'tmp/general-search-source-snapshot-dry-run.json');
const data = JSON.parse(await fs.readFile(input, 'utf8'));
const cases = (data.cases || []).map((item) => {
  const sources = (item.reads || item.sources || []).map((source) => ({
    ...source, pageText: source.pageText ?? source.body ?? source.text ?? '',
  }));
  const understanding = understandSearchQuestion(item.question, item.referenceTime || undefined);
  const snapshots = buildSnapshotLedger(item.question, sources, {
    searchEngine: item.search?.engine || null, query: item.search?.query || null,
    requiredAnswerItems: item.requiredAnswerItems || requestedAnswerRequirements(understanding),
  });
  return { id: item.id, question: item.question, snapshots };
});
const summary = {
  version: 1, dryRun: true, input, generatedAt: new Date().toISOString(),
  actualHttpRequests: 0, geminiApiCalls: 0, tokenUsage: { input: null, output: null }, expectedBudget: { httpRequests: 0, geminiApiCalls: 0, cost: null },
  cases, counts: {
    captured: cases.flatMap((item) => item.snapshots).filter((item) => item.status === 'captured').length,
    bodySnapshotMissing: cases.flatMap((item) => item.snapshots).filter((item) => item.status === 'body-snapshot-missing').length,
    sensitiveContentBlocked: cases.flatMap((item) => item.snapshots).filter((item) => item.status === 'sensitive-content-blocked').length,
  },
  note: 'offline input only; no web search, HTTP request, Gemini call, or Discord output',
};
await fs.writeFile(output, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, cases: cases.length, ...summary.counts, actualHttpRequests: 0, geminiApiCalls: 0 }, null, 2));
