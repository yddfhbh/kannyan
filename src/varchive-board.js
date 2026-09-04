import { normalizeVArchiveNickname } from './varchive-link-store.js';

const varchiveBaseUrl = 'https://v-archive.net';
const varchiveRequestTimeoutMs = 15_000;
const varchiveBoardPageCacheTtlMs = 10 * 60 * 1000;
const boardPageHtmlCache = new Map();

export async function fetchVArchiveBoardPageHtml(nickname, button, boardNo, options = {}) {
  const fetchImpl = resolveFetch(options.fetchImpl);
  const normalizedNickname = normalizeVArchiveNickname(nickname);
  const normalizedButton = Number(button);
  const normalizedBoardNo = Number(boardNo);
  const cacheKey = `${normalizedNickname}:${normalizedButton}:${normalizedBoardNo}`;
  const cached = boardPageHtmlCache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), varchiveRequestTimeoutMs);
    const url = `${varchiveBaseUrl}/archive/${encodeURIComponent(normalizedNickname)}/board/${normalizedButton}/${normalizedBoardNo}`;

    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
        },
      });

      if (!response.ok) {
        const error = new Error(`Failed to fetch V-ARCHIVE board page: ${response.status}`);
        error.code = 'VARCHIVE_BOARD_FETCH_FAILED';
        error.status = response.status;
        error.nickname = normalizedNickname;
        throw error;
      }

      const html = await response.text();
      if (looksLikeNotFoundHtml(html)) {
        const error = new Error(`V-ARCHIVE에서 ${normalizedNickname} 유저를 찾지 못했다냥.`);
        error.code = 'VARCHIVE_PROFILE_NOT_FOUND';
        error.status = 404;
        error.nickname = normalizedNickname;
        throw error;
      }

      return html;
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeoutError = new Error('V-ARCHIVE 응답이 너무 오래 걸린다냥.');
        timeoutError.code = 'VARCHIVE_BOARD_TIMEOUT';
        timeoutError.nickname = normalizedNickname;
        throw timeoutError;
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })();

  boardPageHtmlCache.set(cacheKey, {
    expiresAt: now + varchiveBoardPageCacheTtlMs,
    promise,
  });

  return promise;
}

export function extractVArchiveBoardPageEntries(html, button) {
  const normalizedButton = Number(button);
  const source = String(html ?? '');
  const targetPattern = new RegExp(
    `<div id="${normalizedButton}-([^"-]+)-(NM|HD|MX|SC)"[^>]*>[\\s\\S]*?<div class="([^"]*text-center[^"]*)">([^<]+)</div>`,
    'gi',
  );
  const entries = new Map();

  for (const match of source.matchAll(targetPattern)) {
    const titleId = decodeHtmlEntities(match[1]).trim();
    const difficulty = decodeHtmlEntities(match[2]).trim().toUpperCase();
    const scoreClassName = match[3];
    const scoreText = decodeHtmlEntities(match[4]).trim();
    const scoreKind = scoreText === '-'
      ? 'none'
      : normalizeScoreKind(scoreClassName.match(/bg-\[color:var\(--([^)]+)\)\]/i)?.[1]);

    entries.set(`${titleId}:${difficulty}`, {
      titleId,
      difficulty,
      scoreText,
      scoreKind,
    });
  }

  return entries;
}

export function parseBoardPageEntry(html, button, titleId, difficulty) {
  const entries = extractVArchiveBoardPageEntries(html, button);
  return entries.get(`${String(titleId ?? '').trim()}:${String(difficulty ?? '').trim().toUpperCase()}`) ?? null;
}

export function clearVArchiveBoardPageHtmlCache() {
  boardPageHtmlCache.clear();
}

function looksLikeNotFoundHtml(html) {
  const text = String(html ?? '');
  return text.includes('페이지를 찾을 수 없습니다')
    && !text.includes('님의 성과표');
}

function resolveFetch(fetchImpl) {
  const targetFetch = fetchImpl ?? globalThis.fetch;
  if (typeof targetFetch !== 'function') {
    throw new Error('현재 실행 환경에서 fetch를 사용할 수 없다냥.');
  }

  return targetFetch;
}

function normalizeScoreKind(value) {
  const lowered = String(value ?? '').trim().toLowerCase();
  if (!lowered) {
    return 'score';
  }

  if (['perfect', 'maxcombo', 'clear'].includes(lowered)) {
    return lowered;
  }

  return 'score';
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', '\'');
}
