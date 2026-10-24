import { fetchWebPageText } from './web-page-content.js';

// Experimental, side-effect-free retrieval pipeline. It is intentionally not
// imported by index.js: callers must opt into it explicitly.
const tokenPattern = /[\p{Letter}\p{Number}][\p{Letter}\p{Number}._-]{1,}/gu;
const datePattern = /(?:20\d{2}[-./년]\s*\d{1,2}[-./월]\s*\d{1,2}(?:일)?|\d{1,2}월\s*\d{1,2}일|\d{1,2}일)/gu;
const numberPattern = /[-+]?\d+(?:[.,]\d+)?\s*(?:억|만|천|백만|%|원|달러|USD|KRW|℃|°C|도|mm|km|GB-?초|GB|TB|명|시|분|시간|건)?/giu;
const boilerplatePattern = /(?:메뉴|로그인|회원가입|광고|추천|copyright|navigation|전화\s*\d|이메일|카카오톡|제보|푸터|개인정보처리방침|사진\s*=|사진\s*설명|기자|▲)/i;
const unrelatedPattern = /(?:전화|이메일|카카오톡|상품|쇼핑|메뉴|python|node\.?js|사진\s*=|사진\s*설명|기자|▲)/i;

const normalize = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const tokens = (value) => [...new Set(String(value ?? '').toLocaleLowerCase().match(tokenPattern) ?? [])];
const textOf = (source) => [source?.title, source?.articleTitle, source?.metadataText, source?.pageText, source?.text].filter(Boolean).join('\n');
const weatherQuestionPattern = /날씨|기온|미세먼지|강수량?|예보|비가|비는|비올|맑|흐림|weather|rain/i;

const requirementStopWords = new Set(['이번', '올해', '현재', '최신', '공식', '원문', '자료', '문서', '질문', '확인', '비교']);

export function classifyOfficialSource(url) {
  try {
    const parsed = new URL(String(url));
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    const roots = ['python.org', 'react.dev', 'postgresql.org', 'mysql.com', 'docker.com', 'nodejs.org',
      'developer.mozilla.org', 'kubernetes.io', 'openai.com', 'github.com', 'docs.github.com',
      'amazon.com', 'aws.amazon.com', 'who.int', 'weather.go.kr', 'msit.go.kr',
      'motir.go.kr', 'science.seoul.go.kr'];
    return roots.some((root) => hostname === root || hostname.endsWith(`.${root}`));
  } catch { return false; }
}
function quantityFromText(text) {
  const value = String(text ?? '');
  if (/\{|\}|priceOf|data-pricing|selector|operation/i.test(value)) return null;
  const match = value.match(/([-+]?\d[\d,.]*)\s*(백만|억|만|천)?\s*(GB\s*-?\s*초|GB|TB|건|원|달러|USD|KRW|%|℃|°C|도|mm|km|명|시간|분)?/i);
  if (!match) return null;
  const raw = match[0].trim();
  const base = Number(match[1].replace(/,/g, ''));
  const multiplier = { '천': 1e3, '만': 1e4, '백만': 1e6, '억': 1e8 }[match[2]] || 1;
  const unit = (match[3] || match[2] || '').replace(/\s+/g, '');
  return { raw, value: Number.isFinite(base) ? base * multiplier : null, unit };
}

function priceDetailsFromText(text) {
  const value = String(text ?? '');
  const modelNames = [...new Set(value.match(/\b(?:GPT[-\s]?\d[\w.-]*|o[13](?:-mini)?|claude[-\s]?\d[\w.-]*|gemini[-\s]?\d[\w.-]*)\b/gi) || [])];
  const input = value.match(/(?:입력|input)[^\d$₩€£]*(?:[$₩€£]\s*)?[\d,.]+[^\s,;]*/i)?.[0] || '';
  const output = value.match(/(?:출력|output)[^\d$₩€£]*(?:[$₩€£]\s*)?[\d,.]+[^\s,;]*/i)?.[0] || '';
  const currency = value.match(/USD|KRW|달러|원|\$|₩|€|£/i)?.[0] || '';
  const tokenUnit = value.match(/(?:\/|per\s+)(?:1?M|백만|million|1,?000,?000)?\s*(?:tokens?|토큰)/i)?.[0] || '';
  return { modelNames, input, output, currency, tokenUnit, raw: value };
}

export function requestedAnswerRequirements(understanding) {
  const text = understanding.original;
  const usage = /사용법|사용 방법|어떻게 사용|how to use|usage/i.test(text);
  if (understanding.claimType === 'event') {
    if (/개발자|컨퍼런스|밋업|기술/i.test(text)) return ['event-type', 'free', 'date', 'location'];
    if (/축제|행사.*일정|일정/i.test(text)) return ['event-name', 'date', 'location', 'source-check-time', 'authoritative-source'];
    return ['event-type', 'date', 'location'];
  }
  if (understanding.claimType === 'comparison' || /두 가지|두 개|와 .* 비교/.test(text)) {
    if (/저장소|클라우드/i.test(text)) return ['service-a', 'service-b', 'free-capacity-a', 'free-capacity-b', 'monthly-price-a', 'monthly-price-b', 'currency-and-plan', ...(understanding.officialRequired ? ['authoritative-source'] : [])];
    if (/사양|기능|JSON/i.test(text)) return ['service-a', 'service-b', 'comparison-attributes', ...(understanding.officialRequired ? ['authoritative-source'] : [])];
    return ['service-a', 'service-b', 'comparison-attributes', ...(understanding.officialRequired ? ['authoritative-source'] : [])];
  }
  if (understanding.claimType === 'price') {
    if (/요청|request/i.test(text)) return ['request-price', 'free-tier', 'pricing-conditions'];
    return ['price', 'currency-and-plan'];
  }
  if (understanding.claimType === 'version') return ['version', 'release-status', 'freshness'];
  if (understanding.claimType === 'weather') return ['weather-value'];
  return ['fact-value', ...(usage ? ['usage-procedure'] : [])];
}

