#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyOfficialSource, extractPageEvidence } from '../src/general-search-pipeline.js';
import { selectGeneralSearchSources, selectRelevantSourceSpans } from '../src/general-search-source-selection.js';
import { buildGeneralSearchSourceSnapshot } from '../src/general-search-snapshot.js';
import { buildEvidenceExtractionInput, buildEvidenceExtractionPrompt } from '../src/general-search-llm-extraction.js';

// Reprocess the saved SSH result only. No retrieval or model client is imported.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputFile = path.join(root, 'tmp/general-search-focused-source-research-live-20261024T075220Z.json');
const reportFile = path.join(root, 'tmp/general-search-focused-offline-evidence-20261024.json');
const geminiFile = path.join(root, 'tmp/general-search-focused-offline-gemini-dry-run-20261024.json');
const live = JSON.parse(await fs.readFile(inputFile, 'utf8'));
const referenceTime = live.referenceTime;
const requirements = {
  'focus-01': ['stable-version', 'release-status', 'as-of-date'],
  'focus-02': ['free-allowance-by-plan', 'overage-billing-rule', 'unit-price-table'],
  'focus-03': ['seoul-weather-value', '2026-10-24-observation-or-forecast'],
  'focus-04': ['semiconductor-news-fact', 'publication-date-within-2026-10-18-to-24'],
  'focus-05': ['minister-name-and-title', 'evidence-date', 'incumbency-at-2026-10-24'],
  'focus-06': ['developer-event', 'free-admission', 'seoul-location', 'future-date-after-2026-10-24'],
};
const focusPatterns = {
  'focus-01': /PostgreSQL 19 RC 1|release candidate|general availability|PostgreSQL 18/i,
  'focus-02': /free minutes|quota of free minutes|included amounts is billed|Plan Artifact storage Minutes|standard GitHub Actions rates/i,
  'focus-03': /서울.{0,70}(?:24일|10월 24일|기온|날씨)|(?:24일|10월 24일).{0,70}서울/i,
  'focus-04': /반도체.{0,160}2026-10-(?:18|19|20|21|22|23|24)|2026-10-(?:18|19|20|21|22|23|24).{0,160}반도체/i,
  'focus-05': /배경훈 부총리 겸 과학기술정보통신부 장관|pstgBgngDt=2026-10-19/i,
  'focus-06': /오프라인무료세미나AI|2026\.10\.22.*?오프라인무료|10월 22일.{0,100}개발자/i,
};
const evidenceRules = {
  'focus-01': [{ item: 'release-status', pattern: /release candidate|PostgreSQL 19 RC 1/i }],
  'focus-02': [
    { item: 'free-allowance-by-plan', pattern: /Plan Artifact storage Minutes \(per month\).*?GitHub Free 500 MB 2,000.*?GitHub Enterprise Cloud 50 GB 50,000 10 GB 150 GB/i },
    { item: 'overage-billing-rule', pattern: /Any usage beyond the included amounts is billed to your account/i },
  ],
  'focus-05': [
    { item: 'minister-name-and-title', pattern: /배경훈 부총리 겸 과학기술정보통신부 장관/ },
    { item: 'evidence-date', pattern: /pstgBgngDt=2026-10-19 09:00:00\.0/ },
  ],
};
const normalizeUrl = (url) => { try { const u = new URL(url); u.hash = ''; return u.href; } catch { return String(url); } };
const rows = [];
const geminiCases = [];
for (const question of live.questions) {
  const requiredAnswerItems = requirements[question.id];
  const available = (question.reads || []).filter((read) => read.bodyLength > 0 && read.body);
  const byUrl = new Map(available.map((read) => [normalizeUrl(read.url), read]));
  const candidates = (question.candidates || []).map((candidate) => ({ ...candidate, pageText: byUrl.get(normalizeUrl(candidate.url))?.body || '' }));
  const ranked = selectGeneralSearchSources(question.question, candidates, { budgets: { maxSearchCandidates: candidates.length, maxSelectedPages: 4 } });
  // Re-rank the documents actually stored; unread discoveries remain only URLs.
  const readCandidates = available.map((read) => ({ url: read.url, finalUrl: read.finalUrl || read.url, title: read.title, pageText: read.body }));
  const readRanked = selectGeneralSearchSources(question.question, readCandidates, { budgets: { maxSearchCandidates: readCandidates.length, maxSelectedPages: 4 } });
  const selectedReads = readRanked.selected.map((candidate) => byUrl.get(normalizeUrl(candidate.url))).filter(Boolean);
  const snapshots = [];
  const sourcePages = [];
  const found = new Map();
  const seenBody = new Set();
  for (const read of selectedReads) {
    const source = { url: read.finalUrl || read.url, originalUrl: read.url, finalUrl: read.finalUrl || read.url,
      title: read.title, pageText: read.body, redirectChain: read.redirectChain || [], publishedAt: read.publishedAt || null,
      textTruncated: read.textTruncated, fullBodyLength: read.fullTextLength, maxTextLength: read.maxTextLength || (read.body.length === 8000 && read.body.endsWith('...') ? 8000 : 0) };
    const snapshot = buildGeneralSearchSourceSnapshot(question.question, source, { requiredAnswerItems });
    const body = snapshot.body.text || '';
    const bodyKey = body.replace(/\s+/g, ' ').slice(0, 400);
    if (!body || (bodyKey.length > 120 && seenBody.has(bodyKey))) continue;
    seenBody.add(bodyKey);
    const selected = selectRelevantSourceSpans(question.question, { ...source, snapshotId: snapshot.snapshotId });
    const matched = selected.blocks.filter((block) => focusPatterns[question.id].test(block.text));
    const segmentPool = matched.length ? matched : extractPageEvidence(source).blocks.filter((block) => focusPatterns[question.id].test(block.text));
    snapshot.relevantSegments = segmentPool.slice(0, 5).map((block, index) => ({
      id: `${snapshot.snapshotId}-segment-${index + 1}`, text: block.text,
      start: block.start, end: block.end, sourceSpan: { start: block.start, end: block.end },
      sourceSpanBasis: 'body.text UTF-16 code units',
    })).filter((segment) => body.slice(segment.start, segment.end) === segment.text);
    for (const rule of evidenceRules[question.id] || []) {
      const match = body.match(rule.pattern);
      if (match) {
        const sourceSpan = { start: match.index, end: match.index + match[0].length };
        found.set(rule.item, { item: rule.item, url: source.url, quote: match[0], sourceSpan, sourceSpanBasis: 'body.text UTF-16 code units' });
        if (!snapshot.relevantSegments.some((segment) => segment.start <= sourceSpan.start && segment.end >= sourceSpan.end)) {
          snapshot.relevantSegments.push({ id: `${snapshot.snapshotId}-${rule.item}`, text: match[0], start: sourceSpan.start, end: sourceSpan.end,
            sourceSpan, sourceSpanBasis: 'body.text UTF-16 code units', requiredAnswerItem: rule.item });
        }
      }
    }
    snapshots.push(snapshot);
    if (snapshot.relevantSegments.length) sourcePages.push({ ...source, sourceId: `source-${sourcePages.length + 1}`, snapshotId: snapshot.snapshotId,
      relevantSegments: snapshot.relevantSegments, body: snapshot.body, referenceTime });
  }
  const status = question.id === 'focus-02' || question.id === 'focus-05' ? (sourcePages.length ? 'partial-extraction-eligible' : 'hold') : 'hold';
  const missingAnswerItems = requiredAnswerItems.filter((item) => !found.has(item));
  const discoveredOnly = ranked.selected.filter((candidate) => !byUrl.has(normalizeUrl(candidate.url))).map((candidate) => candidate.url);
  const row = { id: question.id, originalQuestion: question.question, referenceTime, requiredAnswerItems, status,
    discoveredCandidateCount: question.candidates.length, discoveredRankedUrls: ranked.selected.map((candidate) => candidate.url),
    discoveredButUnreadUrls: discoveredOnly, obtainedBodyUrls: available.map((read) => read.url), selectedObtainedBodyUrls: selectedReads.map((read) => read.url),
    snapshots, relevantSegmentCount: snapshots.reduce((total, snapshot) => total + snapshot.relevantSegments.length, 0),
    satisfiedAnswerItems: [...found.values()], missingAnswerItems,
    disqualifiedEvidence: question.id === 'focus-01' ? [{ url: 'https://www.postgresql.org/about/news/postgresql-19-rc-1-released-3409/', reason: 'release-candidate-is-not-stable' }]
      : question.id === 'focus-04' ? [{ url: 'https://www.motir.go.kr/kor/article/ATCL3f49a5a8c/172145/view', reason: 'published-2026-09-01-outside-requested-week' }]
        : question.id === 'focus-06' ? [{ url: 'https://dev-event.vercel.app/event/detail/3212', reason: 'event-ended-2026-10-22-before-reference-date' }] : [],
    notes: question.id === 'focus-01' ? ['Official PostgreSQL 19 RC 1 announcement is a release candidate, not proof of the latest stable version.']
      : question.id === 'focus-02' ? ['Free allowance and overage principle are visible; the 8000-character upstream cut prevents verification of the complete rate table.']
        : question.id === 'focus-03' ? ['No stored official Seoul weather observation or forecast for 2026-10-24.']
          : question.id === 'focus-04' ? ['Stored ministry article was published 2026-09-01 about August trade, outside the requested week.']
            : question.id === 'focus-05' ? ['Official homepage photo caption has the minister title and 2026-10-19 posting metadata; no direct incumbency statement at 2026-10-24.']
              : ['The developer event is dated 2026-10-22 and had ended before the reference date.'],
  };
  rows.push(row);
  if (status === 'partial-extraction-eligible' && sourcePages.length && row.relevantSegmentCount > 0) {
    const extractionInput = buildEvidenceExtractionInput(question.question, sourcePages, { requiredAnswerItems, referenceTime });
    if (!extractionInput.sources.some((source) => source.segments.length)) continue;
    geminiCases.push({ id: question.id, originalQuestion: question.question, requiredAnswerItems, missingAnswerItems,
      referenceTime, sourceSnapshots: snapshots.filter((snapshot) => snapshot.relevantSegments.length),
      extractionInput, prompt: buildEvidenceExtractionPrompt(question.question, sourcePages, { requiredAnswerItems, referenceTime }) });
  }
}
const report = { version: 1, type: 'focused-general-search-offline-evidence', sourceFile: path.relative(root, inputFile),
  referenceTime, developmentQuestionDenominator: 18, improvedQuestionIds: rows.filter((row) => row.status === 'partial-extraction-eligible').map((row) => row.id),
  searchHttpRequests: 0, bodyHttpRequests: 0, geminiCalls: 0, holdoutAccessed: false, questions: rows,
  officialHostChecks: Object.fromEntries(['postgresql.org', 'docs.github.com', 'weather.go.kr', 'msit.go.kr', 'motir.go.kr', 'science.seoul.go.kr'].map((host) => [host, {
    official: classifyOfficialSource(`https://${host}/`), lookalikeRejected: !classifyOfficialSource(`https://${host}.evil.example/`),
    userinfoRejected: !classifyOfficialSource(`https://${host}@evil.example/`),
  }])),
  truncationFinding: 'fetchWebPageText uses extractReadablePageText defaultMaxTextLength=8000; saved GitHub body is 8000 UTF-16 units and ends bas..., while focused collector omitted textTruncated/fullTextLength metadata.' };
const dryRun = { version: 1, type: 'focused-general-search-gemini-dry-run', sourceFile: path.relative(root, inputFile),
  referenceTime, developmentQuestionDenominator: 18, selectedQuestionIds: geminiCases.map((item) => item.id),
  searchHttpRequests: 0, bodyHttpRequests: 0, geminiCalls: 0, holdoutAccessed: false,
  validation: { passed: geminiCases.every((item) => item.extractionInput.sources.some((source) => source.segments.length > 0)
    && item.sourceSnapshots.every((snapshot) => snapshot.relevantSegments.every((segment) => snapshot.body.text.slice(segment.start, segment.end) === segment.text))),
    rule: 'Every included question has stored body evidence and UTF-16 spans matching its snapshot.' }, cases: geminiCases };
await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
await fs.writeFile(geminiFile, `${JSON.stringify(dryRun, null, 2)}\n`);
console.log(JSON.stringify({ reportFile, geminiFile, statuses: rows.map((row) => [row.id, row.status, row.relevantSegmentCount]), dryRun: dryRun.validation, selectedQuestionIds: dryRun.selectedQuestionIds }, null, 2));
