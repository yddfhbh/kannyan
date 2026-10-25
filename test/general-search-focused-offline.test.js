import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyOfficialSource } from '../src/general-search-pipeline.js';
import { selectGeneralSearchSources } from '../src/general-search-source-selection.js';
import { buildGeneralSearchSourceSnapshot } from '../src/general-search-snapshot.js';

const live = JSON.parse(fs.readFileSync(new URL('../tmp/general-search-focused-source-research-live-20261024T075220Z.json', import.meta.url), 'utf8'));

test('official hosts require exact DNS suffix and reject deceptive URLs', () => {
  for (const host of ['postgresql.org', 'docs.github.com', 'weather.go.kr', 'msit.go.kr', 'motir.go.kr', 'science.seoul.go.kr']) {
    assert.equal(classifyOfficialSource(`https://${host}/page`), true);
    assert.equal(classifyOfficialSource(`https://${host}.evil.example/page`), false);
    assert.equal(classifyOfficialSource(`https://${host}@evil.example/page`), false);
  }
});

test('stored PostgreSQL release announcements outrank LinkedIn and are discovery only until read', () => {
  const row = live.questions.find((item) => item.id === 'focus-01');
  const ranked = selectGeneralSearchSources(row.question, row.candidates, { budgets: { maxSearchCandidates: row.candidates.length, maxSelectedPages: 4 } });
  assert.ok(ranked.selected.some((item) => item.url.includes('postgresql-18-released')));
  assert.ok(ranked.selected.every((item) => !item.url.includes('linkedin.com')));
  assert.ok(ranked.selected.some((item) => !row.reads.some((read) => read.url === item.url)));
});

test('saved GitHub 8000-character body is treated as truncated', () => {
  const read = live.questions.find((item) => item.id === 'focus-02').reads[0];
  assert.equal(read.body.length, 8000);
  assert.ok(read.body.endsWith('bas...'));
  const snapshot = buildGeneralSearchSourceSnapshot('GitHub Actions 요금제', { url: read.url, pageText: read.body });
  assert.equal(snapshot.body.truncated, true);
  assert.equal(snapshot.body.fullLength, null);
});

test('snapshot official flag follows the final redirect host', () => {
  const snapshot = buildGeneralSearchSourceSnapshot('서울 날씨', {
    originalUrl: 'https://www.weather.go.kr/w/index.do', finalUrl: 'https://weather.go.kr.evil.example/page',
    url: 'https://weather.go.kr.evil.example/page', pageText: '서울 날씨',
    redirectChain: [{ status: 302, from: 'https://www.weather.go.kr/w/index.do', to: 'https://weather.go.kr.evil.example/page' }],
  });
  assert.equal(snapshot.source.official, false);
});

test('dry run includes only questions with matching UTF-16 evidence spans', () => {
  const result = JSON.parse(fs.readFileSync(new URL('../tmp/general-search-focused-offline-gemini-dry-run-20261024.json', import.meta.url), 'utf8'));
  assert.deepEqual(result.selectedQuestionIds, ['focus-02', 'focus-05']);
  assert.equal(result.geminiCalls, 0);
  for (const item of result.cases) for (const snapshot of item.sourceSnapshots) for (const segment of snapshot.relevantSegments) {
    assert.equal(snapshot.body.text.slice(segment.start, segment.end), segment.text);
  }
  const report = JSON.parse(fs.readFileSync(new URL('../tmp/general-search-focused-offline-evidence-20261024.json', import.meta.url), 'utf8'));
  assert.equal(report.developmentQuestionDenominator, 18);
  assert.equal(report.questions.find((item) => item.id === 'focus-06').status, 'hold');
  assert.ok(report.questions.find((item) => item.id === 'focus-05').missingAnswerItems.includes('incumbency-at-2026-10-24'));
});
