import { canCollectEvidence } from './chat-time-budget.js';
import { searchIdentityAnchors } from './chat-source-plan.js';
import { classifyChatError } from './chat-errors.js';
import { fetchWebPageText } from './web-page-content.js';
import { searchWeb } from './web-search.js';
import { reviewSourceBodies, evidenceRequestMismatch, isExamFeeRequest } from './evidence-review.js';

// Metadata selection is deliberately independent of body length/extraction success.
const normalize = (s) => String(s || '').normalize('NFKC').toLowerCase();
const contains = (text, term) => normalize(text).includes(normalize(term));
const terms = (s) => normalize(s).match(/[\p{Letter}\p{Number}]+/gu) || [];

// One identity for requests and redirect destinations; query parameters that
// choose a station/date are retained. Only transport/tracking noise is removed.
export function webCandidateKey(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    if (/^(?:www\.)?weather\.go\.kr$/.test(url.hostname) && /^\/(?:w\/index\.do)?$/.test(url.pathname)) url.pathname = '/w/index.do';
    return url.href;
  } catch { return String(value); }
}

function weatherMainUrl(value) {
  return /^https:\/\/(?:[\w-]+\.)?(?:weather\.go\.kr\/(?:w\/(?:e?index)\.do|busan\/html\/main\/(?:index\.jsp)?)?|kma\.go\.kr\/(?:[^?#]*\/)?(?:main\/(?:index\.jsp)?|weather\/main\.jsp))(?:[?#].*)?$/i.test(value || '');
}

function feeCountry(text) {
  return String(text).match(/한국|대한민국|South Korea|Korea|미국|United States|일본|Japan|인도|India|중국|China/i)?.[0] || '';
}

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
    let eligible = !wrongDirection && (groups.length !== 2 || targetMatches.some(Boolean));
    let topicReason = '';
    let authorityScore = 0;
    if (/날씨|기온|weather/i.test(query)) {
      const region = String(query).match(/([가-힣]+)\s*(?:현재\s*|오늘\s*)?(?:날씨|기온)/)?.[1];
      const official = /^https:\/\/(?:[\w-]+\.)*(?:weather|kma)\.go\.kr\//i.test(candidate.url || '');
      const weather = /기상청|날씨누리|예보|기온|weather|forecast|강수|소나기/i.test(metadata);
      const target = !region || contains(metadata, region) || /전국/.test(metadata) || official;
      const main = weatherMainUrl(candidate.url);
      if (!weather || !target || /날씨요정|페스티벌|독자산행|로드쇼|관광청|youtube\.com|tiktok\.com/i.test(metadata)) topicReason = 'weather-target-or-attribute-mismatch';
      if (main) topicReason = 'weather-main-screen';
      authorityScore = official ? /forecast|예보 통보문/i.test(metadata) ? 80 : 40 : 0;
    }
    if (isExamFeeRequest(query) && /토플|TOEFL/i.test(query)) {
      const official = /^https:\/\/(?:[a-z0-9-]+\.)*ets\.org\/toefl\//i.test(candidate.url || '');
      const differentType = /주니어|Junior|ITP|기관토플|Essentials/i.test(heading) && !/주니어|Junior|ITP|기관토플|Essentials/i.test(query);
      if (differentType || /지원\s*(?:사업|금)|전면 지원|응시료.{0,12}지원|학원비|수강료|강좌|멤버십/i.test(heading)) topicReason = 'fee-subsidy-tuition-or-other-exam';
      else if (!official && (!/토플|TOEFL/i.test(metadata) || !/응시료|가격|수수료|fee|cost|price/i.test(metadata))) topicReason = 'no-base-exam-fee-in-metadata';
      const locale = String(candidate.url || '').match(/^https:\/\/(?:www\.)?([a-z]{2})\.ets\.org\//i)?.[1];
      const country = feeCountry(query);
      const allowedLocale = /미국|United States/i.test(country) ? 'us' : /일본|Japan/i.test(country) ? 'jp' : /인도|India/i.test(country) ? 'in' : /중국|China/i.test(country) ? 'cn' : 'kr';
      if (locale && locale !== allowedLocale) topicReason = 'fee-country-mismatch-in-metadata';
      if (/\bIndia\b|\bINR\b|₹/i.test(metadata) && !/인도|India/i.test(country)) topicReason = 'fee-country-mismatch-in-metadata';
      authorityScore = official ? /\/fees(?:\.html|\/|$)/i.test(candidate.url) ? 100 : 50 : 0;
    }
    eligible &&= !topicReason;
    return { candidate, index, eligible, targetMatches, attributeMatches,
      score: targetMatches.filter(Boolean).length * 10 + attributeMatches + authorityScore,
      reason: topicReason || (wrongDirection ? 'different-or-reversed-route-in-metadata' : !eligible ? 'no-endpoint-in-metadata' : targetMatches.every(Boolean) && groups.length ? 'target-and-attribute-ranking' : 'partial-identity-or-topic-ranking') };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.index - b.index);
}

export async function collectWebBodyEvidence(query, initial, generate, options = {}) {
  const read = options.readPage ?? fetchWebPageText;
  const search = options.search ?? searchWeb;
  const originalQuestion = options.originalPrompt || query;
  const anchors = searchIdentityAnchors(query);
  const groups = anchors.map((a) => [a]);
  const attributeTerms = terms(String(query).replace(/^(?:from\s+)?(.+?)\s+(?:to|→|->)\s+(.+?)(?=\s+(?:flight|travel|journey|duration|time|distance)\b|$)/i, ''));
  const reviewCalls = [];
  const reads = [], searches = [], selections = [], reviews = [], decisions = [], aliases = [], aliasReviews = [], refinements = [];
  const queue = [];
  const candidatePool = new Map();
  const reviewedSources = new Set();
  const fetched = new Set();
  const suppressedSnippets = new Set();
  const scopeEvidence = [];
  const seen = new Set(), searched = new Set([normalize(query)]);
  const started = Date.now();
  const logger = options.logger;
  const limits = { searches: 2, reads: 4, durationMs: 25_000 };
  let reviewed = [], retryFailed = false, reviewFailure = false, reviewError, refinement;
  const remaining = () => ({ searches: limits.searches - searches.length, reads: limits.reads - reads.length,
    durationMs: Math.max(0, limits.durationMs - (Date.now() - started)), external: options.getRemainingBudget?.() ?? null });
  const budgetReason = (operation = 'search') => {
    const b = remaining();
    if (!b.durationMs || b.external?.durationMs === 0) return 'time-budget-exhausted';
    if (!canCollectEvidence()) return 'completion-time-reserved';
    if (operation === 'search' && !b.searches) return 'search-budget-exhausted';
    if (operation === 'read' && !b.reads) return 'read-budget-exhausted';
    if (b.external) {
      // remaining() already excludes reservations. Fund one more evidence review
      // plus only the completion calls not already reserved, without borrowing.
      const modelNeeded = 1 + Math.max(0, 2 - (b.external.reservedModelRequests || 0));
      const httpNeeded = (operation === 'repair' ? 1 : operation === 'read' ? 2 : 4) + Math.max(0, 2 - (b.external.reservedHttpRequests || 0));
      if (b.external.durationMs <= 14_000) return 'completion-time-reserved';
      if (b.external.modelRequests + (b.external.reservedEvidenceRequests || 0) < modelNeeded) return b.external.reservedModelRequests || b.external.modelRequests > 0 ? 'model-budget-reserved-for-answer' : 'model-budget-exhausted';
      if (b.external.httpRequests + (b.external.reservedEvidenceRequests || 0) < httpNeeded) return b.external.reservedHttpRequests || b.external.httpRequests > 0 ? 'http-budget-reserved-for-answer' : 'http-budget-exhausted';
    }
    return '';
  };
  const queryRejection = (q) => {
    if (typeof q !== 'string') return 'invalid-query-type';
    if (!q.trim() || q.length > 300 || /[\u0000-\u001f]/.test(q)) return 'invalid-query-text';
    if (isExamFeeRequest(query) && /토플|TOEFL/i.test(query)) {
      const country = feeCountry(originalQuestion);
      if (country && !contains(q, country) && !(/한국|대한민국/i.test(country) && /Korea/i.test(q))) return 'fee-country-scope-dropped';
      if (!country && /[가-힣]/.test(query) && !/토플|한국|대한민국|Korea/i.test(q)) return 'fee-locale-scope-dropped';
    }
    if (searched.has(normalize(q.trim()))) return 'duplicate-search';
    if (queue.some((entry) => normalize(entry.query) === normalize(q.trim()))) return 'duplicate-queued-query';
    if (groups.length === 2) {
      const positions = groups.map((g) => g.map((a) => normalize(q).indexOf(normalize(a))).filter((p) => p >= 0));
      if (!positions.every((p) => p.length)) return 'unverified-endpoint';
      if (Math.min(...positions[0]) >= Math.min(...positions[1])) return 'reversed-endpoints';
    } else if (!anchors.every((a) => contains(q, a))) return 'unverified-identity';
    return '';
  };
  function enqueue(q, round, origin, index) {
    const reason = queryRejection(q);
    const trace = { query:q, round, origin, index, accepted:!reason,
      reason:reason || 'identity-and-direction-preserved', status:reason ? 'rejected' : 'queued' };
    refinements.push(trace);
    if (reason) return;
    const usesAlias = groups.some((g) => g.slice(1).some((a) => contains(q, a)));
    const preservesAttribute = attributeTerms.some((term) => terms(q).includes(term));
    const priority = origin === 'publisher-fees' ? 3 : origin === 'official-fallback' ? 0 : usesAlias && preservesAttribute ? 2 : 1;
    Object.assign(trace, {usesVerifiedAlias:usesAlias, preservesAttribute, priority});
    queue.push({ subject:query, query:q.trim(), trace, priority });
    queue.sort((a,b) => b.priority - a.priority);
  }
  function acceptRefinement(value, sources, round) {
    refinement = value;
    // Identity evidence is independent of whether a source answers the requested attribute.
    const pending = Array.isArray(value?.aliases) ? value.aliases.slice(0, 24) : [];
    // Expand only an explicit local name/alias + labeled-code construction in a cited quote.
    // This does not infer codes from a model's memory or a different part of the page.
    for (const a of [...pending]) {
      if (typeof a?.quote !== 'string') continue;
      const relation = a.quote.match(/^([^()\n]+?)\s+or\s+([\p{Letter}\p{Number}-]+)\s*\((IATA:\s*[A-Z]{3}(?:,\s*ICAO:\s*[A-Z]{4})?)\)/u);
      if (!relation || ![relation[1], relation[2]].some((name) => normalize(name.trim()) === normalize(a.from))) continue;
      for (const code of relation[3].matchAll(/(IATA|ICAO):\s*([A-Z]{3,4})/g)) {
        pending.push({ from:a.from, to:code[2], sourceId:a.sourceId, quote:a.quote, relation:code[1], derived:'explicit-labeled-code' });
      }
    }
    const checks = pending.map((a) => ({ ...a, round, accepted:false, reason:'unconnected-identity' }));
    for (let pass = 0; pass < pending.length; pass++) {
      for (let index = 0; index < pending.length; index++) {
        const a = pending[index], check = checks[index];
        if (check.accepted) continue;
        if (![a?.from,a?.to,a?.quote].every((v) => typeof v === 'string' && v.trim()) || a.quote.length > 600) { check.reason='invalid-alias-shape'; continue; }
        const source = Number.isInteger(a.sourceId) && sources[a.sourceId];
        const text = source && [source.title, source.metadataText, source.pageText].filter(Boolean).join('\n');
        if (!text?.includes(a.quote)) { check.reason='quote-not-in-source'; continue; }
        if (!contains(a.quote, a.from) || !contains(a.quote, a.to)) { check.reason='alias-not-in-quote'; continue; }
        const group = groups.find((g) => g.some((name) => normalize(name) === normalize(a.from)));
        if (!group) continue;
        if (groups.some((g) => g !== group && g.some((name) => normalize(name) === normalize(a.to)))) { check.reason='endpoint-identity-conflict'; continue; }
        check.accepted=true; check.reason='quoted-identity';
        if (group.some((name) => normalize(name) === normalize(a.to))) continue;
        group.push(a.to.trim()); aliases.push({ ...a, round, url: source.url, evidenceKind: source.evidenceKind });
      }
    }
    aliasReviews.push(...checks);
    if (Array.isArray(value?.queries)) value.queries.forEach((q, index) => {
      if (index < 8) enqueue(q, round, 'model', index);
      else refinements.push({query:q, round, origin:'model', index, accepted:false, status:'rejected', reason:'candidate-limit'});
    });
    // Reuse the original attribute with the best verified endpoint labels before adding "official".
    if (groups.length === 2 && groups.some((g) => g.length > 1)) {
      let improved = query;
      for (const group of groups) {
        const alias = aliases.find((a) => a.relation === 'IATA' && group.includes(a.to))?.to || group[1];
        if (alias) improved = improved.replace(new RegExp(group[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), () => alias);
      }
      enqueue(improved, round, 'verified-alias-attribute');
    }
  }
  async function collect(items, round, actualQuery = query, readAllowance = 2) {
    for (const item of items) if (!candidatePool.has(webCandidateKey(item.url))) candidatePool.set(webCandidateKey(item.url), item);
    const ranked = rankWebCandidates(query, items, groups);
    selections.push(...ranked.map(({candidate, ...ranking}) => ({ round, url: candidate.url, title: candidate.title, snippet: candidate.snippet, ...ranking })));
    const sources = [];
    let roundReads = 0;
    for (const { candidate, eligible } of ranked) {
      if (!canCollectEvidence(2500) || !eligible || roundReads >= readAllowance || reads.length >= limits.reads || Date.now() - started >= limits.durationMs) continue;
      const candidateKey = webCandidateKey(candidate.url);
      if (seen.has(candidateKey) || fetched.has(candidateKey)) continue;
      seen.add(candidateKey); roundReads++;
      const trace = { requestedUrl: candidate.url, searchTitle: candidate.title, round, status: 'unavailable', remainingBefore: remaining(), startedAt: Date.now() };
      reads.push(trace);
      try {
        const page = await read(candidate.url, { timeoutMs: 2500, totalTimeoutMs: 2500, maxTextLength: 5000 });
        Object.assign(trace, { fetchedUrl: page.url, extractedTitle: page.title, extractedBody: page.text, bodyQuality: page.bodyQuality, extractedMetadata: page.metadataText });
        const fetchedKey = webCandidateKey(page.url || candidate.url);
        if (fetched.has(fetchedKey)) { trace.status = 'duplicate-fetched-url'; suppressedSnippets.add(candidateKey); continue; }
        fetched.add(fetchedKey); seen.add(fetchedKey);
        if (/날씨|기온|weather/i.test(query) && weatherMainUrl(page.url)) { trace.status = 'weather-main-screen'; suppressedSnippets.add(candidateKey); suppressedSnippets.add(fetchedKey); continue; }
        if (isExamFeeRequest(query) && /토플|TOEFL/i.test(query) && /^https:\/\/(?:[\w-]+\.)*ets\.org\/toefl\//i.test(page.url || '')) {
          const quote = page.text?.match(/등록비를 확인하려면 시험 장소를 선택하세요\.?|To (?:see|view|check)[^.\n]{0,100}(?:select|choose)[^.\n]{0,80}(?:location|country)[^.\n]*\.?/i)?.[0];
          if (quote && !scopeEvidence.length) scopeEvidence.push({ url:page.url, quote, scope:'location-dependent-registration-fee' });
        }
        if (!page.text?.trim()) { trace.status = 'insufficient-body'; logEvidenceEvent(logger, { stage: 'body-read', status: trace.status, durationMs: Date.now() - trace.startedAt, resultCount: 0 }); continue; }
        sources.push({ title: page.articleTitle || page.title, url: page.url, pageText: page.text, metadataText: page.metadataText || '', evidenceKind: 'body', discoveredTitle: candidate.title, discoveredUrl: candidate.url });
        trace.status = 'body-extracted';
        trace.bodySuccess = true;
        logEvidenceEvent(logger, { stage: 'body-read', status: trace.status, durationMs: Date.now() - trace.startedAt, resultCount: 1, bodySuccessCount: 1 });
        suppressedSnippets.add(candidateKey); suppressedSnippets.add(fetchedKey);
        if (scopeEvidence.length && !feeCountry(originalQuestion)) break;
      } catch (error) { trace.error = classifyChatError(error); trace.status = trace.error.category === 'validator' ? 'extraction-failed' : 'read-failed'; logEvidenceEvent(logger, { stage: 'body-read', status: trace.status, durationMs: Date.now() - trace.startedAt, resultCount: 0, httpStatus: error.status ?? null }); }
    }
    for (const { candidate } of ranked.filter(r => r.eligible).slice(0, 4)) {
      if (suppressedSnippets.has(webCandidateKey(candidate.url))) continue;
      if (candidate.snippet?.trim()) sources.push({ title: candidate.title, url: candidate.url, pageText: candidate.snippet, evidenceKind: 'search-snippet', metadataText: candidate.publishedAt || '' });
    }
    if (!sources.length) return;
    sources.splice(4);
    for (let i = sources.length - 1; i >= 0; i--) {
      const key = `${sources[i].url}\0${sources[i].pageText}`;
      if (reviewedSources.has(key)) sources.splice(i, 1);
      else reviewedSources.add(key);
    }
    if (!sources.length) return;
    try {
      const batch = await reviewSourceBodies(`기준일: ${new Date(options.now ?? Date.now()).toISOString()}\n질문 원문: ${originalQuestion}\n실제 검색어: ${actualQuery}`, sources, generate, { now: options.now, repairInvalidReviews: true, canRepair: () => !budgetReason('repair'), onRefinement: (value, sources) => acceptRefinement(value, sources, round) });
      reviewed.push(...batch);
      logEvidenceEvent(logger, { stage: 'evidence-validation', status: 'completed', durationMs: Date.now() - started, resultCount: batch.length, validationSuccessCount: batch.filter((s) => s.bodyReview.relevant).length });
      reviews.push(...batch.map((s) => ({ round, url:s.url, evidenceKind:s.evidenceKind, ...s.bodyReview })));
      reviewFailure ||= batch.some((s) => s.bodyReview.status === 'invalid-review');
      for (const s of batch.filter(s => s.bodyReview.repairError)) reviews.push({ round, url: s.url, status: 'repair-failed', error: s.bodyReview.repairError });
    } catch (error) { reviewFailure = true; reviewError = { ...classifyChatError(error), reviewMetrics: error.reviewMetrics }; logEvidenceEvent(logger, { stage: 'evidence-validation', status: 'failed', durationMs: Date.now() - started, resultCount: sources.length });
      reviewCalls.push({ round, status: 'review-call-failed', error: reviewError, sources: sources.map(s => ({ url: s.url, evidenceKind: s.evidenceKind })) }); }
  }
  const subjects = String(query).split(/\s+vs\.?\s+|\s+versus\s+/i).map((s) => s.trim()).filter(Boolean);
  const initialCandidates = [...(initial.candidates ?? initial.results ?? [])];
  // A known publisher endpoint is a retrieval candidate, never evidence by
  // itself. The fetched bulletin must still pass region/date/body validation.
  if (/(?:부산|울산)\s*(?:의\s*|오늘\s*)?날씨/.test(originalQuestion)) {
    const url = 'https://www.weather.go.kr/w/forecast/notice.do?stnId=159';
    if (!initialCandidates.some(c => webCandidateKey(c.url) === webCandidateKey(url))) {
      initialCandidates.unshift({url,title:'예보 통보문(부산·울산·경남)',origin:'official-regional-bulletin'});
    }
  }
  await collect(initialCandidates, 0);
  const accepted = () => reviewed.filter((s) => s.bodyReview.relevant);
  const scopeOnly = () => scopeEvidence.length > 0 && !feeCountry(originalQuestion);
  const insufficient = () => !scopeOnly() && (!accepted().length || refinement?.requestedSatisfied === false);
  if (subjects.length === 2) {
    for (const entry of queue) Object.assign(entry.trace, {status:'not-executed', executionReason:'comparison-subject-search'});
    queue.length = 0;
    queue.push(...subjects.map((s) => ({ subject:s, query:`"${s}" official documentation` })));
  } else enqueue(`${query} official`, 0, 'official-fallback');
  if (isExamFeeRequest(query) && /토플|TOEFL/i.test(query)) enqueue(`${query} site:ets.org/toefl/test-takers/ibt/register/fees TOEFL registration fees`, 0, 'publisher-fees');
  let stopReason = 'requested-evidence-found';
  while (subjects.length === 2 ? searches.length < 2 : insufficient()) {
    const condition = accepted().length ? 'requested-attribute-insufficient' : reviewFailure ? 'review-error' : reviewed.length ? 'review-rejected' : 'no-reviewable-material';
    // Reserve one body read for each remaining search. Retained candidates
    // can use the surplus, including after the search allowance reaches zero.
    const pending = rankWebCandidates(query, [...candidatePool.values()], groups).filter(r => r.eligible && !seen.has(webCandidateKey(r.candidate.url)) && !fetched.has(webCandidateKey(r.candidate.url)));
    const retainedAllowance = Math.min(2, remaining().reads - remaining().searches);
    if (pending.length && retainedAllowance > 0 && !budgetReason('read')) {
      decisions.push({ condition, action: 'read-retained-candidates', count: pending.length, remaining: remaining() });
      const before = reads.length;
      await collect(pending.map(r => r.candidate), searches.length, query, retainedAllowance);
      if (reads.length > before) continue;
    }
    stopReason = budgetReason('read') || budgetReason();
    if (stopReason) { decisions.push({ condition, action:'stop', reason:stopReason, remaining:remaining() }); break; }
    const next = queue.shift();
    if (!next) { stopReason = 'no-safe-query-refinement'; decisions.push({ condition, action:'stop', reason:stopReason, remaining:remaining() }); break; }
    if (searched.has(normalize(next.query))) {
      if (next.trace) Object.assign(next.trace, {status:'not-executed', executionReason:'duplicate-search'});
      continue;
    }
    if (next.trace) Object.assign(next.trace, {status:'executed', executionReason:'search-dispatched'});
    searched.add(normalize(next.query));
    decisions.push({ condition, action:'search', query:next.query, remaining:remaining() });
    const trace = { subject:next.subject, query:next.query, remainingBefore:remaining(), status:'pending' }; searches.push(trace);
    try {
      const retry = await search(next.query, { maxResults: 8, timeoutMs: 5000 });
      retryFailed ||= Boolean(retry.failed);
      Object.assign(trace, { query:retry.query || next.query, status:retry.status, attempts:retry.attempts, resultCount: (retry.results ?? []).length, resultCounts: retry.resultCounts, candidateCount: (retry.candidates ?? retry.results ?? []).length });
      await collect(retry.candidates ?? retry.results ?? [], searches.length, next.query, Math.min(2, remaining().reads - remaining().searches));
    } catch (error) { retryFailed = true; Object.assign(trace, {status:'failed', error:classifyChatError(error)}); }
  }
  if (!decisions.length || decisions.at(-1).action !== 'stop') {
    stopReason = scopeOnly() ? 'location-required' : insufficient() ? budgetReason('read') || budgetReason() || 'no-safe-query-refinement' : 'requested-evidence-found';
    decisions.push({ condition:scopeOnly() ? 'country-required-for-price' : insufficient() ? 'requested-attribute-insufficient' : 'requested-evidence-sufficient', action:'stop', reason:stopReason, remaining:remaining() });
  }
  for (const entry of queue) {
    if (entry.trace) Object.assign(entry.trace, {status:'not-executed', executionReason:stopReason});
  }
  // Keep the original body for date/condition checks at rendering and final
  // verification. Prompt construction separately uses the accepted quote.
  const results = accepted();
  const failureEvents = [
    ...reviewCalls.map(e => ({ stage: 'evidence-review', ...e })),
    ...(initial.attempts ?? []).map(a => ({ stage: 'search', round: 0, ...a })),
    ...searches.flatMap((s, i) => (s.attempts ?? [{ status: s.status, error: s.error }]).map(a => ({ stage: 'search', round: i + 1, ...a }))),
    ...reads.filter(r => !['body-extracted', 'duplicate-fetched-url'].includes(r.status)).map(r => ({ stage: 'body-read', url: r.requestedUrl, status: r.status, error: r.error })),
    ...reviews.filter(r => !r.relevant).map(r => ({ stage: 'evidence-validation', url: r.url, status: r.status, validationFailures: r.validationFailures, reason: r.reason })),
  ].filter(e => !['success', 'empty'].includes(e.status));
  const retrievalFailed = !results.length && !reviewed.length && (retryFailed || reads.some((r) => r.status === 'read-failed'));
  const status = results.length ? (reviewFailure || retryFailed || initial.failed ? 'partial-success' : 'success')
    : scopeEvidence.length ? 'sourced-partial' : reviewFailure ? 'review-failed' : retrievalFailed ? 'retrieval-failed'
      : !reviewed.length && reads.some((r) => ['insufficient-body', 'extraction-failed'].includes(r.status)) ? 'extraction-failed'
        : reviewed.length ? 'insufficient-evidence' : initial.status || 'empty';
  logEvidenceEvent(logger, { stage: 'evidence-collection', status, durationMs: Date.now() - started,
    resultCount: candidatePool.size, bodySuccessCount: reads.filter((r) => r.status === 'body-extracted').length,
    validationSuccessCount: results.length, budgetExhausted: remaining().searches <= 0 || remaining().reads <= 0 || remaining().durationMs <= 0 });
  return { ...initial, query: initial.query || query, results, status,
    retrievalStatus:initial.status, failed: !results.length && !scopeEvidence.length && Boolean(initial.failed || reviewFailure || retrievalFailed),
    bodyVerification: { initialResultCount: (initial.results ?? []).length, initialResultCounts: initial.resultCounts, retainedCandidateCount: candidatePool.size, failureEvents, reviewMetrics: reviewed.map((s) => s.bodyReview.reviewMetrics).filter((m, i, all) => all.indexOf(m) === i), originalQuestion, query, retrievalStatus:initial.status, reads, searches, selections, aliases, aliasReviews, identityGroups:groups, refinements, decisions,
      limits, remaining:remaining(), exhaustedBudgets: ['searches', 'reads', 'durationMs'].filter(key => remaining()[key] <= 0), scopeEvidence, stopReason, requestedSatisfied:accepted().length > 0 && refinement?.requestedSatisfied !== false, modelRequestedSatisfied:refinement?.modelRequestedSatisfied, error:reviewError, reviewCalls, reviews } };
}

function logEvidenceEvent(logger, event) {
  const method = logger?.warn && ['failed', 'read-failed', 'extraction-failed', 'review-failed'].includes(event.status) ? 'warn' : 'log';
  if (typeof logger?.[method] !== 'function') return;
  logger[method](`[WEB EVIDENCE] stage=${event.stage} status=${event.status} httpStatus=${event.httpStatus ?? 'none'} durationMs=${event.durationMs} resultCount=${event.resultCount ?? 0} bodySuccessCount=${event.bodySuccessCount ?? 0} validationSuccessCount=${event.validationSuccessCount ?? 0} budgetExhausted=${Boolean(event.budgetExhausted)}`);
}

export function renderWeatherEvidence(data, prompt = '', now) {
  const sources = (data?.results ?? []).filter((s) => {
    const r = s.bodyReview;
    return !evidenceRequestMismatch(prompt, s, r, now) && r?.relevant && r.region && r.validTime && ['observation', 'forecast'].includes(r.kind)
      && r.weatherFields?.some((f) => /-?\d+(?:\.\d+)?\s*(?:°|℃|도|mm|%|m\/s)|맑음|흐림|흐려짐|구름\s*많(?:음|다가)/.test(f));
  });
  return sources.slice(0, 1).map(({ bodyReview: r, url }) =>
    r.verificationMethod === 'kma-regional-daily-section'
      ? `${r.region} ${r.validTime} 예보는 다음과 같다냥.\n${r.regionalTitle}, ${r.publicationTime}\n${r.quote}\n${url}`
      : `${r.region} ${r.validTime} ${r.kind === 'forecast' ? '예보' : '관측'}에서는 ${r.weatherFields.join(', ')}로 확인된다냥. 자료에 없는 날씨 상태·기온·강수 정보는 답하지 않는다냥.\n${url}`).join('\n');
}
