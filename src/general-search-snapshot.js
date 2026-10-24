import { extractPageEvidence, classifyOfficialSource } from './general-search-pipeline.js';

// Snapshot bodies stay in memory and are never written to diagnostic logs.
const sensitivePatterns = [
  /(?:api[_ -]?key|access[_ -]?token|secret|password|passwd|client[_ -]?secret)\s*[:=]\s*[^\s,;]+/i,
  /(?:AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{16,}|gh[pousr]_[0-9A-Za-z_]{20,})/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /(?:authorization|x-api-key)\s*:\s*bearer?\s+[^\s]+/i,
];

function hostnameOf(url) {
  try { return new URL(String(url)).hostname.toLowerCase(); } catch { return ''; }
}

function hasSensitiveContent(text) {
  return sensitivePatterns.some((pattern) => pattern.test(String(text || '')));
}

function urlHistory(source) {
  const redirects = Array.isArray(source?.redirectChain) ? source.redirectChain : [];
  return redirects.map((item) => ({
    status: Number.isInteger(item?.status) ? item.status : null,
    from: String(item?.from || ''), to: String(item?.to || ''),
  }));
}

function spanForFact(fact, body) {
  if (Number.isInteger(fact?.sourceSpan?.start) && Number.isInteger(fact?.sourceSpan?.end)) {
    const start = Math.max(0, fact.sourceSpan.start);
    const end = Math.min(body.length, fact.sourceSpan.end);
    if (end > start && body.slice(start, end) === fact.quote) return { start, end };
  }
  if (fact?.quote) {
    const start = body.indexOf(fact.quote);
    if (start >= 0) return { start, end: start + fact.quote.length };
  }
  return null;
}

export function buildGeneralSearchSourceSnapshot(question, source, options = {}) {
  const page = extractPageEvidence({ ...source, pageText: source?.pageText ?? source?.body ?? source?.text ?? '' });
  const originalUrl = String(source?.originalUrl || source?.requestedUrl || source?.url || '');
  const finalUrl = String(source?.finalUrl || source?.url || '');
  const body = page.body;
  const sensitive = hasSensitiveContent(body) || hasSensitiveContent(source?.html);
  const facts = Array.isArray(options.facts) ? options.facts : [];
  const spans = facts.map((fact) => spanForFact(fact, body)).filter(Boolean);
  const relevantRanges = spans.length ? spans.map(({ start, end }) => ({
    start, end, text: body.slice(start, end),
  })) : [];
  const bodyAvailable = Boolean(body) && !sensitive;
  const explicitTruncated = source?.bodyTruncated === true || source?.textTruncated === true || source?.truncated === true;
  const maxTextLength = Number(source?.maxTextLength || 0);
  const suspectedLimit = body.length >= 7900 && /\.\.\.$/.test(body);
  const bodyTruncated = explicitTruncated || (maxTextLength > 0 && body.length >= maxTextLength) || suspectedLimit;
  const truncationAssessment = bodyTruncated ? (explicitTruncated || maxTextLength > 0 ? 'truncated' : 'suspected-upstream-8000-limit') : (body.length >= 7900 ? 'unknown-near-8000-limit' : 'not-observed');
  const snapshotId = String(source?.snapshotId || `${hostnameOf(finalUrl || originalUrl)}:${body.length}:${body.slice(0, 32)}`);
  return {
    version: 2,
    snapshotId,
    status: sensitive ? 'sensitive-content-blocked' : (body ? 'captured' : 'body-snapshot-missing'),
    question: String(question || ''),
    search: { engine: options.searchEngine || null, query: options.query || null, selectionReason: options.selectionReason || null },
    source: {
      originalUrl, finalUrl, hostname: hostnameOf(finalUrl || originalUrl),
      official: classifyOfficialSource(finalUrl || originalUrl),
      httpStatus: Number.isInteger(source?.status) ? source.status : null,
      redirectChain: urlHistory(source),
      title: page.title, publishedAt: source?.publishedAt || source?.datePublished || null,
      modifiedAt: source?.modifiedAt || source?.dateModified || null,
      canonicalUrl: source?.canonicalUrl || '',
    },
    body: bodyAvailable ? { text: body, length: body.length, storedLength: body.length, fullLength: source?.fullBodyLength ?? (bodyTruncated ? null : body.length), truncated: bodyTruncated, truncationAssessment, normalization: 'extractPageEvidence-v1' } : { text: null, length: body.length, storedLength: body.length, fullLength: source?.fullBodyLength ?? null, truncated: bodyTruncated, truncationAssessment, normalization: 'extractPageEvidence-v1' },
    relevantSegments: bodyAvailable ? relevantRanges : [],
    requiredAnswerItems: options.requiredAnswerItems || [],
    sourceSpanBasis: 'body.text; identical to extractPageEvidence.body',
    safety: { sensitiveContentDetected: sensitive, bodyStored: bodyAvailable },
  };
}

export function buildSnapshotLedger(question, sources, options = {}) {
  return (sources || []).map((source, index) => buildGeneralSearchSourceSnapshot(question, source, {
    ...options, selectionReason: options.selectionReasons?.[index] || options.selectionReason,
    facts: (options.facts || []).filter((fact) => fact.sourceUrl === source.url),
  }));
}