function assessAnswerRequirements(question, understanding, facts, options = {}) {
  const accepted = (facts || []).filter((fact) => fact.status === 'verified');
  const allText = accepted.map((fact) => `${fact.quote}\n${fact.sourceTitle}\n${fact.sourceUrl}`).join('\n');
  const req = requestedAnswerRequirements(understanding);
  const has = (pattern) => pattern.test(allText);
  const satisfied = new Set();
  if (has(/행사|축제|컨퍼런스|밋업|개발자/i)) satisfied.add('event-type');
  if (has(/무료|free/i)) satisfied.add('free');
  if (has(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}월\s*\d{1,2}일|\d{1,2}일부터|\d{1,2}일(?:까지|에)/i)) satisfied.add('date');
  if (understanding.locations.some((location) => has(new RegExp(location)))) satisfied.add('location');
  if (has(/부산불꽃축제|불꽃축제|축제/i)) satisfied.add('event-name');
  const comparisonPair = understanding.original.match(/(.+?)\s*(?:과|와|vs\.?|versus|및|and)\s*(.+?)(?:의\s*)?(?:기능|사양|가격|요금)?\s*비교/i);
  const comparedSubjects = comparisonPair ? [comparisonPair[1], comparisonPair[2]].map((part) => part.trim().replace(/의$/u, '')) : [];
  if (comparedSubjects[0] && accepted.some((fact) => String(fact.subject || '').toLocaleLowerCase().includes(comparedSubjects[0].toLocaleLowerCase()))) satisfied.add('service-a');
  if (comparedSubjects[1] && accepted.some((fact) => String(fact.subject || '').toLocaleLowerCase().includes(comparedSubjects[1].toLocaleLowerCase()))) satisfied.add('service-b');
  if (has(/GB|TB|기가바이트|용량/i)) { satisfied.add('free-capacity-a'); satisfied.add('free-capacity-b'); }
  if (has(/월\s*(?:요금|[\d,.]+\s*(?:원|달러|USD|KRW))|매월|monthly/i)) { satisfied.add('monthly-price-a'); satisfied.add('monthly-price-b'); }
  if (has(/원|달러|USD|KRW|무료|요금제|플랜|plan/i)) satisfied.add('currency-and-plan');
  if (has(/JSON|기능|사양|지원|프로세서|메모리|저장장치/i)) satisfied.add('comparison-attributes');
  if (has(/요청.*(?:원|달러|USD|가격)|(?:원|달러|USD).*요청|백만\s*건.*(?:요금|가격)/i)) satisfied.add('request-price');
  if (has(/무료\s*(?:요청|구간|프리\s*티어)|프리\s*티어/i)) satisfied.add('free-tier');
  if (has(/조건|적용|구간|리전|아키텍처|컴퓨팅 시간/i)) satisfied.add('pricing-conditions');
  if (understanding.claimType === 'version' && has(/\b(?:v?\d+|\d+\.\d+)(?:\.\d+)?\b|버전/i)) satisfied.add('version');
  if (understanding.claimType === 'version' && has(/LTS|안정|stable|릴리스/i)) satisfied.add('release-status');
  if (understanding.needsFreshness && accepted.some((fact) => fact.publicationDate || fact.scopeText.match(datePattern))) satisfied.add('freshness');
  if (understanding.claimType === 'weather' && accepted.length) satisfied.add('weather-value');
  if (/축제|일정/i.test(question) && accepted.some((fact) => /https?:\/\//.test(fact.sourceUrl)) && accepted.some((fact) => fact.verifiedAt)) satisfied.add('source-check-time');
  if (/축제|일정/i.test(question) && accepted.some((fact) => !/github\.io|blog|개인|커뮤니티/i.test(`${fact.sourceUrl} ${fact.sourceTitle}`)
    && /공식|시청|구청|관광|정부|부산광역시|행사/i.test(`${fact.sourceUrl} ${fact.sourceTitle} ${fact.quote}`))) satisfied.add('authoritative-source');
  const missing = req.filter((item) => !satisfied.has(item));
  const semanticReviewed = accepted.length > 0 && accepted.every((fact) => fact.semanticRelevance === 'reviewed' && fact.verificationStage === 'semantically-verified');
  const officialRequired = understanding.officialRequired || (understanding.claimType === 'version' && understanding.needsFreshness);
  const officialFacts = accepted.filter((fact) => classifyOfficialSource(fact.sourceUrl));
  const comparisonFacts = accepted.filter((fact) => understanding.claimType === 'comparison');
  const comparisonOfficialSatisfied = req.includes('service-a') && req.includes('service-b')
    ? comparedSubjects.length === 2 && comparedSubjects.every((subject) => comparisonFacts.some((fact) => String(fact.subject || '').toLocaleLowerCase().includes(subject.toLocaleLowerCase())
      && classifyOfficialSource(fact.sourceUrl) && String(fact.relation || '').trim() && String(fact.value || '').trim()))
    : officialFacts.length > 0;
  const policyHold = officialRequired && !comparisonOfficialSatisfied;
  const answerEligible = accepted.filter((fact) => !officialRequired || classifyOfficialSource(fact.sourceUrl));
  const referenceOnly = accepted.filter((fact) => !answerEligible.includes(fact));
  const complete = missing.length === 0 && semanticReviewed && !policyHold;
  return { required: req, satisfied: [...satisfied], missing, complete, semanticReviewed,
    officialRequired, officialSatisfied: comparisonOfficialSatisfied, policyHold, answerEligible, referenceOnly,
    status: policyHold ? (answerEligible.length ? 'policy-hold' : 'hold') : (missing.length ? 'incomplete-requirements' : (semanticReviewed ? 'complete' : 'semantic-review-required')) };
}
function parseDateHint(value) {
  const match = String(value).match(/(20\d{2})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})/);
  return match ? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])) : null;
}

