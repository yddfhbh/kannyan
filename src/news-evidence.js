import { canCollectEvidence } from './chat-time-budget.js';
import { classifyChatError } from './chat-errors.js';
import { fetchWebPageText } from './web-page-content.js';
import { searchWeb } from './web-search.js';
import { reviewSourceBodies } from './evidence-review.js';
import { rankNewsCandidates } from './news-candidates.js';

export function isNewsRequest(text) {
  return /뉴스|기사|\bnews\b/i.test(String(text));
}

function isArticleLink(url) {
  return !/\/(?:tags?|category|categories|topics?|search)(?:\/|\?|$)/i.test(url.pathname)
    && !/\/(?:news|newsroom|press|blog|index\.(?:html?|php))\/?$/i.test(url.pathname)
    && url.pathname.split('/').filter(Boolean).length > 0;
}

// A search hit is discovery, never proof of a recent article. The fetch helper
// retains DNS/redirect/private-address checks. One retry and six page reads are
// shared across portals, their related links, and direct search hits.
export async function collectNewsEvidence(query, initial, options = {}) {
  const readPage = options.readPage ?? fetchWebPageText;
  const search = options.search ?? searchWeb;
  const now = new Date(options.now ?? Date.now());
  const tokens = String(query).toLowerCase().replace(/최신|최근|오늘|주요|소식|뉴스|기사|검색|요약|해줘|해서|알려줘|latest|news|today/g, ' ')
    .match(/[\p{Letter}\p{Number}]{2,}/gu) ?? [];
  let articles = [];
  const seen = new Set();
  const attempts = [];
  const retryAttempts = [];
  const selections = [...(initial.candidateSelection ?? [])];
  const select = (items, round) => {
    const ranked = rankNewsCandidates(items, now);
    selections.push(...ranked.map(({candidate, ...r}) => ({url:candidate.url, round, ...r})));
    return ranked.filter(r => r.eligible).map(r => r.candidate);
  };
  let queue = select(initial.results ?? [], 0);
  let retried = false;
  let searchAvailable = Boolean(initial.results?.length) || ['success', 'empty', 'irrelevant'].includes(initial.status);
  let lastStatus = initial.status;
  let retryFailed = false;
  const discoveryStatuses = [initial.status];
  while (canCollectEvidence(3000) && attempts.length < 6 && articles.length < (options.reviewSources ? 4 : 3)) {
    if (!queue.length) {
      if (!canCollectEvidence(8000) || retried || (!options.reviewSources && articles.length >= 2)) break;
      retried = true;
      let retry;
      try {
        retry = await search(`${query} ${now.toISOString().slice(0, 10)} article`, { maxResults: 6, timeoutMs: 8000 });
      } catch (error) {
        retry = { status: error?.kind || (error?.name === 'AbortError' ? 'timeout' : 'failed'), failed: true, results: [], attempts: [] };
      }
      searchAvailable ||= Boolean(retry.results?.length) || ['success', 'empty', 'irrelevant'].includes(retry.status);
      lastStatus = retry.status;
      discoveryStatuses.push(retry.status);
      retryFailed ||= Boolean(retry.failed);
      retryAttempts.push(...(retry.attempts ?? []));
      selections.push(...(retry.candidateSelection ?? []));
      queue = select(retry.results ?? [], 1);
      if (!queue.length) break;
    }
    const candidate = queue.shift();
    let url;
    try {
      url = new URL(candidate.url);
      if (!['http:', 'https:'].includes(url.protocol) || seen.has(url.href)) continue;
    } catch { continue; }
    seen.add(url.href);
    const attempt = { status: 'unavailable', discoveredUrl: url.href, discoveredTitle: candidate.title || '', parentUrl: candidate.parentUrl || '', discovery: candidate.parentUrl ? 'page-link' : retried ? 'retry-search' : 'search' };
    attempts.push(attempt);
    try {
      const page = await readPage(url.href, { timeoutMs: 3000, totalTimeoutMs: 3000, maxTextLength: 6000 });
      const date = /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(page.publishedAt ?? '') ? new Date(page.publishedAt) : new Date(NaN);
      const age = now - date;
      const title = page.articleTitle || page.title;
      // A title AND the lead body must name the topic. A substring in a menu
      // or a single mention in a long article cannot establish its core subject.
      const contains = (text, token) => /^[a-z0-9]+$/i.test(token)
        ? new RegExp(`(?<![a-z0-9])${token}(?![a-z0-9])`, 'i').test(text)
        : String(text).toLowerCase().includes(token);
      const lexicalTopicMatch = tokens.length > 0 && tokens.some((token) => contains(String(title), token)
        && contains(String(page.text).slice(0, 1200), token));
      const relevant = Boolean(options.reviewSources) || lexicalTopicMatch;
      const bodyValid = page.text?.length >= 120 && page.bodyQuality !== 'insufficient';
      const fresh = Number.isFinite(age) && age >= -86400000 && age <= 14 * 86400000;
      let identityValid = true;
      try {
        if (page.canonicalUrl) {
          const identity = (value) => {
            const parsed = new URL(value, page.url);
            parsed.hash = '';
            parsed.pathname = parsed.pathname.replace(/\/$/, '');
            for (const key of [...parsed.searchParams.keys()]) if (/^utm_|^(?:fbclid|gclid)$/.test(key)) parsed.searchParams.delete(key);
            parsed.searchParams.sort();
            return parsed.href;
          };
          identityValid = identity(page.canonicalUrl) === identity(page.url);
        }
      } catch { identityValid = false; }
      Object.assign(attempt, { fetchedUrl: page.url, canonicalUrl: page.canonicalUrl || '', extractedTitle: title, publishedAt: page.publishedAt,
        extractedBody: page.text, bodyValid, fresh, lexicalTopicMatch, identityValid });
      if (page.isArticle && page.publicationEvidence && title && bodyValid && fresh && relevant && identityValid
          && isArticleLink(new URL(page.url))) {
        if (!articles.some((article) => article.url === page.url)) articles.push({
          title, discoveredTitle: candidate.title || '', discoveredUrl: url.href, url: page.url, publishedAt: page.publishedAt,
          publicationEvidence: page.publicationEvidence, pageText: page.text,
        });
        attempt.status = 'verified-article';
      } else {
        attempt.status = !identityValid ? 'identity-mismatch' : !bodyValid ? 'insufficient-body' : !relevant ? 'off-topic' : !page.publishedAt ? 'missing-publication-date' : !fresh ? 'not-recent' : 'not-article';
        const links = [];
        for (const link of page.links ?? []) {
          try {
            const target = new URL(link.url, page.url);
            if (target.origin === new URL(page.url).origin && isArticleLink(target)
                && !seen.has(target.href) && tokens.some((token) => contains(String(link.title), token))) links.push({ url: target.href, title: link.title, parentUrl: page.url });
          } catch { /* Invalid discovery links are ignored. */ }
        }
        queue = select([...links, ...queue], retried ? 1 : 0);
      }
    } catch (error) { attempt.status = 'read-failed'; attempt.error = classifyChatError(error); }
    // Leave room for one more specific search instead of spending all reads on
    // the original list of portal/category pages.
    if (!retried && attempts.length === 3 && !articles.length && !queue.some(c => rankNewsCandidates([c], now)[0].dateHint)) queue = [];
  }
  let reviewFailed = false;
  let reviewError;
  if (options.reviewSources && articles.length) {
    try {
      const reviewed = await options.reviewSources(articles);
      reviewFailed = reviewed.some((article) => article.bodyReview?.status === 'invalid-review');
      articles = reviewed.filter((article) => article.bodyReview?.relevant === true);
      for (const attempt of attempts) {
        if (attempt.status === 'verified-article') {
          const review = reviewed.find((article) => article.url === attempt.fetchedUrl)?.bodyReview;
          attempt.relevance = review;
          attempt.status = review?.relevant === true ? 'verified-article' : 'relevance-rejected';
        }
      }
    } catch (error) { reviewError = classifyChatError(error); reviewFailed = true; articles = []; for (const attempt of attempts) if (attempt.status === 'verified-article') attempt.status = 'relevance-unverified'; }
  }
  articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  articles = articles.slice(0, 3);
  const pageReadFailed = attempts.some((attempt) => attempt.status === 'read-failed');
  const discoveryFailure = discoveryStatuses.find((status) => ['blocked', 'timeout', 'failed', 'parse-error'].includes(status));
  const discoveryEmpty = discoveryStatuses.length > 0 && discoveryStatuses.every((status) => ['empty', 'irrelevant', 'success'].includes(status));
  const candidateShortage = selections.some(s => !s.eligible) || attempts.some(a => !['read-failed','verified-article'].includes(a.status));
  const retrievalFailed = !articles.length && !candidateShortage && (retryFailed || pageReadFailed);
  const finalStatus = reviewFailed ? 'review-failed'
    : !searchAvailable ? (discoveryFailure || lastStatus)
      : retrievalFailed ? 'retrieval-failed'
        : articles.length ? 'success'
          : discoveryEmpty ? 'no-verified-articles' : (lastStatus || 'no-verified-articles');
  return {
    ...initial, results: articles, status: finalStatus,
    failed: reviewFailed || retrievalFailed || !searchAvailable,
    attempts: [...(initial.attempts ?? []), ...retryAttempts],
    newsVerification: { error: reviewError, initialResults: initial.results?.length ?? 0, pageReads: attempts.length,
      retried, articles: articles.length, freshnessDays: 14, attempts, selections, candidateShortage,
      failures: { search: retryFailed || Boolean(initial.failed), pageReads: attempts.filter(a => a.status === 'read-failed').length },
      discovery: { statuses: discoveryStatuses, outcome: initial.results?.length || selections.length ? 'results' : discoveryFailure ? 'request-failed' : 'empty' },
      pageOutcome: pageReadFailed ? 'read-failed' : attempts.length ? 'read-complete' : 'not-attempted' },
  };
}

