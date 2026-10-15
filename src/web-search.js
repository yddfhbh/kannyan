import { JSDOM } from 'jsdom';

const duckDuckGoHtmlOrigin = 'https://html.duckduckgo.com';
const duckDuckGoHtmlUrl = `${duckDuckGoHtmlOrigin}/html/`;
const naverSearchUrl = 'https://search.naver.com/search.naver';
const defaultSearchTimeoutMs = 20_000;
const defaultMaxResults = 12;
const defaultPreferredDomains = [];

const explicitSearchPattern = /(검색|search|검색해|찾아|찾아봐|찾아줘|lookup|look up)/i;
const explicitSearchIntentPattern = /(검색해봐|검색해 줘|검색해줘|찾아봐|찾아 봐|찾아줘|찾아 줘|최신 정보|최근 정보|최신 소식|최근 소식|실시간 정보|지금 정보)/i;
const strongTimeSensitivePattern = /(최신|실시간|업데이트|시세|주가|가격|기온|날씨|영업시간|운영시간|발표|출시|일정|결과|순위|뉴스)/i;
const relativeTimePattern = /(오늘|지금|현재|최근|이번 주|이번주|이번 달|이번달|어제|내일)/i;
const timelyTopicPattern = /(뉴스|기온|날씨|시세|주가|가격|일정|결과|순위|업데이트|발표|출시|영업시간|운영시간)/i;
const sourceRequestPattern = /(출처|링크|원문|참고자료|reference|references|source|sources|link|links|url)/i;
const factualQuestionPattern = /(누구|뭐야|무엇|어디|언제|몇|설명|정의|소개|정체|어떤|어떻게|알려줘|알려 줘|찾아줘|찾아 줘|검색해|search)/i;
const informationRequestPattern = /(알려\s*줘|설명해\s*줘|소개해\s*줘|정리해\s*줘|요약해\s*줘|가르쳐\s*줘|말해\s*줘|무슨\s*뜻|무엇을\s*의미)/i;
const questionEndingPattern = /(\?|까\??|가\??|야\??|요\??|냐\??|임\??|인가\??)$/i;
const factualTopicPattern = /(게임|인물|회사|브랜드|서비스|api|라이브러리|모델|용어|맵|위키|문서|규칙|설정|기능|스펙|버전|에러|오류|공식|링크|주소|프로젝트|단어|뉴스|날씨|가격|일정)/i;
const searchTailCleanupPattern = /\s*(검색해봐|검색해 줘|검색해줘|검색해서(?:알려줘|알려 줘)?|검색하여(?:알려줘|알려 줘)?|찾아봐|찾아 봐|찾아줘|찾아 줘|찾아서(?:알려줘|알려 줘)?|알려줘|알려 줘|정리해줘|정리해 줘)\s*$/i;
const currentTimeReferencePattern = /(최신|현재|지금|실시간|최근|today|current|latest|live|real[- ]?time)/i;
const explicitDatePattern = /(\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{4}년\s*\d{1,2}월(?:\s*\d{1,2}일)?|\d{1,2}월\s*\d{1,2}일|어제|그제|오늘|내일|모레|작년|재작년|올해|내년|지난달|저번달|이번달|다음달|지난주|저번주|이번주|다음주)/i;
const currencyUnitPattern = /(달러|usd|원화|한화|원|krw|엔화|엔|jpy|유로|eur|위안|cny|파운드|gbp|홍콩달러|hkd|대만달러|twd)/i;
const shortCurrencyAmountOnlyPattern = /^(?:약\s*)?(?:[$₩¥€£]\s*)?\d+(?:[.,]\d+)?\s*(달러|usd|원화|한화|원|krw|엔화|엔|jpy|유로|eur|위안|cny|파운드|gbp|홍콩달러|hkd|대만달러|twd)\s*$/i;
const currencyConversionIntentPattern = /(환율|환전|환산|변환|원화|한화|달러로|원으로|얼마|가치|계산|바꿔|바꾸면|convert|conversion|exchange rate)/i;
const marketAssetPattern = /(주가|주식|시세|코인|암호화폐|비트코인|이더리움|btc|eth|xrp|sol|doge|nasdaq|나스닥|kospi|코스피|kosdaq|코스닥|s&p|sp500|다우|gold|금값|은값|유가|원유)/i;
const marketPriceIntentPattern = /(가격|얼마|시세|주가|종가|시가|고가|저가|quote|price)/i;