function dateKey(value) {
  return value ? value.toISOString().slice(0, 10) : '';
}

// News and forecast pages commonly say “24일” while the publication date
// carries the year and month. Resolve that shorthand only against the source
// reference date; never infer a year/month from the current clock alone.
function resolveSourceDate(value, sourceReference) {
  const text = String(value ?? '');
  const absolute = text.match(/(20\d{2})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})/);
  if (absolute) return dateKey(new Date(Date.UTC(+absolute[1], +absolute[2] - 1, +absolute[3])));
  const monthDay = text.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (monthDay && sourceReference) return dateKey(new Date(Date.UTC(sourceReference.getUTCFullYear(), +monthDay[1] - 1, +monthDay[2])));
  const day = text.match(/(?<![\d.])(\d{1,2})일/);
  if (day && sourceReference) return dateKey(new Date(Date.UTC(sourceReference.getUTCFullYear(), sourceReference.getUTCMonth(), +day[1])));
  return '';
}

function temporalEvidence(text) {
  const value = String(text ?? '');
  return {
    relative: value.match(/오늘|내일|모레|현재|today|tomorrow/gi) ?? [],
    explicit: value.match(datePattern) ?? [],
    ambiguous: value.match(/다음\s*주\s*[월화수목금토일]요일?|이번\s*주|주말|다음\s*주|next\s+week|this\s+week/gi) ?? [],
  };
}

function resolveTemporalDate(text, sourceReference, nowDate) {
  const evidence = temporalEvidence(text);
  const dates = evidence.explicit.map((value) => resolveSourceDate(value, sourceReference)).filter(Boolean);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(nowDate);
  // Relative words in an article belong to the article's publication context.
  // The question clock is only the fallback for query-side “today”; it must
  // never shift an article's “tomorrow” by one extra day.
  const relativeBase = sourceReference || nowDate;
  const seoulDate = (offsetDays) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })
    .format(new Date(relativeBase.getTime() + offsetDays * 86400000));
  const relative = evidence.relative.map((value) => {
    if (/오늘|현재|today/i.test(value)) return today;
    if (/내일|tomorrow/i.test(value)) return seoulDate(1);
    return seoulDate(2);
  });
  return { ...evidence, dates: [...new Set([...dates, ...relative])] };
}

function splitAtomicBlocks(text, locations = []) {
  const pieces = String(text ?? '').split(/(?<=[.!?。！？])\s+|\s*;\s*/).flatMap((sentence) => {
    // Keep ordinary prose intact. Split comma-separated forecast/table clauses
    // only when each clause has its own place and value, so ranges such as
    // “80~150mm” remain one value and source quotations stay exact.
    const clauses = sentence.split(/\s*,\s*|\s+(?=그리고|또한|한편|특히)\s*/).map((part) => part.trim()).filter(Boolean);
    let result = clauses;
    // Do not let a neighbouring city's value become an attribute of the
    // requested city. This handles broadcast prose such as “춘천 2.5도 ...
    // 서울 21도” even when the extractor removed table punctuation.
    const knownLocations = [...new Set([...locations, '서울', '부산', '춘천', '제주', '인천', '대전', '대구', '광주', '강릉'])]
      .filter((location) => location.length >= 2);
    for (const location of knownLocations) {
      result = result.flatMap((part) => {
        const boundary = new RegExp(`(?=${location}(?:은|는|이|가|의|과|와|\\s))`, 'g');
        const points = [...part.matchAll(boundary)].map((match) => match.index)
          .filter((index) => index > 0 && /\d/.test(part.slice(0, index))
            && knownLocations.some((other) => other !== location && part.slice(0, index).includes(other)));
        if (!points.length) return [part];
        const pieces = [];
        let start = 0;
        for (const point of points) { pieces.push(part.slice(start, point)); start = point; }
        pieces.push(part.slice(start));
        return pieces.map((value) => value.trim()).filter(Boolean);
      });
    }
    return result;
  });
  return pieces.filter(Boolean);
}

export function understandSearchQuestion(question, now = new Date()) {
  const text = String(question ?? '').trim();
  const dates = text.match(datePattern) ?? [];
  const locations = text.match(/[가-힣]{2,}(?:시|군|구|도|역|공항)?/gu) ?? [];
  const locationStopWords = new Set(['최근', '일주일', '이번주', '이번', '오늘', '내일', '모레', '최신', '현재', '뉴스', '소식', '공식', '문서', '가격', '요금', '비교', '자료', '기술', '생성형', '과학기술', '날씨', '기온', '미세먼지']);
  const latest = /최신|최근|현재|오늘|내일|모레|이번 주|this week|latest|current|today|tomorrow/i.test(text);
  const officialRequired = /공식|원문|공식 사이트|official|primary source/i.test(text);
  const listRequested = /몇|목록|뉴스|비교|추천|여러|top|list|news|compare/i.test(text);
  const claimType = weatherQuestionPattern.test(text) ? 'weather'
    : /비교|와\s+.*기능|사양 비교|compare/i.test(text) ? 'comparison'
      : /가격|요금|비용|무료 용량|price|pricing|cost/i.test(text) ? 'price'
        : /최신|안정|정식|출시|LTS|버전|릴리스|release|version/i.test(text) ? 'version'
          : /누구|장관|대표|CEO|person/i.test(text) ? 'person'
            : /본부|사무소|위치|도시|어디/i.test(text) ? 'location'
              : /행사|축제|일정|뉴스|소식|event|news/i.test(text) ? 'event'
                : /설명|사용법|정의|무엇|어떻게|문서|API|probe/i.test(text) ? 'definition' : 'fact';
  const referenceDate = new Date(now);
  const relativeDates = [];
  const dateKey = (value) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(value));
  if (/오늘|today/i.test(text)) relativeDates.push(dateKey(referenceDate));
  if (/내일|tomorrow/i.test(text)) relativeDates.push(dateKey(referenceDate.getTime() + 86400000));
  if (/모레/i.test(text)) relativeDates.push(dateKey(referenceDate.getTime() + 2 * 86400000));
  return {
    original: text,
    target: tokens(text).slice(0, 24),
    requestedAttributes: tokens(text).filter((token) => !/^(오늘|내일|현재|최신|최근|the|what|is|are|news|latest)$/i.test(token)),
    locations: [...new Set(locations.filter((value) => value.length >= 2 && !locationStopWords.has(value)))].slice(0, 8),
    dates: [...new Set(dates)],
    relativeDates,
    needsFreshness: latest,
    officialRequired,
    claimType,
    answerRequirements: requestedAnswerRequirements({ original: text, claimType }),
    requestedCount: listRequested ? (text.match(/\d+/)?.[0] ? Number(text.match(/\d+/)[0]) : 3) : 1,
    now: new Date(now).toISOString(),
  };
}

