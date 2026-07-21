import { JSDOM } from 'jsdom';

const duckDuckGoHtmlOrigin = 'https://html.duckduckgo.com';
const duckDuckGoHtmlUrl = `${duckDuckGoHtmlOrigin}/html/`;
const defaultSearchTimeoutMs = 20_000;
const defaultMaxResults = 12;
const pyhokSearchUrl = 'https://pyhok.com/Search';
const defaultPyhokSearchTimeoutMs = 8_000;
const explicitSearchPattern = /(검색|찾아봐|찾아보|찾아줘|찾아 줘|알아봐|알아봐줘|알아봐 줘|\bsearch\b)/i;
const strongTimeSensitivePattern = /(최신|실시간|뉴스|속보|업데이트|환율|주가|시세|날씨|기온|영업시간|운영시간|업무시간)/i;
const relativeTimePattern = /(오늘|지금|현재|최근|이번 주|이번주|이번 달|이번달|올해|어제|내일)/i;
const timelyTopicPattern = /(날씨|기온|환율|주가|시세|가격|뉴스|일정|결과|스코어|순위|랭킹|업데이트|발표|출시|발매|영업시간|운영시간|업무시간)/i;
const sourceRequestPattern = /(출처|링크|원문|근거|참고자료|레퍼런스|reference|references|source|sources|link|links|url)/i;

export async function searchWeb(query, options = {}) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return { query: '', results: [] };
  }

  const maxResults = clampInteger(options.maxResults, 1, 20, defaultMaxResults);
  const timeoutMs = clampInteger(options.timeoutMs, 1_000, 60_000, defaultSearchTimeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(duckDuckGoHtmlUrl);
    url.searchParams.set('q', normalizedQuery);
    url.searchParams.set('kl', String(options.region ?? 'kr-ko'));

    const response = await fetch(url, {
      headers: {
        'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'user-agent': [
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'AppleWebKit/537.36 (KHTML, like Gecko)',
          'Chrome/137.0.0.0 Safari/537.36',
        ].join(' '),
      },
      signal: controller.signal,
    });

    const html = await response.text();
    if (!response.ok) {
      const error = new Error(`DuckDuckGo HTML search failed with ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return {
      query: normalizedQuery,
      results: parseDuckDuckGoHtmlResults(html).slice(0, maxResults),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchPyhok(query, options = {}) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return { query: '', results: [] };

  const maxResults = clampInteger(options.maxResults, 1, 20, defaultMaxResults);
  const timeoutMs = clampInteger(options.timeoutMs, 1_000, 60_000, defaultPyhokSearchTimeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL(pyhokSearchUrl);
    url.searchParams.set('q', normalizedQuery);

    const response = await fetch(url, {
      headers: { 'user-agent': 'KannyaDiscordBot/1.0', accept: 'text/html' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`pyhok search failed with ${response.status}`);
    return { query: normalizedQuery, results: parsePyhokSearchResults(await response.text()).slice(0, maxResults) };
  } finally {
    clearTimeout(timeout);
  }
}

export function parsePyhokSearchResults(html) {
  const dom = new JSDOM(String(html ?? ''));
  try {
    const results = [];
    for (const anchor of dom.window.document.querySelectorAll('.liberty-content-main h4 a[href^="/w/"]')) {
      const title = normalizeSearchText(anchor.textContent);
      const container = anchor.closest('h4')?.parentElement;
      const snippet = normalizeSearchText(container?.querySelector(':scope > div')?.textContent ?? '');
      const url = new URL(anchor.getAttribute('href'), 'https://pyhok.com').toString();
      if (title && !results.some((item) => item.url === url)) results.push({ title, url, snippet });
    }
    return results;
  } finally {
    dom.window.close();
  }
}

export function isRelevantPyhokSearchResult(query, result) {
  const keywords = getSearchKeywords(query);
  if (keywords.length === 0) return false;

  const title = normalizeSearchText(result?.title).toLowerCase();
  const searchableText = normalizeSearchText(`${title} ${result?.snippet ?? ''}`).toLowerCase();
  return keywords.every((keyword) => (
    keyword.length === 1 ? title.includes(keyword) : searchableText.includes(keyword)
  ));
}

function getSearchKeywords(query) {
  const stopWords = new Set(['검색', '찾아줘', '찾아', '알려줘', '알려', '정보', '대해', '관련', '무엇', '뭐야']);
  return normalizeSearchText(query)
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/(으로|에서|에게|은|는|이|가|을|를|에|의|와|과|도|로)$/u, ''))
    .filter((word) => word.length >= 1 && !stopWords.has(word));
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

export function shouldUseWebSearch(prompt) {
  const text = normalizeSearchText(prompt);
  if (!text) {
    return false;
  }

  return explicitSearchPattern.test(text)
    || strongTimeSensitivePattern.test(text)
    || (relativeTimePattern.test(text) && timelyTopicPattern.test(text));
}

export function deriveWebSearchQuery(prompt) {
  const original = normalizeSearchText(prompt);
  if (!original) {
    return '';
  }

  let query = original
    .replace(/^(검색|search)\s*[:\-]?\s*/i, '')
    .replace(/\s+(검색|search)$/i, '')
    .replace(/\s*(검색해줘|검색해 줘|검색해봐|검색해 봐|검색해주라|찾아줘|찾아 줘|찾아봐|찾아 봐|알아봐줘|알아봐 줘|알려줘)\s*$/i, '')
    .replace(/\s*(좀|한번|한 번)\s*$/i, '')
    .trim();

  if (!query) {
    query = original;
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
    '아래는 DuckDuckGo HTML 검색으로 방금 가져온 참고 결과다.',
    searchedAtText ? `검색 시각: ${searchedAtText}` : '',
    `검색어: ${normalizedQuery}`,
    '최신 정보가 필요한 질문이면 아래 결과를 우선 참고하고, 검색 결과에 없는 내용은 추측하지 않는다.',
    ...normalizedResults.map((result, index) => {
      const lines = [
        `[${index + 1}] 제목: ${truncateText(result.title, 320)}`,
        `URL: ${result.url}`,
      ];

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