const browserHeaders = {
  'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'user-agent': [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'AppleWebKit/537.36 (KHTML, like Gecko)',
    'Chrome/137.0.0.0 Safari/537.36',
  ].join(' '),
};

export async function searchWeb(query, options = {}) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return { query: '', results: [] };
  }

  const maxResults = clampInteger(options.maxResults, 1, 20, defaultMaxResults);
  const timeoutMs = clampInteger(options.timeoutMs, 1_000, 60_000, defaultSearchTimeoutMs);
  const preferredDomains = normalizePreferredDomains(options.preferredDomains);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const queryVariants = buildSearchQueryVariants(normalizedQuery, preferredDomains);
    const queryResults = [];
    const failures = [];
    let successfulRequests = 0;
    const collect = async (operation) => {
      try { const results = await operation(); successfulRequests += 1; return results; }
      catch (error) { failures.push(error); return []; }
    };

    for (const searchQuery of queryVariants) {
      let results = await collect(() => performDuckDuckGoHtmlSearch(searchQuery, {
        region: options.region,
        signal: controller.signal,
        fetchImpl: options.fetchImpl,
      }));

      if (results.length === 0) {
        results = await collect(() => performNaverSearch(searchQuery, {
          signal: controller.signal,
        fetchImpl: options.fetchImpl,
        }));
      }

      queryResults.push(results);
    }

    const mergedResults = mergeAndRankSearchResults(queryResults.flat(), normalizedQuery, preferredDomains)
      .slice(0, maxResults);

    return {
      query: normalizedQuery,
      results: mergedResults,
      status: mergedResults.length ? 'success' : successfulRequests ? 'empty' : controller.signal.aborted ? 'timeout' : failures.some((e) => [403, 429].includes(e.status)) ? 'blocked' : 'failed',
      failed: !mergedResults.length && successfulRequests === 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function parseDuckDuckGoHtmlResults(html) {
  const dom = new JSDOM(String(html ?? ''));
  const document = dom.window.document;
  const nodes = [...document.querySelectorAll('.result')];
  const results = [];

  for (const node of nodes) {
    const anchor = node.querySelector('.result__title a.result__a, a.result__a');
    const snippetNode = node.querySelector('.result__snippet');
    const title = normalizeSearchText(anchor?.textContent ?? '');
    const url = unwrapDuckDuckGoResultUrl(anchor?.href ?? '');
    const snippet = normalizeSearchText(snippetNode?.textContent ?? '');

    if (!title || !url) {
      continue;
    }

    if (results.some((entry) => entry.url === url)) {
      continue;
    }

    results.push({ title, url, snippet });
  }

  return results;
}

// Classify each task by its source of truth, rather than by question words alone.
const publicBotQuestion = /^(?:(?:너|넌|너는|네|니|당신|깐냥|깐냥이|이 봇|봇)(?:의|은|는)?\s*)?(?:뭐야|누구(?:야|세요|니|고)?|무엇(?:이야|인가요)?|이름(?:이|은)?\s*(?:뭐|무엇)|정체(?:가|는)?|자기소개|소개해|누가\s*(?:만들|제작)|제작자|만든\s*(?:사람|이)|(?:뭐|뭘|무엇을)\s*(?:할|하는)|무슨\s*기능|어떤\s*기능|할\s*수\s*있|기능(?:이|은)|말투|왜\s*냥|성격|캐릭터)/i;
const addressedBot = /^(?:너|넌|너는|네|니|당신|깐냥|깐냥이|이 봇|봇)(?:의|은|는)?\s*/;
const localTask = /(?:번역|translate|다듬어|교정|소설|이야기.*써|시.*써|계산해|내가\s*(?:준|말한|보낸|정한)|(?:아까|방금|이전|우리)\s*(?:대화|말|조건|이야기)|(?:제공한|첨부한|이|위|아래|사진\s*속|이미지\s*속)\s*(?:글|문장|자료|사진|이미지|내용|표).*?(?:설명|보여|읽|뭐|있|분석)|기억(?:해|나|하))/i;
const casualTask = /^(?:안녕|고마워|감사|잘자|잘 자|반가워|오늘.*피곤|심심해|슬퍼|기뻐|힘들어|외로워|위로해|놀아|그래|응|왜\s*그래)/;

export function classifyWebSearchIntent(prompt) {
  const text = normalizeSearchText(prompt);
  // Korean connected self-introductions need a boundary even without punctuation.
  const sourceBoundary = text.search(/[:："“「]/);
  const directive = sourceBoundary >= 0 ? text.slice(0, sourceBoundary) : text;
  const suppliedTransform = /번역|translate|요약|교정|다듬어/i.test(directive)
    && (sourceBoundary >= 0 || /번역|translate|교정|다듬어|(?:제공|첨부|보낸|이|그|위|아래|다음).*?(?:글|문장|내용|자료|원문)|^요약/i.test(directive))
    && !explicitSearchPattern.test(directive)
    && !/(?:그리고|하고|한 뒤|후에).*?(?:최신|날씨|주가|가격|조회)/.test(directive);
  const clauses = (suppliedTransform ? [text] : text.replace(/(요약|번역|설명)하고\s*/g, '$1해줘? ').replace(/(해|알려)주고\s*/g, '$1줘? ').replace(/(할\s*수)\s*있고\s*/g, '$1 있어? ').replace(/^(그럼|그래서)\s+/, '').replace(/^(안녕|고마워|심심해)\s+/, '$1? ').replace(/(누구|뭐)(?:이고|고)\s*/g, '$1야? ')
    .split(/[?？!;\n]+|,\s*|\s+(?:그리고|그런데|또한)\s+/))
    .map((s) => s.trim()).filter(Boolean);
  const local = [], external = [];
  for (const clause of clauses) {
    const explicit = !suppliedTransform && (explicitSearchPattern.test(clause) || /푝무위키|우리 위키|pyhok(?:\.com)?/i.test(clause));
    const transformation = /번역|translate|요약|교정|다듬어/i.test(clause);
    // A quoted passage mentioning prices/weather is still supplied material.
    const suppliedOnly = suppliedTransform || (transformation && !explicit && /(?:제공|첨부|이|그|위|아래|다음).*?(?:글|문장|내용|자료|원문)/.test(clause));
    const externalCue = strongTimeSensitivePattern.test(clause) || /나이|생년월일|국적|소속/.test(clause);
    const publicQuestion = publicBotQuestion.test(clause) || /^(?:제작자는|이름은|기능은)/.test(clause) || (addressedBot.test(clause) && /^(?:어떤\s*(?:봇|존재)|이름|정체|소개|제작|만들|말투|기능|성격|캐릭터)/.test(clause.replace(addressedBot, '')));
    const localQuestion = suppliedOnly || (!explicit && !externalCue && (publicQuestion || localTask.test(clause) || casualTask.test(clause)));
    if (localQuestion) local.push(clause);
    else if (explicit || shouldSearchExternalClause(clause)) external.push(clause);
    else local.push(clause);
  }
  return { requiresExternal: external.length > 0, hasLocalAnswer: local.length > 0,
    localPrompt: local.join(' / '), externalPrompt: external.join(' / '),
    reason: external.length ? (local.length ? 'mixed' : 'external-fact-or-explicit-search') : 'settings-conversation-or-provided-material' };
}

export function shouldUseWebSearch(prompt) {
  return classifyWebSearchIntent(prompt).requiresExternal;
}

function shouldSearchExternalClause(prompt) {
  const text = normalizeSearchText(prompt);
  if (!text) {
    return false;
  }

  if (explicitSearchPattern.test(text)) return true;
  if (/^[\d\s.+*/()%-]+$/.test(text)) return false;
  const arithmetic = text.replace(/계산|결과|알려\s*줘|얼마|뭐야|무엇|이야|인가요|인가|는|은|이|가|야|\?/g, '').trim();
  if (/\d/.test(arithmetic) && /^[\d\s.+*/()%=-]+$/.test(arithmetic)) return false;
  if (/^(?:내|저|오늘.*내).*생일(?:이야|이다|이에요|이네)[.!~]*$/.test(text)) return false;

  return /(?:나이(?=$|\s|[?？]|가|는|를|야|알려)|생년월일|출생일|생일|몇\s*살|버전|멤버|국적|소속|인구|출생)/.test(text)
    || explicitSearchPattern.test(text)
    || explicitSearchIntentPattern.test(text)
    || strongTimeSensitivePattern.test(text)
    || (relativeTimePattern.test(text) && timelyTopicPattern.test(text))
    || shouldPreferFreshPriceData(text)
    || looksLikeFactualLookupPrompt(text);
}

// 모델이 아는 척하며 끝내지 않도록, 불확실한 답변을 반환했을 때
// 호출부가 한 번 더 검색할 수 있게 한다.
export function shouldRetryWebSearchForUncertainAnswer(answer) {
  const text = normalizeSearchText(answer);
  if (!text) {
    return true;
  }

  return /(모르겠|알 수 없|알지 못|확인할 수 없|정보가 부족|찾지 못|답변하기 어렵|확실하지 않|잘 모르|기억나지 않|제공할 수 없|확인되지 않)/i.test(text);
}

export function deriveWebSearchQuery(prompt) {
  const original = normalizeSearchText(prompt);
  if (!original) {
    return '';
  }

  let query = original
    .replace(/^(검색|search)\s*[:\-]?\s*/i, '')
    .replace(/\s+(검색|search)$/i, '')
    .replace(/\s*(검색해줘|검색해 줘|검색해봐|찾아줘|찾아 줘|찾아봐|알려줘|알려 줘)\s*$/i, '')
    .replace(searchTailCleanupPattern, '')
    .replace(/\s*(좀|한번|한 번)\s*$/i, '')
    .trim();

  if (!query) {
    query = original;
  }

  if (shouldPreferFreshPriceData(query) && !hasExplicitDateReference(query) && !currentTimeReferencePattern.test(query)) {
    query = buildFreshPriceSearchQuery(query);
  }

  return normalizeSearchText(query);
}

export function shouldIncludeWebSearchSources(prompt) {
  const text = normalizeSearchText(prompt);
  if (!text) {
    return false;
  }

  return sourceRequestPattern.test(text);
}

export function formatWebSearchContext(query, results, options = {}) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedResults = Array.isArray(results) ? results : [];
  const searchedAtText = normalizeSearchText(options.searchedAtText ?? '');

  if (!normalizedQuery || normalizedResults.length === 0) {
    return '';
  }

  return [
    '아래는 방금 웹 검색으로 가져온 참고 결과다.',
    searchedAtText ? `검색 시각: ${searchedAtText}` : '',
    `검색어: ${normalizedQuery}`,
    '검색 결과 존재만으로 근거가 충분한 것은 아니다. 대상, 속성, 시점을 확인하고 결과에 없는 사실은 추측하지 않는다.',
    '현재 정보가 확인되지 않으면 과거 자료를 현재 사실처럼 답하지 않는다. 답변에 사용한 자료의 URL만 짧게 인용한다.',
    ...normalizedResults.map((result, index) => {
      const lines = [
        `[${index + 1}] 제목: ${truncateText(result.title, 320)}`,
        `URL: ${result.url}`,
      ];

      if (result.pageText) lines.push(`확인한 본문: ${truncateText(result.pageText, 4000)}`);
      if (result.snippet) {
        lines.push(`요약: ${truncateText(result.snippet, 1200)}`);
      }

      return lines.join('\n');
    }),
  ].filter(Boolean).join('\n');
}

function unwrapDuckDuckGoResultUrl(rawUrl) {
  const trimmed = String(rawUrl ?? '').trim();
  if (!trimmed) {
    return '';
  }

  try {
    const url = new URL(trimmed, duckDuckGoHtmlOrigin);
    const redirectTarget = url.searchParams.get('uddg');
    if (redirectTarget) {
      return redirectTarget;
    }

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString();
    }
  } catch {
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    if (trimmed.startsWith('//')) {
      return `https:${trimmed}`;
    }
  }

  return '';
}

async function performDuckDuckGoHtmlSearch(query, options = {}) {
  const url = new URL(duckDuckGoHtmlUrl);
  url.searchParams.set('q', normalizeSearchText(query));
  url.searchParams.set('kl', String(options.region ?? 'kr-ko'));

  const response = await (options.fetchImpl ?? fetch)(url, {
    headers: browserHeaders,
    signal: options.signal,
  });

  const html = await response.text();
  if (!response.ok) {
    const error = new Error(`DuckDuckGo HTML search failed with ${response.status}`);
    error.status = response.status;
    throw error;
  }

  if (/anomaly-modal|challenge-form|captcha/i.test(html)) {
    const error = new Error('Search blocked by challenge'); error.status = 403; throw error;
  }
  return parseDuckDuckGoHtmlResults(html);
}

function buildSearchQueryVariants(query, preferredDomains) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return [];
  }

  const variants = [normalizedQuery];
  for (const domain of preferredDomains) {
    if (!domain) {
      continue;
    }
    variants.push(`${normalizedQuery} site:${domain}`);
  }

  return [...new Set(variants)];
}