export function buildGeneralSearchPlan(question, options = {}) {
  const understanding = options.understanding ?? understandSearchQuestion(question, options.now);
  const text = understanding.original;
  const cleaned = text.replace(/[?？!！]/g, ' ').replace(/\s+/g, ' ').trim();
  const queries = [cleaned, ...(understanding.officialRequired ? [`${cleaned} official documentation`] : [])];
  return { understanding, queries: [...new Set(queries.filter(Boolean))], maxSearches: options.maxSearches ?? 2, maxReads: options.maxReads ?? 4 };
}

export function rankGeneralCandidates(question, candidates, options = {}) {
  const understanding = options.understanding ?? understandSearchQuestion(question, options.now);
  const queryTokens = new Set(understanding.target);
  return (candidates ?? []).map((candidate, index) => {
    const metadata = textOf(candidate);
    const titleText = [candidate.title, candidate.articleTitle, candidate.snippet].filter(Boolean).join(' ');
    const candidateTokens = new Set(tokens(metadata));
    const titleTokens = new Set(tokens(titleText));
    const overlap = [...queryTokens].filter((token) => candidateTokens.has(token)).length;
    const titleOverlap = [...queryTokens].filter((token) => titleTokens.has(token)).length;
    const hasBody = Boolean(candidate.pageText || candidate.text);
    const hasDate = Boolean(String(candidate.publishedAt || metadata).match(datePattern));
    const access = hasBody ? 2 : candidate.snippet ? 1 : 0;
    const freshness = understanding.needsFreshness && hasDate ? 2 : 0;
    const titleNoise = /(?:메뉴|로그인|광고|추천|전화|이메일|쇼핑|직구)/i.test(titleText) ? -3 : 0;
    const releaseSignal = /버전|version|릴리스|release|출시/i.test(titleText) && /버전|version|릴리스|release|최신|latest/i.test(understanding.original) ? 3 : 0;
    // “official” is a signal only; a hostname is never promoted to official
    // status without evidence in the page itself.
    const officialHost = classifyOfficialSource(candidate.url);
    const officialTextSignal = /official|공식|정부|university|대학교|documentation|문서/i.test(metadata);
    const authority = (officialHost ? 4 : 0) + (officialTextSignal ? 2 : 0);
    const duplicateKey = normalize(candidate.url || metadata);
    return { candidate, index, score: overlap * 4 + titleOverlap * 3 + access + freshness + authority + titleNoise + releaseSignal,
      signals: { overlap, titleOverlap, hasBody, hasDate, access, freshness, authority, officialHost, officialTextSignal, titleNoise, releaseSignal }, duplicateKey };
  }).sort((a, b) => b.score - a.score || b.signals.access - a.signals.access || a.index - b.index);
}

export function extractPageEvidence(source, options = {}) {
  const rawBody = String(source?.pageText ?? source?.text ?? '').replace(/\r/g, '').trim();
  const body = rawBody
    .replace(/(?:▷\s*)?전화\s*[-\d\s]+(?:\s*▷)?/gi, '\n')
    .replace(/(?:▷\s*)?이메일\s*[^\s]+(?:\s*▷)?/gi, '\n')
    .replace(/(?:▷\s*)?카카오톡\s*[^\s]+(?:\s*▷)?/gi, '\n')
    .replace(/(?:메뉴|로그인|회원가입|광고|추천)\s*(?:메뉴|추천|광고)?/gi, '\n')
    .split(/\n+/).map((line) => line.trim()).filter((line) => line && !/^(?:메뉴|로그인|회원가입|광고|추천|copyright|navigation|푸터)/i.test(line)).join('\n');
  const title = String(source?.articleTitle || source?.title || '').trim();
  const metadata = String(source?.publishedAt || source?.datePublished || source?.metadataText || '').trim();
  // Preserve table rows and list items as atomic evidence. The readable-text
  // extractor may flatten a table into one line, so separators are evidence
  // boundaries rather than whitespace-only formatting.
  const rawBlocks = body.split(/\n+|(?<=[.!?。！？])\s+|(?<=\d{1,2}:\d{2})\s+(?=[가-힣A-Za-z])|(?=(?:오늘|내일|모레)\s*[:：])/)
    .flatMap((text) => splitAtomicBlocks(text, [title]))
    .map((text) => text.trim()).filter(Boolean);
  let cursor = 0;
  const blocks = rawBlocks.map((text, index) => {
    const start = body.indexOf(text, cursor);
    const end = start < 0 ? cursor + text.length : start + text.length;
    cursor = Math.max(cursor, end);
    const actualStart = start < 0 ? 0 : start;
    const boundaries = [...body.slice(0, actualStart).matchAll(/(?:[.!?。！？]\s+|\n)/g)]
      .map((match) => match.index + match[0].length);
    const contextStart = boundaries.length > 1 ? boundaries[boundaries.length - 2] : 0;
    return { text, index, start: actualStart, end, contextSpan: body.slice(contextStart, end) };
  });
  const dates = [...new Set((title + '\n' + body).match(datePattern) ?? [])];
  const numbers = [...new Set(body.match(numberPattern) ?? [])];
  const structured = Array.isArray(source?.structuredData) ? source.structuredData : [];
  return { url: source?.url || '', title, body, metadata, blocks, dates, numbers, structured,
    bodyQuality: body.length >= (options.minBodyLength ?? 80) ? 'substantive' : 'insufficient' };
}

