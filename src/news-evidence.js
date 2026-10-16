import { classifyChatError } from './chat-errors.js';
import { fetchWebPageText } from './web-page-content.js';
import { searchWeb } from './web-search.js';
import { reviewSourceBodies } from './evidence-review.js';

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
  let queue = [...(initial.results ?? [])];
  let retried = false;
  let searchAvailable = Boolean(initial.results?.length) || ['success', 'empty', 'irrelevant'].includes(initial.status);
  let lastStatus = initial.status;
  let retryFailed = false;
  while (attempts.length < 6 && articles.length < (options.reviewSources ? 6 : 3)) {
    if (!queue.length) {
      if (retried || (!options.reviewSources && articles.length >= 2)) break;
      retried = true;
      const retry = await search(`${query} ${now.toISOString().slice(0, 10)} article`, { maxResults: 6, timeoutMs: 8000 });
      searchAvailable ||= Boolean(retry.results?.length) || ['success', 'empty', 'irrelevant'].includes(retry.status);
      lastStatus = retry.status;
      retryFailed ||= Boolean(retry.failed);
      retryAttempts.push(...(retry.attempts ?? []));
      queue = [...(retry.results ?? [])];
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
        attempt.status = !identityValid ? 'identity-mismatch' : !bodyValid ? 'insufficient-body' : !relevant ? 'off-topic' : !fresh ? 'not-recent' : 'not-article';
        const links = [];
        for (const link of page.links ?? []) {
          try {
            const target = new URL(link.url, page.url);
            if (target.origin === new URL(page.url).origin && isArticleLink(target)
                && !seen.has(target.href) && tokens.some((token) => contains(String(link.title), token))) links.push({ url: target.href, title: link.title, parentUrl: page.url });
          } catch { /* Invalid discovery links are ignored. */ }
        }
        queue.unshift(...links.slice(0, 3));
      }
    } catch (error) { attempt.status = 'read-failed'; attempt.error = classifyChatError(error); }
    // Leave room for one more specific search instead of spending all reads on
    // the original list of portal/category pages.
    if (!retried && attempts.length === 3 && (options.reviewSources || articles.length < 2)) queue = [];
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
  const retrievalFailed = !articles.length && (retryFailed || attempts.some((attempt) => attempt.status === 'read-failed'));
  return {
    ...initial, results: articles, status: reviewFailed ? 'review-failed' : !searchAvailable ? lastStatus : retrievalFailed ? 'retrieval-failed' : articles.length ? 'success' : 'no-verified-articles',
    failed: reviewFailed || retrievalFailed || !searchAvailable,
    attempts: [...(initial.attempts ?? []), ...retryAttempts],
    newsVerification: { error: reviewError, initialResults: initial.results?.length ?? 0, pageReads: attempts.length,
      retried, articles: articles.length, freshnessDays: 14, attempts },
  };
}

// Render verified metadata outside free-form generation so a model cannot omit
// publication dates or turn one article into a claim about several trends.
export async function answerVerifiedNews(data, generate, options = {}) {
  const articles = data.results ?? [];
  const blocks = [];
  for (const article of articles) {
    const body = article.bodyReview?.quote || article.pageText;
    const context = `제목: ${article.title}\n게시일: ${article.publishedAt}\nURL: ${article.url}\n검증된 본문: ${body}`;
    let summary = '요약 검증에 실패해 이 기사의 요약을 제공하지 못했다냥.';
    try {
      const result = await generate('제공한 기사 한 건의 핵심 내용을 한국어 1~2문장으로 짧게 요약해줘. 원문을 복사해 발췌로 대신하지 마라. 다른 기사나 업계 전체 동향으로 일반화하지 마라. 본문에 없는 수치·원인·전망을 추가하지 마라.', {
        ...options, history: [], externalOnly: true, webSearchContext: context,
      });
      if (result.citationsValid !== false && result.answer) {
        const reviewed = await reviewSourceBodies(result.answer, [{ ...article, pageText: body }], generate, {
          constraints: '질문은 기사 요약 후보이다. 후보의 모든 사실 주장이 본문에서 직접 뒷받침될 때만 relevant=true다. 하나라도 원문에 없는 주장·일반화가 있으면 false다. quote에는 후보를 뒷받침하는 실제 본문을 복사한다.',
        });
        const text = result.answer.replace(/https?:\/\/\S+/g, '').trim();
        if (reviewed[0]?.bodyReview.relevant && !text.includes(body.trim()) && !body.includes(text)) summary = result.answer;
      }
    } catch (error) {
      options.onVerificationFailure?.(classifyChatError(error));
    }
    if (summary.startsWith('요약 검증에 실패')) options.onVerificationFailure?.({ category: 'validator', code: 'NEWS_SUMMARY_UNVERIFIED' });
    blocks.push(`제목: ${article.title}\n게시일: ${article.publishedAt}\n요약: ${summary}\nURL: ${article.url}`);
  }
  return `최근 ${data.newsVerification.freshnessDays}일 범위에서 게시일과 본문을 확인한 관련 기사는 ${articles.length}건${articles.length === 1 ? '뿐' : ''}이다냥. 아래 내용은 확보한 기사에 한정한 요약이다냥.\n\n${blocks.join('\n\n')}`;
}