async function performNaverSearch(query, options = {}) {
  const url = new URL(naverSearchUrl);
  url.searchParams.set('where', 'nexearch');
  url.searchParams.set('query', normalizeSearchText(query));

  const response = await (options.fetchImpl ?? fetch)(url, {
    headers: browserHeaders,
    signal: options.signal,
  });

  const html = await response.text();
  if (!response.ok) {
    const error = new Error(`Naver search failed with ${response.status}`);
    error.status = response.status;
    throw error;
  }

  if (/captcha|자동입력\s*방지/i.test(html)) {
    const error = new Error('Search blocked by challenge'); error.status = 403; throw error;
  }
  return parseNaverSearchResults(html);
}

function parseNaverSearchResults(html) {
  const dom = new JSDOM(String(html ?? ''));
  const document = dom.window.document;
  const anchors = [...document.querySelectorAll('a[href]')];
  const results = [];
  const seenUrls = new Set();

  for (const anchor of anchors) {
    const rawUrl = String(anchor.href ?? '').trim();
    if (!/^https?:\/\//i.test(rawUrl)) {
      continue;
    }

    const hostname = getHostname(rawUrl);
    if (!hostname || hostname.endsWith('naver.com') || hostname.endsWith('pstatic.net')) {
      continue;
    }

    const text = normalizeSearchText(anchor.textContent ?? '');
    if (!text || text === '캐시 열기' || text.length < 6) {
      continue;
    }

    const className = String(anchor.className ?? '');
    const parentClassName = String(anchor.parentElement?.className ?? '');
    const isStructuredResult = className.includes('fender-ui_')
      || className.includes('_cav_trigger')
      || parentClassName.includes('sds-comps-')
      || parentClassName.includes('type_height_');

    if (!isStructuredResult) {
      continue;
    }

    const snippetNode = anchor.closest('[class*="sds-comps-"], [class*="type_height_"], [class*="area_video"], [class*="area_dsc"]')
      ?? anchor.parentElement;
    const snippet = normalizeSearchText(snippetNode?.textContent ?? '')
      .replace(/\s*캐시 열기/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (seenUrls.has(rawUrl)) {
      continue;
    }

    seenUrls.add(rawUrl);
    results.push({
      title: text,
      url: rawUrl,
      snippet: snippet && snippet !== text ? snippet : '',
    });
  }

  return results;
}

function mergeAndRankSearchResults(results, query, preferredDomains) {
  const deduped = [];
  const seenUrls = new Set();

  for (const result of Array.isArray(results) ? results : []) {
    const url = normalizeSearchText(result?.url);
    if (!url || seenUrls.has(url)) {
      continue;
    }

    seenUrls.add(url);
    deduped.push(result);
  }

  return deduped.sort((left, right) => compareSearchResults(left, right, query, preferredDomains));
}

function compareSearchResults(left, right, query, preferredDomains) {
  const scoreDifference = getSearchResultPriorityScore(right, query, preferredDomains)
    - getSearchResultPriorityScore(left, query, preferredDomains);
  if (scoreDifference !== 0) {
    return scoreDifference;
  }

  return 0;
}

function getSearchResultPriorityScore(result, query, preferredDomains) {
  const url = normalizeSearchText(result?.url);
  const title = normalizeSearchText(result?.title).toLowerCase();
  const snippet = normalizeSearchText(result?.snippet).toLowerCase();
  const hostname = getHostname(url);
  const pathname = getPathname(url).toLowerCase();
  const queryTokens = tokenizeSearchQuery(query);
  let score = 0;

  for (const token of queryTokens) {
    if (title.includes(token)) {
      score += 80;
    }
    if (snippet.includes(token)) {
      score += 45;
    }
    if (pathname.includes(encodeURIComponent(token).toLowerCase()) || pathname.includes(token)) {
      score += 30;
    }
  }

  preferredDomains.forEach((domain, index) => {
    if (!hostname) {
      return;
    }

    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      score += isPreferredDomainResultRelevant(result, queryTokens)
        ? 1_000 - index * 50
        : -200;
      if (pathname.includes('/w/')) {
        score += 250;
      }
    }
  });

  if (title.includes('wiki') || snippet.includes('wiki')) {
    score += 20;
  }

  return score;
}