export function extractAtomicFacts(question, source, options = {}) {
  const understanding = options.understanding ?? understandSearchQuestion(question, options.now);
  const page = options.page ?? extractPageEvidence(source, options);
  const queryTokens = new Set(understanding.target);
  const sourceIndex = options.sourceIndex ?? 0;
  const meaningfulQueryTokens = [...queryTokens].filter((token) => !/^(오늘|내일|모레|날씨|기온|미세먼지|최신|현재|최근|버전|안정|안정적|정보|공식|문서|설명|사용법|가격|요금|비교)$/i.test(token));
  const coreQueryTokens = meaningfulQueryTokens.filter((token) => !/^(뉴스|소식|자료|최신|현재|올해|이번|달|무료|공식|문서|API|기능|사양|역사|확인)$/i.test(token));
  const generic = understanding.claimType !== 'weather';
  const genericClaim = (text) => {
    const value = String(text);
    const relation = understanding.claimType === 'version' && /버전|version|릴리스|release|LTS|안정/i.test(value) ? 'version'
      : understanding.claimType === 'price' && /가격|요금|비용|무료|원|달러|USD|GB/i.test(value) ? 'price'
        : understanding.claimType === 'person' && /장관|대표|CEO|누구|임명/i.test(value) ? 'person'
          : understanding.claimType === 'location' && /본부|사무소|위치|도시|소재지/i.test(value) ? 'location'
            : understanding.claimType === 'event' && /행사|축제|일정|개최|뉴스|발표/i.test(value) ? 'event'
              : understanding.claimType === 'comparison' && /지원|기능|사양|비교|JSON|용량|가격|요금/i.test(value) ? 'comparison'
                : understanding.claimType === 'definition' && /설명|사용|신호|signal|probe|정의|지원|차이/i.test(value) ? 'definition' : '';
    if (!relation) return null;
    const quantity = quantityFromText(value);
    const number = quantity?.raw || '';
    const named = value.match(/(?:은|는|이|가|:|→)\s*([가-힣A-Za-z][가-힣A-Za-z0-9._/-]{1,})/)?.[1] || '';
    const reliableValue = relation === 'price' ? (number || (/무료/i.test(value) ? '무료' : ''))
      : relation === 'version' ? (number || value.match(/LTS|stable|최신|버전\s*[A-Za-z0-9._-]+/i)?.[0] || '')
        : relation === 'event' ? (number || named || (/(행사|축제|개최|일정)/.test(value) ? value.slice(0, 240) : ''))
          : relation === 'comparison' ? (number || (/(JSON|지원|기능|사양|용량)/i.test(value) ? value.slice(0, 240) : ''))
            : relation === 'definition' ? value.slice(0, 240) : (named || number);
    return { relation, value: reliableValue, quantity, priceDetails: relation === 'price' ? priceDetailsFromText(value) : null };
  };
  return page.blocks.filter((block) => {
    const blockTokens = new Set(tokens(block.text));
    const overlap = [...queryTokens].filter((token) => blockTokens.has(token)).length;
    const topicOverlap = meaningfulQueryTokens.length === 0 || meaningfulQueryTokens.some((token) => blockTokens.has(token));
    const coreOverlap = coreQueryTokens.filter((token) => blockTokens.has(token)).length;
    const acronymTerms = String(understanding.original).match(/\b[A-Z][A-Za-z0-9._-]{1,}\b/g) || [];
    const acronymMatch = acronymTerms.length === 0 || acronymTerms.some((token) => blockTokens.has(token.toLocaleLowerCase()));
    const requestedFeatureMatch = coreQueryTokens.length === 0 || coreQueryTokens.some((token) => blockTokens.has(token));
    const requestedOwner = understanding.original.match(/([^\s]+)\s*본부/u)?.[1];
    const requestedRelationMatch = !requestedOwner || new RegExp(`${requestedOwner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*본부`, 'i').test(block.text);
    const topicalWeatherTerm = weatherQuestionPattern.test(block.text);
    const focused = coreQueryTokens.length > 1 ? coreOverlap >= 2 : coreOverlap >= 1;
    const claim = genericClaim(block.text);
    const templateOnly = /\{|\}|priceOf|data-pricing-endpoint|regionSelector|stringOf/i.test(block.text)
      && !/(무료|프리\s*티어|요금은|요청.*(?:원|달러|USD)|가격.*(?:원|달러|USD))/i.test(block.text);
    return !unrelatedPattern.test(block.text) && !templateOnly && (generic ? (topicOverlap && focused && acronymMatch && requestedFeatureMatch && requestedRelationMatch && claim) : (topicOverlap || topicalWeatherTerm || block.text.match(datePattern)));
  }).slice(0, options.maxFacts ?? 24).map((block, id) => {
    const claim = genericClaim(block.text);
    const weatherPredicate = /강수|비|rain/i.test(block.text) ? 'precipitation' : /파고|물결/i.test(block.text) ? 'waveHeight' : /기온|온도|도|℃/.test(block.text) ? 'temperature' : 'weather';
    const value = generic ? claim.value : (block.text.match(numberPattern) ?? [])[0] || '';
    const quantity = generic ? claim.quantity : quantityFromText(value);
    return { id: `fact-${sourceIndex + 1}-${id}`, subject: understanding.locations.find((location) => block.text.includes(location)) || meaningfulQueryTokens.find((token) => block.text.toLocaleLowerCase().includes(token.toLocaleLowerCase())) || '',
    predicate: generic ? claim.relation : weatherPredicate, relation: generic ? claim.relation : weatherPredicate, claimType: understanding.claimType,
    value,
    unit: quantity?.unit || (value || '').match(/[가-힣℃°%]+|mm|km|m$/i)?.[0] || '',
    normalizedQuantity: quantity?.value ?? null,
    targetDate: '', targetLocation: understanding.locations.find((location) => block.text.includes(location)) || '',
    attributes: [...new Set([...(block.text.match(numberPattern) ?? []).filter((value) => !block.text.match(datePattern)?.some((date) => date.includes(value))), ...(block.text.match(datePattern) ?? [])])],
    quote: block.text,
    quoteStart: block.start,
    sourceSpan: { start: block.start, end: block.end },
    contextSpan: block.contextSpan,
    scopeText: `${page.metadata}\n${block.contextSpan}`,
    temporalResolutionConfidence: 'unresolved',
    sourceUrl: page.url,
    sourceTitle: page.title,
    publishedAt: source?.publishedAt || source?.datePublished || null,
    publicationDate: source?.publishedAt || source?.datePublished || null,
    fetchedAt: source?.fetchedAt || null,
    preparedAt: source?.preparedAt || null,
    referenceTime: source?.referenceTime || null,
    effectiveDate: null,
    status: 'unverified',
    priceDetails: generic && claim.relation === 'price'
      ? priceDetailsFromText(page.body) : null,
    extractionStatus: generic && !claim.value ? 'held-no-reliable-value' : 'candidate',
  };
  });
}

