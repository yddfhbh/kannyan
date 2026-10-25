#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEvidenceExtractionResponse, assessRequiredAnswerItems } from '../src/general-search-llm-extraction.js';
import { assessFocusedCase } from '../src/general-search-focused-assessment.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const runFile = arg('--run', path.join(root, 'tmp/general-search-focused-gemini-run-20261024.json'));
const inputFile = arg('--input', path.join(root, 'tmp/general-search-focused-gemini-runner-input-20261024.json'));
const outputFile = arg('--output', path.join(root, 'tmp/general-search-focused-gemini-replay-validation-20261024.json'));
const [run, input] = await Promise.all([runFile, inputFile].map(async (file) => JSON.parse(await fs.readFile(file, 'utf8'))));
const items = new Map(input.cases.map((item) => [item.id, item]));
const modelKeys = ['subject', 'relation', 'value', 'unit', 'sourceId', 'sourceUrl', 'quote', 'sourceSpan', 'sourceChunkId', 'context', 'appliesAt', 'requiredAnswerItems', 'uncertainties'];
const cases = run.results.map((row) => {
  const item = items.get(row.id);
  if (!item?.sources?.length) throw new Error(`Missing saved sources: ${row.id}`);
  const raw = { facts: row.methodB.facts.map((fact) => Object.fromEntries(modelKeys.filter((key) => key in fact).map((key) => [key, fact[key]]))) };
  // The production extractor passes the model JSON through this exact parser.
  const livePath = parseEvidenceExtractionResponse(JSON.stringify(raw), item.sources, { strictSemantic: true });
  const offlinePath = parseEvidenceExtractionResponse(raw, item.sources, { strictSemantic: true });
  const selected = (result) => result.facts.map((fact) => ({ status: fact.status, semanticStatus: fact.semanticStatus, failures: fact.validationFailures, span: fact.sourceSpan }));
  if (JSON.stringify(selected(livePath)) !== JSON.stringify(selected(offlinePath))) throw new Error(`Parser paths differ: ${row.id}`);
  const assessment = assessFocusedCase(item, livePath.facts, assessRequiredAnswerItems(item.question, livePath.facts, { referenceTime: input.referenceTime }));
  return { id: row.id, question: row.question, responseSchemaValid: livePath.responseSchemaValid,
    facts: livePath.facts.map((fact, index) => ({ index: index + 1, subject: fact.subject, relation: fact.relation, value: fact.value, unit: fact.unit,
      quote: fact.quote, sourceUrl: fact.sourceUrl, sourceSpan: fact.sourceSpan, quoteMatchesSource: item.sources.some((source) => source.url === fact.sourceUrl && source.pageText.slice(fact.sourceSpan?.start, fact.sourceSpan?.end) === fact.quote),
      previousStatus: row.methodB.facts[index].status, previousFailures: row.methodB.facts[index].validationFailures || [], status: fact.status, semanticStatus: fact.semanticStatus, validationFailures: fact.validationFailures })),
    previousOutcome: row.evaluation.outcome, outcome: assessment.outcome, satisfiedAnswerItems: assessment.satisfied, missingAnswerItems: assessment.missing,
    independentAccuracy: null, executionAndOfflineIdentical: true };
});
const report = { version: 1, type: 'focused-gemini-saved-response-replay', runFile, inputFile, geminiApiCalls: 0, webHttpRequests: 0, holdoutAccessed: false,
  candidateCount: cases.reduce((n, item) => n + item.facts.length, 0), cases,
  totals: Object.fromEntries(['complete', 'partial', 'hold'].map((outcome) => [outcome, cases.filter((item) => item.outcome === outcome).length])), independentAccuracy: null,
  methodAComparison: 'not-comparable-different-input-conditions' };
try { await fs.access(outputFile); throw new Error(`Refusing to overwrite existing report: ${outputFile}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputFile, candidateCount: report.candidateCount, totals: report.totals, geminiApiCalls: 0, webHttpRequests: 0 }, null, 2));
