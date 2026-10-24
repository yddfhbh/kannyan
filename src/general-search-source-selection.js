import { classifyOfficialSource, extractPageEvidence, understandSearchQuestion, rankGeneralCandidates } from './general-search-pipeline.js';

// Source selection keeps ownership, freshness, relevance, and body quality
// separate rather than treating the word “official” as ownership.
export const SOURCE_SELECTION_BUDGETS = Object.freeze({
  maxSearchCandidates: 12,
  maxSelectedPages: 4,
  maxSourceTokens: 3200,
  maxContextTokensPerPage: 900,
});

const profile = (understanding) => {
  const q = understanding.original;
  if (understanding.claimType === 'version') return { kind: 'version', release: true, official: true };
  if (understanding.claimType === 'price') return { kind: 'price', pricing: true, official: true };
  if (understanding.claimType === 'comparison') {
    const pair = q.match(/(.+?)\s*(?:과|와|vs\.?|versus|및|and)\s*(.+?)(?:의\s*)?(?:기능|사양|가격|요금)?\s*비교/i);
    return { kind: 'comparison', subjects: pair ? [pair[1], pair[2]].map((part) => part.trim()) : [], official: understanding.officialRequired };
  }
  if (/사용법|API|probe|문서|설명/i.test(q)) return { kind: 'documentation', official: understanding.officialRequired };
  if (understanding.claimType === 'event' || understanding.claimType === 'person' || /뉴스/i.test(q)) return { kind: 'news-event', article: /뉴스/i.test(q), official: understanding.officialRequired };
  return { kind: understanding.claimType, official: understanding.officialRequired };
};