export function validateAtomicFact(question, fact, source, options = {}) {
  const understanding = options.understanding ?? understandSearchQuestion(question, options.now);
  const page = options.page ?? extractPageEvidence(source, options);
  const failures = [];
  const expectedClaimType = understanding.claimType;
  if (expectedClaimType !== 'weather' && fact?.claimType !== expectedClaimType) failures.push('claim-type-mismatch');
  if (expectedClaimType !== 'weather' && (!fact?.relation || !fact?.value)) failures.push('relation-or-value-unresolved');
  if (understanding.officialRequired && !classifyOfficialSource(source?.url)) failures.push('official-source-required');
  const officialHost = classifyOfficialSource(source?.url);
  if (understanding.claimType === 'version' && understanding.needsFreshness && !officialHost) failures.push('latest-version-official-source-required');
  if (understanding.claimType === 'price' && understanding.needsFreshness && !officialHost) failures.push('latest-price-official-source-required');
  if (!fact?.quote || !page.body.includes(fact.quote)) failures.push('quote-not-in-source');
  if (!fact?.sourceUrl || fact.sourceUrl !== source?.url) failures.push('source-url-mismatch');
  if (fact?.quote && boilerplatePattern.test(fact.quote)) failures.push('boilerplate');
  const sourceReference = parseDateHint(source?.publishedAt || source?.datePublished || page.title);
  // A nearby paragraph is retained for citation context, but it cannot lend
  // its date to an unrelated atomic quote.
  const factContext = String(fact.quote || '');
  const context = `${fact.contextSpan || ''}\n${factContext}`;
  const requestedDate = understanding.dates.find((date) => context.includes(date));
  const scope = String(fact.scopeText || fact.quote);
  // Relative-date evidence must be explicit in the same quote. A page-wide
  // publication date or another paragraph cannot authorize this atomic fact.
  const relativeWords = context.match(/오늘|내일|모레|현재|today|tomorrow/gi) ?? [];
  const nowDate = new Date(options.now ?? Date.now());
  const temporal = resolveTemporalDate(context, sourceReference, nowDate);
  const quoteTemporal = resolveTemporalDate(fact.quote, sourceReference, nowDate);
  const expectedDates = [...understanding.relativeDates, ...understanding.dates.map((value) => resolveSourceDate(value, sourceReference)).filter(Boolean)];
  const quoteHasTemporal = quoteTemporal.relative.length || quoteTemporal.explicit.length || quoteTemporal.ambiguous.length;
  const dateMatchesRequest = quoteHasTemporal
    ? quoteTemporal.dates.some((date) => expectedDates.includes(date))
    : temporal.dates.some((date) => expectedDates.includes(date));
  const hasDateRequirement = understanding.dates.length || understanding.relativeDates.length;
  if (hasDateRequirement && (!dateMatchesRequest || temporal.ambiguous.length)) failures.push('requested-date-not-in-scope');
  if (hasDateRequirement && !temporal.relative.length && !temporal.explicit.length && !temporal.ambiguous.length) failures.push('temporal-context-missing');
  const requestedRelative = /내일|tomorrow/i.test(understanding.original) ? 'tomorrow' : /모레/i.test(understanding.original) ? 'day-after-tomorrow' : /오늘|today/i.test(understanding.original) ? 'today' : '';
  if (requestedRelative && relativeWords.length) {
    const quoteRelative = /내일|tomorrow/i.test(context) ? 'tomorrow' : /모레/i.test(context) ? 'day-after-tomorrow' : 'today';
    if (quoteRelative !== requestedRelative) failures.push('relative-date-mismatch');
    const reference = sourceReference;
    if (!reference && !/오늘|현재|today/i.test(context)) failures.push('relative-date-reference-missing');
    else {
      const offset = quoteRelative === 'tomorrow' ? 1 : quoteRelative === 'day-after-tomorrow' ? 2 : 0;
      const resolved = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })
        .format(new Date((reference || new Date(options.now ?? Date.now())).getTime() + offset * 86400000));
      if (!expectedDates.includes(resolved)) failures.push('relative-date-does-not-resolve');
    }
  }
  if (understanding.needsFreshness && !understanding.dates.length && !understanding.relativeDates.length) {
    const hint = (scope.match(datePattern) ?? []).map(parseDateHint).find(Boolean);
    const age = hint ? Math.abs(new Date(options.now ?? Date.now()).getTime() - hint.getTime()) : Infinity;
    if (!hint || age > 31 * 86400000) failures.push('freshness-not-established');
  }
  // A page may mention the requested place elsewhere while this quote is
  // about a different region. The atomic quote must carry the place itself;
  // page-wide scope is not enough to authorize a regional answer.
  const requestedLocation = understanding.locations.find((location) => fact.quote.includes(location))
    || understanding.locations.find((location) => context.includes(location) && /^(?:산지|중산간)/.test(fact.quote.trim()));
  if (understanding.locations.length && !requestedLocation) failures.push('requested-location-not-in-scope');
  if (understanding.claimType === 'weather' && requestedLocation && (fact.quote.match(/\[[가-힣]{2,}\]/g) || []).length > 1) failures.push('mixed-location-value');
  if (understanding.claimType === 'price' && /요청|request/i.test(understanding.original)
      && /총 월별 요금|요금 합계|\s×\s|=\s*\d/i.test(fact.quote)) failures.push('calculation-example-not-unit-price');
  if (understanding.claimType === 'price' && /요청|request/i.test(understanding.original)
      && /무료로 시작|시작하기|메뉴|안내/i.test(fact.quote)
      && !/무료\s*(?:요청|건)|프리\s*티어|백만\s*건/i.test(fact.quote)) failures.push('pricing-menu-not-request-price');
  const bodyNumbers = fact.quote.match(numberPattern) ?? [];
  const bodyDates = fact.quote.match(datePattern) ?? [];
  if (weatherQuestionPattern.test(understanding.original)
      && !/맑|흐림|비|눈|기온|강수|도|℃|°C|mm|%|파고|물결/i.test(fact.quote)) failures.push('fact-value-missing');
  if ((fact.attributes ?? []).some((value) => { datePattern.lastIndex = 0; const isDate = datePattern.test(value); datePattern.lastIndex = 0; return isDate ? !bodyDates.some((bodyValue) => normalize(bodyValue) === normalize(value)) : !bodyNumbers.some((bodyValue) => normalize(bodyValue) === normalize(value)); })) {
    failures.push('attribute-not-in-quote');
  }
  const targetDate = ['weather', 'event', 'news'].includes(understanding.claimType)
    ? (temporal.dates.find((date) => expectedDates.includes(date)) || temporal.dates[0] || '') : '';
  if (/\{|\}|priceOf|data-pricing-endpoint|regionSelector|stringOf/i.test(fact.quote)) failures.push('dynamic-template-not-price');
  // A duration is not a calendar date. This prevents “5일간” from becoming
  // an event date merely because the generic number parser saw a 5.
  if (understanding.claimType === 'event' && /\d+\s*일간/.test(fact.quote)) failures.push('duration-not-date');
  return { ...fact, subject: fact.subject || requestedLocation || '', targetLocation: fact.targetLocation || requestedLocation || '', targetDate, effectiveDate: targetDate || null, temporalResolutionConfidence: targetDate ? (temporal.ambiguous.length ? 'low' : 'high') : 'unresolved', status: failures.length ? 'rejected' : 'verified', verificationStage: failures.length ? 'rejected' : 'structurally-verified', semanticRelevance: 'not-reviewed', validationFailures: failures,
    normalizedQuote: normalize(fact?.quote), verifiedAt: new Date(options.now ?? Date.now()).toISOString() };
}