function normalizePreferredDomains(domains) {
  const candidates = Array.isArray(domains) && domains.length > 0
    ? domains
    : defaultPreferredDomains;

  return [...new Set(
    candidates
      .map((domain) => String(domain ?? '').trim().toLowerCase())
      .map((domain) => domain.replace(/^https?:\/\//, '').replace(/\/+$/, ''))
      .filter(Boolean)
  )];
}

function looksLikeFactualLookupPrompt(text) {
  const normalized = normalizeSearchText(text);
  if (!normalized) {
    return false;
  }

  return (questionEndingPattern.test(normalized) && factualQuestionPattern.test(normalized))
    || (factualTopicPattern.test(normalized) && factualQuestionPattern.test(normalized))
    || informationRequestPattern.test(normalized);
}

function shouldPreferFreshPriceData(text) {
  return looksLikeCurrencyConversionPrompt(text) || looksLikeMarketPricePrompt(text);
}

function looksLikeCurrencyConversionPrompt(text) {
  const normalized = normalizeSearchText(text);
  if (!normalized) {
    return false;
  }

  return shortCurrencyAmountOnlyPattern.test(normalized)
    || (currencyUnitPattern.test(normalized) && currencyConversionIntentPattern.test(normalized));
}

function looksLikeMarketPricePrompt(text) {
  const normalized = normalizeSearchText(text);
  if (!normalized) {
    return false;
  }

  return /(주가|주식\s*가격|주식가격|코인\s*가격|코인가격|암호화폐\s*가격|시세)/i.test(normalized)
    || (marketAssetPattern.test(normalized) && marketPriceIntentPattern.test(normalized));
}

function hasExplicitDateReference(text) {
  return explicitDatePattern.test(normalizeSearchText(text));
}

function buildFreshPriceSearchQuery(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return '';
  }

  if (looksLikeCurrencyConversionPrompt(normalized)) {
    if (shortCurrencyAmountOnlyPattern.test(normalized)) {
      return `${normalized} 원화 환율 최신`;
    }

    return `${normalized} 최신 환율`;
  }

  if (looksLikeMarketPricePrompt(normalized)) {
    return `${normalized} 최신 시세`;
  }

  return normalized;
}

function getHostname(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function getPathname(rawUrl) {
  try {
    return new URL(rawUrl).pathname;
  } catch {
    return '';
  }
}

function tokenizeSearchQuery(query) {
  return normalizeSearchText(query)
    .toLowerCase()
    .replace(/\bsite:[^\s]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function isPreferredDomainResultRelevant(result, queryTokens) {
  if (!Array.isArray(queryTokens) || queryTokens.length === 0) {
    return true;
  }

  const title = normalizeSearchText(result?.title).toLowerCase();
  const snippet = normalizeSearchText(result?.snippet).toLowerCase();
  const pathname = getPathname(result?.url ?? '').toLowerCase();

  return queryTokens.some((token) => (
    title.includes(token)
      || snippet.includes(token)
      || pathname.includes(token)
      || pathname.includes(encodeURIComponent(token).toLowerCase())
  ));
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(value, maxLength) {
  const text = normalizeSearchText(value);
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(number)));
}
