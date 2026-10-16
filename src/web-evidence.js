import { searchIdentityAnchors } from './chat-source-plan.js';
import { classifyChatError } from './chat-errors.js';
import { fetchWebPageText } from './web-page-content.js';
import { searchWeb } from './web-search.js';
import { reviewSourceBodies } from './evidence-review.js';

// Metadata selection is deliberately independent of body length/extraction success.
const normalize = (s) => String(s || '').normalize('NFKC').toLowerCase();
const contains = (text, term) => normalize(text).includes(normalize(term));
const terms = (s) => normalize(s).match(/[\p{Letter}\p{Number}]+/gu) || [];

export function rankWebCandidates(query, items, identityGroups = []) {
  const anchors = searchIdentityAnchors(query);
  const groups = identityGroups.length ? identityGroups : anchors.map((a) => [a]);
  const attribute = String(query).replace(/^(?:from\s+)?(.+?)\s+(?:to|→|->)\s+(.+?)(?=\s+(?:flight|travel|journey|duration|time|distance)\b|$)/i, '').trim();
  return items.map((candidate, index) => {
    const metadata = [candidate.title, candidate.url, candidate.snippet].filter(Boolean).join(' ');
    const targetMatches = groups.map((group) => group.some((a) => contains(metadata, a)));
    const attributeMatches = terms(attribute || query).filter((t) => contains(metadata, t)).length;
    // A directional hit naming neither endpoint is no reason to spend a body read.
    const heading = [candidate.title, candidate.url].filter(Boolean).join(' ');
    const directional = /\s(?:to|→|->)\s/i.test(candidate.title || '');
    const positions = groups.map((g) => Math.min(...g.map((a) => normalize(heading).indexOf(normalize(a))).filter((p) => p >= 0)));
    const wrongDirection = groups.length === 2 && directional && (!targetMatches.every(Boolean) || positions[0] >= positions[1]);
    const eligible = !wrongDirection && (groups.length !== 2 || targetMatches.some(Boolean));
    return { candidate, index, eligible, targetMatches, attributeMatches,
      score: targetMatches.filter(Boolean).length * 10 + attributeMatches,
      reason: wrongDirection ? 'different-or-reversed-route-in-metadata' : !eligible ? 'no-endpoint-in-metadata' : targetMatches.every(Boolean) && groups.length ? 'target-and-attribute-ranking' : 'partial-identity-or-topic-ranking' };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.index - b.index);
}

export async function collectWebBodyEvidence(query, initial, generate, options = {}) {
  const read = options.readPage ?? fetchWebPageText;
  const search = options.search ?? searchWeb;
  const originalQuestion = options.originalPrompt || query;
  const anchors = searchIdentityAnchors(query);
  const groups = anchors.map((a) => [a]);
  const reads = [], searches = [], selections = [], reviews = [], decisions = [], aliases = [], refinements = [];
  const seen = new Set(), searched = new Set([normalize(query)]);
  const started = Date.now();
  const limits = { searches: 2, reads: 4, durationMs: 25_000 };
  let reviewed = [], retryFailed = false, reviewFailure = false, reviewError, refinement;
  const remaining = () => ({ searches: limits.searches - searches.length, reads: limits.reads - reads.length,
    durationMs: Math.max(0, limits.durationMs - (Date.now() - started)), external: options.getRemainingBudget?.() ?? null });
  const budgetReason = () => {
    const b = remaining();
    if (!b.durationMs) return 'time-budget-exhausted';
    if (!b.searches) return 'search-budget-exhausted';
    if (b.external && (b.external.httpRequests < 2 || b.external.modelRequests < 3 || b.external.durationMs <= 0)) return 'external-budget-reserved-for-answer';
    return '';
  };
  function acceptRefinement(value, sources) {
    refinement = value;
    // Build a supported alias graph, including multi-hop mappings, without a name dictionary.
    const pending = Array.isArray(value?.aliases) ? value.aliases.slice(0, 24) : [];
    for (let pass = 0; pass < pending.length; pass++) {
      for (const a of pending) {
        if (!a.from?.trim() || !a.to?.trim() || !a.quote?.trim() || a.quote.length > 600) continue;
        const source = sources[a.sourceId];
        const text = source && [source.title, source.metadataText, source.pageText].filter(Boolean).join('\n');
        if (!text?.includes(a.quote) || !contains(a.quote, a.from) || !contains(a.quote, a.to)) continue;
        const group = groups.find((g) => g.some((name) => normalize(name) === normalize(a.from)));
        if (!group || group.some((name) => normalize(name) === normalize(a.to))) continue;
        // Never merge the original two endpoints into one identity.
        if (groups.some((g) => g !== group && g.some((name) => normalize(name) === normalize(a.to)))) continue;
        group.push(a.to.trim()); aliases.push({ ...a, url: source.url, evidenceKind: source.evidenceKind });
      }
    }
  }
  async function collect(items, round) {
    const ranked = rankWebCandidates(query, items, groups);
    selections.push(...ranked.map(({candidate, ...ranking}) => ({ round, url: candidate.url, title: candidate.title, snippet: candidate.snippet, ...ranking })));
    const sources = [];
    let roundReads = 0;
    for (const { candidate, eligible } of ranked) {
      if (!eligible || roundReads >= 2 || reads.length >= limits.reads || Date.now() - started >= limits.durationMs) continue;
      if (seen.has(candidate.url)) continue;
      seen.add(candidate.url); roundReads++;
      const trace = { requestedUrl: candidate.url, searchTitle: candidate.title, round, status: 'unavailable' };
      reads.push(trace);
      try {
        const page = await read(candidate.url, { timeoutMs: 2500, totalTimeoutMs: 2500, maxTextLength: 5000 });
        Object.assign(trace, { fetchedUrl: page.url, extractedTitle: page.title, extractedBody: page.text, bodyQuality: page.bodyQuality, extractedMetadata: page.metadataText });
        if (!page.text?.trim()) { trace.status = 'insufficient-body'; continue; }
        sources.push({ title: page.articleTitle || page.title, url: page.url, pageText: page.text, metadataText: page.metadataText || '', evidenceKind: 'body', discoveredTitle: candidate.title, discoveredUrl: candidate.url });
        trace.status = 'body-extracted';
      } catch (error) { trace.error = classifyChatError(error); trace.status = trace.error.category === 'validator' ? 'extraction-failed' : 'read-failed'; }
    }
    for (const { candidate } of ranked.slice(0, 8)) {
      if (candidate.snippet?.trim()) sources.push({ title: candidate.title, url: candidate.url, pageText: candidate.snippet, evidenceKind: 'search-snippet', metadataText: candidate.publishedAt || '' });
    }
    if (!sources.length) return;
    try {
      const batch = await reviewSourceBodies(`기준일: ${new Date(options.now ?? Date.now()).toISOString()}\n질문 원문: ${originalQuestion}\n실제 검색어: ${query}`, sources, generate, { onRefinement: acceptRefinement });
      reviewed.push(...batch);
      reviews.push(...batch.map((s) => ({ round, url:s.url, evidenceKind:s.evidenceKind, ...s.bodyReview })));
      reviewFailure ||= batch.some((s) => s.bodyReview.status === 'invalid-review');
    } catch (error) { reviewFailure = true; reviewError = classifyChatError(error); }
  }
  await collect(initial.results ?? [], 0);
  const subjects = String(query).split(/\s+vs\.?\s+|\s+versus\s+/i).map((s) => s.trim()).filter(Boolean);
  const accepted = () => reviewed.filter((s) => s.bodyReview.relevant);
  // Legacy reviewers without a completeness field retain their partial evidence.
  const insufficient = () => !accepted().length || refinement?.requestedSatisfied === false;
  const validQuery = (q) => {
    if (typeof q !== 'string' || !q.trim() || q.length > 300 || /[\u0000-\u001f]/.test(q) || searched.has(normalize(q))) return false;
    if (groups.length === 2) {
      const positions = groups.map((g) => g.map((a) => normalize(q).indexOf(normalize(a))).filter((p) => p >= 0));
      return positions.every((p) => p.length) && Math.min(...positions[0]) < Math.min(...positions[1]);
    }
    return anchors.every((a) => contains(q, a));
  };
  const suggested = (Array.isArray(refinement?.queries) ? refinement.queries : []).slice(0, 8).filter((q) => {
    const accepted = validQuery(q);
    refinements.push({ query:q, accepted, reason:accepted ? 'identity-and-direction-preserved' : 'invalid-duplicate-or-unverified-identity' });
    return accepted;
  }).slice(0, 2);
  const queue = subjects.length === 2 ? subjects.map((s) => ({ subject:s, query:`"${s}" official documentation` }))
    : [...suggested.map((q) => ({subject:query, query:q})), {subject:query, query:`${query} official`}];
  let stopReason = 'requested-evidence-found';
  while (subjects.length === 2 ? searches.length < 2 : insufficient()) {
    const condition = accepted().length ? 'requested-attribute-insufficient' : reviewFailure ? 'review-error' : reviewed.length ? 'review-rejected' : 'no-reviewable-material';
    stopReason = budgetReason();
    if (stopReason) { decisions.push({ condition, action:'stop', reason:stopReason, remaining:remaining() }); break; }
    const next = queue.shift();
    if (!next) { stopReason = 'no-safe-query-refinement'; decisions.push({ condition, action:'stop', reason:stopReason, remaining:remaining() }); break; }
    if (searched.has(normalize(next.query))) continue;
    searched.add(normalize(next.query));
    decisions.push({ condition, action:'search', query:next.query, remaining:remaining() });
    const trace = { ...next, remainingBefore:remaining(), status:'pending' }; searches.push(trace);
    try {
      const retry = await search(next.query, { maxResults: 8, timeoutMs: 5000 });
      retryFailed ||= Boolean(retry.failed);
      Object.assign(trace, { query:retry.query || next.query, status:retry.status, attempts:retry.attempts });
      await collect(retry.results ?? [], searches.length);
    } catch (error) { retryFailed = true; Object.assign(trace, {status:'failed', error:classifyChatError(error)}); }
  }
  if (!decisions.length || decisions.at(-1).action !== 'stop') {
    stopReason = insufficient() ? budgetReason() || 'no-safe-query-refinement' : 'requested-evidence-found';
    decisions.push({ condition:insufficient() ? 'requested-attribute-insufficient' : 'requested-evidence-sufficient', action:'stop', reason:stopReason, remaining:remaining() });
  }
  const results = accepted().map((s) => ({ ...s, pageText:s.bodyReview.quote }));
  const retrievalFailed = !results.length && (retryFailed || (!reviewed.length && reads.some((r) => r.status === 'read-failed')));
  const status = results.length ? (reviewFailure || retryFailed || initial.failed ? 'partial-success' : 'success')
    : reviewFailure ? 'review-failed' : retrievalFailed ? 'retrieval-failed'
      : !reviewed.length && reads.some((r) => ['insufficient-body', 'extraction-failed'].includes(r.status)) ? 'extraction-failed'
        : reviewed.length ? 'insufficient-evidence' : initial.status || 'empty';
  return { ...initial, query: initial.query || query, results, status,
    retrievalStatus:initial.status, failed: !results.length && Boolean(initial.failed || reviewFailure || retrievalFailed),
    bodyVerification: { originalQuestion, query, retrievalStatus:initial.status, reads, searches, selections, aliases, refinements, decisions,
      limits, remaining:remaining(), stopReason, requestedSatisfied:refinement?.requestedSatisfied, error:reviewError, reviews } };
}

export function renderWeatherEvidence(data) {
  const sources = (data?.results ?? []).filter((s) => s.bodyReview && (s.bodyReview.dataType === 'weather' || s.bodyReview.region || ['observation', 'forecast'].includes(s.bodyReview.kind)));
  if (!sources.length) return '';
  return sources.map((source) => {
    const review = source.bodyReview;
    const label = review.kind === 'forecast' ? '예보' : review.kind === 'observation' ? '관측 자료' : '종류 미확인 자료';
    const warning = !review.region || !review.validTime || review.kind === 'unknown' ? '지역·대상 시각·관측/예보 구분이 완전하지 않아 현재 날씨로 확인할 수 없다.\n' : '';
    return `${warning}자료 지역: ${review.region || '확인 불가'} · ${label}\n자료 대상 시각: ${review.validTime || '확인 불가'} (조회 시각과 구분)\n확인한 필드: ${(review.weatherFields || []).join(' · ') || '아래 본문 참조'}\n확인한 본문: ${review.quote}\n${source.url}`;
  }).join('\n\n');
}