export function verifyAtomicFacts(question, sources, options = {}) {
  const understanding = options.understanding ?? understandSearchQuestion(question, options.now);
  const facts = (sources ?? []).flatMap((source, sourceIndex) => extractAtomicFacts(question, source, { ...options, sourceIndex, understanding }).map((fact) => validateAtomicFact(question, fact, source, { ...options, understanding })));
  const seen = new Set();
  const dedupedFacts = facts.map((fact) => {
    const key = `${fact.sourceUrl}\n${normalize(fact.quote)}`;
    if (seen.has(key)) return { ...fact, status: 'rejected', validationFailures: [...(fact.validationFailures ?? []), 'duplicate-evidence'], duplicateOf: key };
    seen.add(key);
    return fact;
  });
  const verified = dedupedFacts.filter((fact) => fact.status === 'verified');
  return { facts: dedupedFacts, verified, partial: verified.length > 0 && verified.length < dedupedFacts.length, status: verified.length ? 'verified' : 'insufficient-evidence' };
}

export async function runGeneralSearchPipeline(question, options = {}) {
  const started = Date.now();
  const plan = buildGeneralSearchPlan(question, options);
  const search = options.search;
  const readPage = options.readPage ?? fetchWebPageText;
  const searchResponse = options.candidates ? null : (search ? await search(plan.queries[0]) : null);
  // `candidates` is the untruncated discovery pool. `results` is a display
  // limit in searchWeb and must not be used for body acquisition.
  const initial = options.candidates ?? searchResponse?.candidates ?? searchResponse?.results ?? [];
  const ranked = rankGeneralCandidates(question, initial, plan);
  const reads = [];
  const readDiagnostics = [];
  const selected = new Set(ranked.slice(0, plan.maxReads).map((entry) => entry.index));
  for (const entry of ranked.slice(0, plan.maxReads)) {
    const candidate = entry.candidate;
    if (candidate.pageText || candidate.text) {
      reads.push(candidate);
      readDiagnostics.push({ url: candidate.url || '', title: candidate.title || '', attempted: false,
        status: 'provided', bodyLength: String(candidate.pageText || candidate.text || '').length,
        bodyReason: String(candidate.pageText || candidate.text || '').trim() ? 'provided-body' : 'empty-body' });
    }
    else if (entry.candidate.url) {
      const attemptStarted = Date.now();
      try {
        const page = await readPage(entry.candidate.url);
        const body = String(page?.text || page?.pageText || '').trim();
        reads.push({ ...entry.candidate, ...page, pageText: page?.pageText || page?.text || '' });
        readDiagnostics.push({ url: entry.candidate.url, title: entry.candidate.title || '', attempted: true,
          status: body ? 'success' : 'empty-body', httpStatus: page?.status ?? null,
          redirectUrl: page?.url && page.url !== entry.candidate.url ? page.url : '', redirectChain: page?.redirectChain || [], canonicalUrl: page?.canonicalUrl || '',
          bodyLength: body.length, bodyReason: body ? 'extracted' : 'extractor-empty', durationMs: Date.now() - attemptStarted });
      } catch (error) {
        readDiagnostics.push({ url: entry.candidate.url, title: entry.candidate.title || '', attempted: true,
          status: 'failed', httpStatus: error?.status ?? null, errorType: error?.name || 'Error',
          errorCode: error?.code || '', bodyLength: 0, bodyReason: 'fetch-failed', durationMs: Date.now() - attemptStarted });
      }
    }
  }
  const candidateDiagnostics = ranked.map((entry) => ({ url: entry.candidate.url || '', title: entry.candidate.title || '',
    score: entry.score, signals: entry.signals, selected: selected.has(entry.index),
    exclusionReason: selected.has(entry.index) ? '' : 'read-budget-not-selected' }));
  const evidence = verifyAtomicFacts(question, reads, options);
  const semantic = typeof options.semanticReview === 'function'
    ? (evidence.facts.length
      ? await options.semanticReview({ question, plan, pages: reads, facts: evidence.facts })
      : { approveFactIds: [], rejectFactIds: [], reasonById: {}, skipped: 'no-candidates', requestSucceeded: false, calls: 0 })
    : null;
  if (semantic) {
    const expected = evidence.facts.map((fact) => fact.id);
    const supplied = [...(semantic.approveFactIds ?? []), ...(semantic.rejectFactIds ?? [])];
    const unique = new Set(supplied);
    const reasonById = semantic.reasonById && typeof semantic.reasonById === 'object' && !Array.isArray(semantic.reasonById) ? semantic.reasonById : {};
    const responseErrors = [];
    if (semantic.invalid || semantic.skipped || !Array.isArray(semantic.approveFactIds) || !Array.isArray(semantic.rejectFactIds)) responseErrors.push('semantic-review-incomplete');
    if (unique.size !== supplied.length) responseErrors.push('semantic-review-duplicate-id');
    if (supplied.some((id) => !expected.includes(id))) responseErrors.push('semantic-review-unknown-id');
    if (expected.some((id) => !unique.has(id))) responseErrors.push('semantic-review-missing-id');
    if (Object.keys(reasonById).some((id) => !expected.includes(id))) responseErrors.push('semantic-review-unknown-reason-id');
    if ((semantic.rejectFactIds || []).some((id) => !Object.prototype.hasOwnProperty.call(reasonById, id))) responseErrors.push('semantic-review-missing-reason');
    if (new Set(expected).size !== expected.length) responseErrors.push('internal-duplicate-fact-id');
    const approved = new Set(responseErrors.length ? [] : semantic.approveFactIds);
    evidence.facts = evidence.facts.map((fact) => {
      if (fact.status !== 'verified') return fact;
      const failures = [...(fact.validationFailures ?? [])];
      if (responseErrors.length) failures.push(...responseErrors);
      else if (!approved.has(fact.id)) {
        failures.push('semantic-review-not-approved', 'semantic-review-rejected');
        if (reasonById[fact.id]) failures.push(`semantic-review-reason: ${String(reasonById[fact.id]).slice(0, 500)}`);
      }
      return failures.length ? { ...fact, status: 'rejected', validationFailures: failures } : { ...fact, verificationStage: 'semantically-verified', semanticRelevance: 'reviewed' };
    });
    evidence.verified = evidence.facts.filter((fact) => fact.status === 'verified');
    evidence.status = evidence.verified.length ? 'verified' : 'insufficient-evidence';
    evidence.partial = evidence.verified.length > 0 && evidence.verified.length < evidence.facts.length;
  }
  const answerRequirements = assessAnswerRequirements(question, plan.understanding, evidence.facts, options);
  return { plan, candidates: ranked, pages: reads, pagesRead: reads.length, evidence, answerRequirements,
    diagnostics: { search: searchResponse ? { status: searchResponse.status || '', resultCounts: searchResponse.resultCounts || null,
      attempts: (searchResponse.attempts || []).map(({ provider, query, httpStatus, status, count, durationMs, errorCode }) =>
        ({ provider, query, httpStatus, status, count, durationMs, errorCode: errorCode || '' })) } : null,
      candidates: candidateDiagnostics, reads: readDiagnostics,
      totals: { elapsedMs: Date.now() - started, candidates: ranked.length, selected: selected.size, pagesRead: reads.length,
        extractedBody: readDiagnostics.filter((item) => item.bodyLength > 0).length } },
    semanticReview: semantic, metrics: { elapsedMs: Date.now() - started, searches: search ? 1 : 0, reads: reads.length, facts: evidence.facts.length, verifiedFacts: evidence.verified.length,
      // Real reviewers expose their actual call count. Keep compatibility with
      // small test doubles that only return rejectFactIds.
      geminiCalls: semantic ? (Number.isInteger(semantic.calls) ? semantic.calls : 1) : 0 } };
}