const titleText = (candidate) => [candidate.title, candidate.articleTitle, candidate.snippet].filter(Boolean).join(' ');
const bodyText = (candidate) => String(candidate.pageText ?? candidate.text ?? '');
const normalizedHost = (url) => { try { return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const normalizedPath = (url) => { try { return new URL(String(url)).pathname.replace(/\/+/g, '/').replace(/\/$/, '') || '/'; } catch { return ''; } };
const siteRestriction = (value) => {
  const raw = String(value || '').trim().replace(/^site:/i, '').replace(/^https?:\/\//i, '').split(/[?#\s]/, 1)[0];
  if (!raw) return null;
  const slash = raw.indexOf('/');
  const hostname = (slash < 0 ? raw : raw.slice(0, slash)).toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const pathPrefix = slash < 0 ? '/' : `/${raw.slice(slash + 1).replace(/^\/+|\/+$/g, '')}`;
  return hostname ? { hostname, pathPrefix: pathPrefix === '/' ? '/' : pathPrefix.toLowerCase() } : null;
};
export function parseSiteRestrictions(queries = []) {
  return [...new Map((Array.isArray(queries) ? queries : [queries]).flatMap((query) => [...String(query || '').matchAll(/(?:^|\s)site:([^\s]+)/gi)].map((match) => siteRestriction(match[1])).filter(Boolean).map((restriction) => [`${restriction.hostname}${restriction.pathPrefix}`, restriction]))).values()];
}
const matchesSiteRestriction = (url, restriction) => {
  let parsed;
  try { parsed = new URL(String(url)); } catch { return false; }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const hostMatches = host === restriction.hostname || host.endsWith(`.${restriction.hostname}`);
  if (!hostMatches) return false;
  if (restriction.pathPrefix === '/') return true;
  const pathname = parsed.pathname.replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase() || '/';
  return pathname === restriction.pathPrefix || pathname.startsWith(`${restriction.pathPrefix}/`);
};
const tokenCount = (text) => String(text || '').trim().split(/\s+/u).filter(Boolean).length;
const versionRank = (candidate) => {
  const value = titleText(candidate).match(/(?:version[\s-]*|v|[A-Za-z][\w-]*[\s-]+)(\d+(?:[.-]\d+){0,2})\b/i)?.[1];
  return value ? value.split(/[.-]/).map((part) => Number(part) || 0) : [];
};
const compareVersionRank = (left, right) => {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference) return difference;
  }
  return 0;
};
const officialWords = /official|공식|documentation|문서|release notes|요금표|pricing|downloads|다운로드/i;
const articlePath = /\/article\/|\/news\/|\/story\/|\/replay\/|\/posts?\/|\/20\d{2}[/-]\d{1,2}/i;
const homePath = /^https?:\/\/[^/]+\/?$/i;
const isHomeUrl = (url) => {
  try { return /^\/(?:[a-z]{2}(?:[_-][A-Z]{2})?)?\/?$/u.test(new URL(String(url)).pathname); } catch { return false; }
};
const securityPath = /security|vulnerability|denial-of-service|source-code-exposure|cve/i;
const releasePath = /(?:^|\/)(?:v?\d+(?:\.\d+){1,2}(?:[-_/]?(?:release|changelog|changes|downloads?))?)(?:[/?#]|$)/i;

function relevantTerms(understanding) {
  return [...new Set(understanding.target.filter((term) => term.length >= 2 && !/^(오늘|내일|현재|최신|최근|공식|문서|자료|비교|뉴스|소식|가격|요금|버전|안정)$/i.test(term)))];
}

export function sourceSelectionProfile(question, options = {}) {
  const understanding = options.understanding ?? understandSearchQuestion(question, options.now);
  const base = { understanding, ...profile(understanding), terms: relevantTerms(understanding) };
  return { ...base, requiredHosts: [], siteRestrictions: parseSiteRestrictions(options.siteQueries || options.siteQuery || []) };
}

export function scoreSourceCandidate(question, candidate, options = {}) {
  const plan = sourceSelectionProfile(question, options);
  const title = titleText(candidate);
  const body = bodyText(candidate);
  const all = `${title}\n${candidate.snippet || ''}\n${body}\n${candidate.url || ''}`;
  const terms = plan.terms;
  const termHits = terms.filter((term) => all.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
  const titleHits = terms.filter((term) => title.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
  const officialHost = classifyOfficialSource(candidate.finalUrl || candidate.url);
  const host = normalizedHost(candidate.url);
  const requiredSourceMatch = plan.requiredHosts.some((root) => host === root || host.endsWith(`.${root}`));
  const sitePathMatch = plan.siteRestrictions.length === 0 || plan.siteRestrictions.some((restriction) => matchesSiteRestriction(candidate.url, restriction));
  const officialTextSignal = officialWords.test(`${title}\n${body}`);
  const hasBody = Boolean(body.trim());
  const page = hasBody ? extractPageEvidence(candidate) : null;
  const bodyTokens = tokenCount(page?.body || body);
  const bodyNoise = (page?.body.match(/(?:메뉴|로그인|광고|추천|전화|이메일|copyright|navigation)/gi) || []).length;
  const noiseRatio = bodyNoise / Math.max(1, (page?.body || body).split(/\s+/u).length);
  const date = Boolean(String(candidate.publishedAt || candidate.datePublished || all).match(/20\d{2}[-./년]\s*\d{1,2}/));
  const fresh = plan.understanding.needsFreshness && date ? 2 : 0;
  const article = articlePath.test(String(candidate.url || '')) && !homePath.test(String(candidate.url || '')) && !isHomeUrl(candidate.url);
  const role = plan.kind === 'news-event' && plan.article ? (article ? 3 : -3) : 0;
  const candidatePath = String(candidate.url || '');
  const releaseDocument = plan.release && !securityPath.test(candidatePath) && (releasePath.test(candidatePath) || /release|릴리스|출시|download|다운로드|version|버전|LTS|stable|안정/i.test(`${title}\n${body}\n${candidatePath}`));
  const release = releaseDocument ? 12 : 0;
  const securityPenalty = plan.release && securityPath.test(candidatePath) ? -10 : 0;
  const pricing = plan.pricing && /pricing|가격|요금|price|free tier|프리.?티어|요청/i.test(`${title}\n${body}`) ? 4 : 0;
  const documentation = plan.kind === 'documentation' && /docs?|developer|API|문서|probe|signal/i.test(`${title}\n${body}`) ? 3 : 0;
  const subjectHits = plan.subjects?.filter((subject) => all.toLocaleLowerCase().includes(subject.toLocaleLowerCase())) || [];
  const sourceCoverage = plan.kind === 'comparison' ? subjectHits.length : 0;
  const bodyQuality = hasBody ? (bodyTokens >= 80 ? 2 : 1) : candidate.snippet ? 1 : 0;
  const noisePenalty = noiseRatio > 0.08 ? -2 : 0;
  const sourceMatchBonus = requiredSourceMatch ? 8 : 0;
  const pathPenalty = (homePath.test(candidatePath) || isHomeUrl(candidatePath)) ? -8 : (/whitepapers?\//i.test(candidatePath) && plan.pricing ? -4 : 0);
  const detailBonus = /\/(?:news|articles?|posts?|events?|releases?|pricing|billing)\/[^/]+/i.test(candidatePath) ? 5 : 0;
  const prereleasePenalty = plan.release && /(?:release.candidate|\brc[ -]?\d|beta|preview)/i.test(`${title} ${candidatePath}`) ? -12 : 0;
  const score = termHits.length * 4 + titleHits.length * 3 + bodyQuality + (officialHost ? 7 : 0) + sourceMatchBonus + fresh + role + release + securityPenalty + pricing + documentation + sourceCoverage * 3 + noisePenalty + pathPenalty + detailBonus + prereleasePenalty;
  return { candidate, score, signals: { kind: plan.kind, termHits, titleHits, subjectHits, officialHost, officialTextSignal, requiredSourceMatch, sitePathMatch, siteRestrictions: plan.siteRestrictions, requiredHosts: plan.requiredHosts, hasBody, bodyTokens, noiseRatio, date, fresh, article, role, release, releaseDocument, versionRank: versionRank(candidate), securityPenalty, pricing, documentation, sourceCoverage, bodyQuality, noisePenalty, pathPenalty, detailBonus, prereleasePenalty } };
}

export function isEligibleSourceCandidate(question, candidate, options = {}) {
  const scored = scoreSourceCandidate(question, candidate, options);
  const { signals } = scored;
  if (/^(?:about|support|documentation|docs|download|downloads|products|features|pricing|home|login|sign in|새 창 열림)$/i.test(String(candidate.title || '').replace(/새 창 열림/g, '').trim())
    && /^https?:\/\/[^/]+\/?$/i.test(String(candidate.url || ''))) return { eligible: false, reason: 'site-navigation', scored };
  // A site:-restricted question must never promote a result from another host.
  if (signals.requiredHosts.length > 0 && !signals.requiredSourceMatch) return { eligible: false, reason: 'required-host-mismatch', scored };
  if (!signals.sitePathMatch) return { eligible: false, reason: 'site-path-mismatch', scored };
  if (scored.signals.kind === 'version' && scored.signals.officialHost === false) return { eligible: false, reason: 'official-release-source-required', scored };
  // Host ownership alone is not topical relevance. URL paths are included in
  // the score input, so this also handles result cards whose title/snippet is empty.
  const topical = signals.termHits.length > 0 || signals.titleHits.length > 0 || signals.subjectHits.length > 0
    || signals.documentation > 0 || signals.pricing > 0 || signals.releaseDocument;
  if (!topical) return { eligible: false, reason: 'no-topical-relevance', scored };
  if (signals.kind === 'version' && signals.securityPenalty < 0 && !signals.releaseDocument) return { eligible: false, reason: 'security-not-release-evidence', scored };
  return { eligible: true, reason: '', scored };
}

export function selectGeneralSearchSources(question, candidates, options = {}) {
  const budgets = { ...SOURCE_SELECTION_BUDGETS, ...options.budgets };
  const assessed = (candidates || []).map((candidate, index) => ({ ...isEligibleSourceCandidate(question, candidate, options), index }));
  const ranked = assessed.filter((entry) => entry.eligible).map((entry) => ({ ...entry.scored, index: entry.index }))
    .sort((a, b) => b.score - a.score || b.signals.bodyQuality - a.signals.bodyQuality || compareVersionRank(b.signals.versionRank, a.signals.versionRank) || a.index - b.index);
  const selected = [];
  const seenHosts = new Set();
  const seenUrls = new Set();
  const seenBodies = new Set();
  const subjectCoverage = new Set();
  for (const entry of ranked.slice(0, budgets.maxSearchCandidates)) {
    const host = normalizedHost(entry.candidate.url);
    const urlKey = `${host}${normalizedPath(entry.candidate.url)}`;
    const bodyKey = bodyText(entry.candidate).trim().replace(/\s+/g, ' ').slice(0, 300);
    if (seenUrls.has(urlKey) || (bodyKey.length >= 120 && seenBodies.has(bodyKey))) continue;
    const subjects = entry.signals.subjectHits || [];
    const addsSubject = subjects.some((subject) => !subjectCoverage.has(subject));
    const diverse = !host || !seenHosts.has(host) || addsSubject || selected.length < 2;
    if (selected.length < budgets.maxSelectedPages && diverse) {
      selected.push(entry);
      if (host) seenHosts.add(host);
      seenUrls.add(urlKey);
      if (bodyKey.length >= 120) seenBodies.add(bodyKey);
      subjects.forEach((subject) => subjectCoverage.add(subject));
    }
  }
  const selectedSet = new Set(selected.map((entry) => entry.index));
  const diagnostics = assessed.slice(0, budgets.maxSearchCandidates).map((entry) => ({
    ...(entry.scored ? { score: entry.scored.score, signals: entry.scored.signals } : {}),
    url: entry.scored.candidate.url || '', title: entry.scored.candidate.title || '', selected: selectedSet.has(entry.index),
    exclusionReason: selectedSet.has(entry.index) ? '' : (!entry.eligible ? entry.reason : (selected.length >= budgets.maxSelectedPages ? 'selection-budget' : 'duplicate-host-or-lower-coverage')),
  }));
  return { profile: sourceSelectionProfile(question, options), budgets, ranked, eligible: ranked.map((entry) => entry.candidate), selected: selected.map((entry) => entry.candidate), diagnostics,
    counts: { rawCandidateCount: (candidates || []).length, eligibleCandidateCount: assessed.filter((entry) => entry.eligible).length, officialEligibleCount: assessed.filter((entry) => entry.eligible && entry.scored.signals.requiredSourceMatch).length, selectedRelevantCount: selected.length } };
}

export function selectRelevantSourceSpans(question, source, options = {}) {
  const budgets = { ...SOURCE_SELECTION_BUDGETS, ...options.budgets };
  const plan = sourceSelectionProfile(question, options);
  const page = extractPageEvidence(source);
  const scored = page.blocks.map((block, index) => {
    const lower = block.text.toLocaleLowerCase();
    const hits = plan.terms.filter((term) => lower.includes(term.toLocaleLowerCase()));
    const typeSignal = plan.release && /release|릴리스|version|버전|LTS|stable|안정/i.test(block.text) ? 3 : 0;
    const priceSignal = plan.pricing && /price|pricing|요금|가격|무료|free|USD|달러|request|요청/i.test(block.text) ? 3 : 0;
    const docSignal = plan.kind === 'documentation' && /example|예제|사용|signal|abort|liveness|readiness|probe|API|호출/i.test(block.text) ? 3 : 0;
    const dateSignal = plan.understanding.needsFreshness && /20\d{2}|발행|published|오늘|내일/i.test(block.text) ? 2 : 0;
    const contentSignal = block.text.length >= 60 ? 2 : 0;
    const navigationNoise = /^(?:specifications?|see also|help improve|view in english|prev|up|next|changelog|other notable|related documentation|documentation home)/i.test(block.text.trim()) ? -8 : 0;
    return { block, index, score: hits.length * 4 + typeSignal + priceSignal + docSignal + dateSignal + contentSignal + navigationNoise, hits, typeSignal, priceSignal, docSignal, dateSignal };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = [];
  let tokens = 0;
  for (const entry of scored) {
    const count = tokenCount(entry.block.contextSpan || entry.block.text);
    if (selected.length >= Math.ceil(budgets.maxContextTokensPerPage / 250) || tokens + count > budgets.maxContextTokensPerPage) continue;
    selected.push({ ...entry.block, id: `${source.snapshotId || 'source'}-segment-${selected.length + 1}`, selectionScore: entry.score, selectionSignals: { hits: entry.hits, typeSignal: entry.typeSignal, priceSignal: entry.priceSignal, docSignal: entry.docSignal, dateSignal: entry.dateSignal }, sourceSpan: { start: entry.block.start, end: entry.block.end }, sourceSpanBasis: 'body.text UTF-16 code units' });
    tokens += count;
  }
  return { url: source.url || '', title: page.title, bodyLength: page.body.length, originalTokens: tokenCount(page.body), selectedTokens: tokens, blocks: selected, omittedBlocks: Math.max(0, page.blocks.length - selected.length), bodyNoiseRatio: (page.body.match(/(?:메뉴|로그인|광고|추천|전화|이메일)/gi) || []).length / Math.max(1, page.body.split(/\s+/u).length) };
}

export function classifyStoredFailure(question, candidates, selected, spans = []) {
  const all = candidates || [];
  const selectedUrls = new Set((selected || []).map((item) => item.url));
  const sourceBody = all.filter((item) => String(item.pageText ?? item.text ?? '').trim());
  const scored = all.map((item) => scoreSourceCandidate(question, item));
  const relevant = scored.filter((entry) => entry.signals.requiredSourceMatch || entry.signals.termHits.length > 0);
  const required = scored.filter((entry) => entry.signals.requiredSourceMatch);
  const selectedRelevant = relevant.filter((entry) => selectedUrls.has(entry.candidate.url));
  const selectedRequired = required.filter((entry) => selectedUrls.has(entry.candidate.url));
  const spanCount = spans.reduce((n, span) => n + (span.blocks?.length || 0), 0);
  return {
    A: required.length === 0 ? 'confirmed' : 'not-confirmed',
    B: required.length > 0 && selectedRequired.length === 0 ? 'confirmed' : 'not-confirmed',
    C: selectedRequired.length > 0 && selectedRequired.every((entry) => !String(entry.candidate.pageText ?? entry.candidate.text ?? '').trim()) ? 'confirmed' : 'not-confirmed',
    D: selectedRequired.length > 0 && sourceBody.length > 0 && spanCount === 0 ? 'possible' : 'unknown',
    E: spanCount > 0 ? 'unknown' : 'unknown',
    F: 'unknown',
    evidence: { candidateCount: all.length, relevantCandidateCount: relevant.length, requiredSourceCount: required.length, selectedRelevantCount: selectedRelevant.length, selectedRequiredSourceCount: selectedRequired.length, bodyCount: sourceBody.length, selectedSpanCount: spanCount },
  };
}

// Retained as a named bridge for reports comparing the old ranker and this selector.
export { rankGeneralCandidates };
