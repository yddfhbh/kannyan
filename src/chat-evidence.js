import { calculateAge, getAgeReferenceDate } from './chat-clock.js';
import { derivePyhokWikiSearchQuery, extractWikiBirthDate } from './pyhok-wiki-search.js';

const noise = /^(?:검색|search|최신|최근|현재|오늘|지금|알려줘|알려|설명|누구|뭐야|무엇|나이|생일|생년월일|몇살|가격|버전|일정|출처|링크|정보)$/i;

export function searchSubjectTokens(query) {
  return String(query).toLowerCase().replace(/[?!.,:]/g, ' ').split(/\s+/)
    .map((t) => t.replace(/(?:에서|에게|은|는|을|를|의|이|가)$/, ''))
    .filter((t) => t.length >= 2 && !noise.test(t));
}

export function selectRelevantSearchResults(query, results) {
  const tokens = searchSubjectTokens(query);
  // Without an identifiable subject, snippets cannot establish relevance.
  if (!tokens.length) return [];
  return (results ?? []).filter((result) => {
    const text = `${result.title ?? ''} ${result.snippet ?? ''}`.toLowerCase();
    return tokens.some((token) => text.includes(token));
  });
}

export function buildVerifiedWebAgeReply(prompt, data, now) {
  const target = derivePyhokWikiSearchQuery(prompt);
  const primary = data?.results?.find((r) => String(r.title).includes(target) && r.pageText);
  const birth = primary ? extractWikiBirthDate(primary.pageText, target) : null;
  const referenceDate = getAgeReferenceDate(prompt, now);
  const age = calculateAge(birth, referenceDate);
  if (!birth || age === null) return '대상 인물의 명확한 생년월일을 본문에서 확인하지 못해 나이를 계산할 수 없다냥.';
  return `${target}의 생년월일은 자료에 ${birth}로 적혀 있으며, ${referenceDate} 기준 만 ${age}세다냥.\n${primary.url}`;
}


export function validateChatCitations(answer, evidence) {
  return validateChatCitationsWithStatus(answer, evidence).answer;
}

export function validateChatCitationsWithStatus(answer, evidence) {
  const urls = extractCitationUrls;
  const allowed = new Set(urls(evidence));
  const sources = new Map();
  const ambiguousIds = new Set();
  for (const match of String(evidence).matchAll(/^\[(\d+|문서 \d+)\][^\n]*\n((?:[^\n]*\n?){1,3})/gm)) {
    const sourceUrls = urls(match[2]);
    if (sourceUrls.length === 1) {
      if (sources.has(match[1]) && sources.get(match[1]) !== sourceUrls[0]) ambiguousIds.add(match[1]);
      sources.set(match[1], sourceUrls[0]);
    }
  }
  // Numeric references are meaningful only when this request's delivered
  // context contains an unambiguous mapping. Never reuse a previous manifest.
  let invalidId = false;
  answer = String(answer).replace(/\[(\d+|문서 \d+)\](?!\()/g, (reference, id) => {
    const url = sources.get(id);
    if (!url || ambiguousIds.has(id) || !allowed.has(url)) { invalidId = true; return reference; }
    return `${reference}(${url})`;
  });
  if (invalidId) return { answer: '제공된 자료에서 답변의 출처를 확인하지 못했다냥.', valid: false, reason: 'unmapped-reference-id', allowedUrls: [...allowed], citedUrls: urls(answer) };
  const cited = urls(answer);
  if (cited.some((url) => !allowed.has(url))) return { answer: '제공된 자료에서 답변의 출처를 확인하지 못했다냥.', valid: false, reason: 'url-not-in-delivered-evidence', allowedUrls: [...allowed], citedUrls: cited };
  if (!cited.length && !/확인.*못|확인되지|알 수 없|근거.*부족|자료.*없/.test(answer)) {
    // A model can correctly use the supplied material without reproducing a
    // URL. Do not discard that answer merely because citation syntax was
    // omitted: attach the bounded source manifest from this request. URLs
    // are taken only from the delivered evidence, never invented.
    const manifest = [...allowed].slice(0, 3);
    const structuredEvidence = /(?:^|\n)\[\d+\] 제목:|확인한 본문:|근거 범위:/.test(String(evidence));
    if (manifest.length && structuredEvidence && answerHasEvidenceSupport(answer, evidence)) {
      return { answer: `${answer}\n\n출처: ${manifest.join(', ')}`, valid: true, reason: 'supported-manifest-attached', allowedUrls: [...allowed], citedUrls: manifest };
    }
    return { answer: '제공된 자료만으로 답변의 근거를 특정하지 못했다냥.', valid: false };
  }
  return { answer, valid: true, reason: cited.length ? 'urls-match-delivered-evidence' : 'no-external-claim', allowedUrls: [...allowed], citedUrls: cited };
}

// A source manifest is an automatic citation fallback, not proof that the
// answer is correct. Require at least one claim-bearing term from the answer
// to occur in the delivered source context before attaching those URLs. This
// deliberately stays conservative: the model/body review remains responsible
// for semantic entailment, while unrelated answers cannot pass merely because
// a URL was present in the evidence envelope.
function answerHasEvidenceSupport(answer, evidence) {
  const stop = new Set([
    '답변', '자료', '근거', '출처', '검색', '결과', '내용', '확인', '했다', '한다', '이다', '있다', '없다',
    '알려', '알려줘', '대해', '따르면', '통해', '관련', '정보', '것', '수', '있', '없', '이다냥', '다냥',
  ]);
  const tokens = (value) => String(value)
    .replace(/https?:\/\/[^\s<>'"\]]+/gi, ' ')
    .match(/[가-힣]{2,}|[a-z][a-z0-9._-]{1,}|\d+(?:[.,]\d+)?/gi) ?? [];
  const answerTokens = tokens(answer).map((token) => token.toLowerCase())
    .filter((token) => !stop.has(token));
  const evidenceTokens = new Set(tokens(evidence).map((token) => token.toLowerCase()));
  return answerTokens.some((token) => evidenceTokens.has(token));
}

// Stop at unmatched prose/Markdown delimiters even when a Korean particle
// immediately follows the closing delimiter. Balanced parentheses in URL paths stay.
export function extractCitationUrls(text) {
  return (String(text).match(/https?:\/\/[^\s<>"'\]]+/g) ?? []).map((value) => {
    let depth = 0, end = value.length;
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '(') depth++;
      if (value[i] === ')') { if (!depth) { end = i; break; } depth--; }
    }
    const url = value.slice(0, end).replace(/[.,;!?]+$/, '');
    try { return decodeURI(new URL(url).href); } catch { return url; }
  });
}