// Render verified metadata outside free-form generation so a model cannot omit
// publication dates or turn one article into a claim about several trends.
export async function answerVerifiedNews(data, generate, options = {}) {
  const articles = data.results ?? [];
  // Summaries share a deadline, then one review validates each candidate only
  // against its corresponding article. This keeps two articles within five calls
  // including planning and retrieval review.
  const candidates = await Promise.all(articles.map(async (article) => {
    const body = article.pageText || article.bodyReview?.quote;
    const context = `제목: ${article.title}\n게시일: ${article.publishedAt}\nURL: ${article.url}\n확인한 본문: ${body}`;
    try {
      const result = await generate('제공한 기사 한 건의 핵심 내용을 한국어 1~2문장으로 짧게 요약해줘. 원문을 복사해 발췌로 대신하지 마라. 다른 기사나 업계 전체 동향으로 일반화하지 마라. 본문에 없는 수치·원인·전망을 추가하지 마라.', {
        ...options, history: [], externalOnly: true, webSearchContext: context,
      });
      const text = String(result.answer || '').replace(/https?:\/\/\S+/g, '').trim();
      return { article, body, result, eligible: result.citationsValid !== false && Boolean(text) && !text.includes(body.trim()) && !body.includes(text) };
    } catch (error) {
      options.onVerificationFailure?.(classifyChatError(error));
      return { article, body, eligible: false };
    }
  }));
  const pending = candidates.filter((c) => c.eligible);
  let reviewed = [];
  if (pending.length) try {
    reviewed = await reviewSourceBodies('기사별 요약 검증', pending.map((c) => ({ ...c.article, pageText: c.body })), generate, {
      finalVerification: true,
      constraints: `각 자료 id에 대응하는 요약 후보만 그 자료로 검증한다. 모든 사실 주장이 직접 뒷받침될 때만 relevant=true, requestSatisfied=true다. 원문에 없는 주장·일반화는 거부한다. quote는 뒷받침하는 실제 원문을 복사한다.\n${pending.map((c, id) => `[${id}] 요약 후보: ${c.result.answer}`).join('\n')}`,
    });
  } catch (error) { options.onVerificationFailure?.(classifyChatError(error)); }
  const blocks = candidates.map((candidate) => {
    const { article } = candidate;
    const valid = reviewed[pending.indexOf(candidate)]?.bodyReview.relevant === true;
    const summary = valid ? candidate.result.answer : '요약 검증에 실패해 이 기사의 요약을 제공하지 못했다냥.';
    options.onVerificationResult?.({ url: article.url, status: valid ? 'success' : 'rejected' });
    if (!valid) options.onVerificationFailure?.({ category: 'validator', code: 'NEWS_SUMMARY_UNVERIFIED' });
    return `제목: ${article.title}\n게시일: ${article.publishedAt}\n요약: ${summary}\nURL: ${article.url}`;
  });
  return `최근 ${data.newsVerification.freshnessDays}일 범위에서 게시일과 본문을 확인한 관련 기사는 ${articles.length}건${articles.length === 1 ? '뿐' : ''}이다냥. 아래 내용은 확보한 기사에 한정한 요약이다냥.\n\n${blocks.join('\n\n')}`;
}
