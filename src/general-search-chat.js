import { createGeminiEvidenceExtractor, assessRequiredAnswerItems, validateExtractedEvidenceFact } from './general-search-llm-extraction.js';
import { selectGeneralSearchSources, selectRelevantSourceSpans } from './general-search-source-selection.js';
import { readFile } from 'node:fs/promises';
import { generalSearchBudgetSnapshot } from './general-search-budget.js';
import { chatTimeRemaining } from './chat-time-budget.js';

export function generalSearchMode(value = process.env.GENERAL_SEARCH_MODE) {
  return ['off', 'shadow', 'on'].includes(value) ? value : 'off';
}

export function eligibleForGeneralSearch(question, data = {}) {
  return Boolean(String(question || '').trim()) && !data.wikiOnly && !data.chess && !data.weather
    && !data.news && !data.age && !data.image && !data.localOnly;
}

export function savedGeneralSearchPages(question, searchData, options = {}) {
  const reads = searchData?.bodyVerification?.reads || [];
  const safeRead = (read) => {
    if (read.status !== 'body-extracted' || !read.extractedBody?.trim() || read.error) return false;
    try {
      const requested = new URL(read.requestedUrl), fetched = new URL(read.fetchedUrl || read.requestedUrl);
      return [requested, fetched].every((url) => ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password)
        && (!searchData.failed || requested.hostname.replace(/^www\./, '') === fetched.hostname.replace(/^www\./, ''));
    } catch { return false; }
  };
  const pages = reads.filter(safeRead)
    .map((read) => ({ url: read.fetchedUrl || read.requestedUrl, title: read.extractedTitle || read.searchTitle,
      pageText: read.extractedBody, metadataText: read.extractedMetadata || '' }));
  for (const result of searchData?.failed ? [] : searchData?.results || []) {
    if (result.evidenceKind === 'body' && result.pageText && !pages.some((page) => page.url === result.url)) pages.push(result);
  }
  const selected = selectGeneralSearchSources(question, pages, { now: options.now }).selected;
  return selected.map((page, index) => ({ ...page, sourceId: `source-${index + 1}`,
    relevantSegments: selectRelevantSourceSpans(question, page, { now: options.now }).blocks }));
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= 300 ? url.href : '';
  } catch { return ''; }
}

export function renderGeneralSearchAnswer(result) {
  const facts = result.assessment?.answerEligible || [];
  if (result.outcome === 'hold' || !facts.length) return '요청한 사실을 확인할 근거를 찾지 못했다냥.';
  const lines = [result.outcome === 'complete' ? '확인된 근거는 다음과 같다냥.' : '일부만 확인했다냥.'];
  for (const fact of facts.slice(0, 3)) {
    const url = safeUrl(fact.sourceUrl || result.pages.find((page) => page.sourceId === fact.sourceId)?.url);
    if (!url) continue;
    lines.push(`- ${String(fact.quote).replace(/\s+/g, ' ').slice(0, 200)}\n  출처: ${url}`);
  }
  if (result.outcome === 'partial') lines.push(`확인하지 못한 항목: ${result.assessment.missing.join(', ') || '질문의 나머지 조건'}.`);
  return lines.join('\n');
}

// The caller supplies the existing search result. Shadow never invokes the
// extractor unless an offline saved response is explicitly injected.
export async function runGeneralSearchChat(question, searchData, options = {}) {
  const mode = generalSearchMode(options.mode);
  if (mode === 'off') return { mode, action: 'legacy' };
  if (!searchData) return { mode, action: 'legacy', reason: 'search-failed' };
  const pages = options.pages || savedGeneralSearchPages(question, searchData, options);
  if (!pages.length) return { mode, action: 'legacy', reason: searchData.failed ? 'search-failed' : 'body-unavailable' };
  const reviewError = searchData.bodyVerification?.error;
  if (searchData.failed && (['request-limit', 'time-limit', 'time-reservation'].includes(reviewError?.category)
    || /(?:BUDGET|_LIMIT)$/.test(reviewError?.code || '')))
    return { mode, action: 'legacy', reason: 'review-budget-exhausted', pages: pages.length };
  let replayExtraction = options.replayExtraction;
  if (mode === 'shadow' && !replayExtraction && process.env.GENERAL_SEARCH_SHADOW_REPLAY_FILE) {
    try {
      const saved = JSON.parse(await readFile(process.env.GENERAL_SEARCH_SHADOW_REPLAY_FILE, 'utf8'));
      const row = saved.results?.find((entry) => entry.question === question);
      if (row) replayExtraction = async () => ({ responseSchemaValid: true, facts: row.methodB?.facts || [] });
    } catch { /* A missing or malformed replay file cannot alter the legacy response. */ }
  }
  if (mode === 'shadow' && !replayExtraction) return { mode, action: 'legacy', reason: 'shadow-no-saved-response', pages: pages.length };
  const budget = generalSearchBudgetSnapshot();
  if (mode === 'on' && !replayExtraction && !options.extract
    && ((budget && (budget.aborted || budget.extractions >= 1 || budget.remainingMs < 1500)) || chatTimeRemaining() < 1500))
    return { mode, action: 'legacy', reason: 'extraction-budget-exhausted', pages: pages.length };
  const extract = replayExtraction || options.extract || createGeminiEvidenceExtractor({ maxCalls: 1 });
  let extraction;
  try {
    extraction = await extract({ question, pages, referenceTime: options.now ? new Date(options.now).toISOString() : new Date().toISOString() });
  } catch {
    return { mode, action: 'legacy', reason: 'extraction-error', pages: pages.length };
  }
  if (extraction.skipped || extraction.responseSchemaValid !== true) return { mode, action: 'legacy', reason: extraction.skipped || 'invalid-extraction', pages: pages.length, extractionCalls: extraction.calls || 0, extractionStatus: extraction.error?.status ?? null };
  // Only strictSemantic-approved facts may reach assessment or display.
  const verified = (extraction.facts || []).map((fact) => validateExtractedEvidenceFact(fact, pages, { strictSemantic: true }))
    .filter((fact) => fact.status === 'verified' && fact.semanticSupport === true);
  const assessment = assessRequiredAnswerItems(question, verified, { now: options.now });
  const asOfDate = String(question).match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0];
  if (asOfDate && !verified.some((fact) => fact.appliesAt === asOfDate)) {
    assessment.missing = [...new Set([...assessment.missing, `기준일 ${asOfDate} 적용 사실`])];
    assessment.outcome = assessment.answerEligible.length ? 'partial' : 'hold';
  }
  const outcome = assessment.outcome;
  const result = { mode, action: mode === 'shadow' ? 'legacy' : 'verified', outcome, assessment, pages,
    verifiedCount: verified.length, rejectedCount: (extraction.facts || []).length - verified.length,
    extractionCalls: extraction.calls || 0 };
  return { ...result, answer: renderGeneralSearchAnswer(result) };
}
