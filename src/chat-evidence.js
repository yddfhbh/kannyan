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
  const urls = (text) => (String(text).match(/https?:\/\/[^\s<>"'\]]+/g) ?? []).map((value) => {
    let url = value.replace(/[.,;!?]+$/, '');
    // Markdown's closing parenthesis is not part of the URL; balanced URL
    // parentheses (common in wiki titles) must remain intact.
    while (url.endsWith(')') && (url.match(/\)/g) ?? []).length > (url.match(/\(/g) ?? []).length) url = url.slice(0, -1);
    try { return decodeURI(new URL(url).href); } catch { return url; }
  });
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
  if (invalidId) return { answer: '제공된 자료에서 답변의 출처를 확인하지 못했다냥.', valid: false };
  const cited = urls(answer);
  if (cited.some((url) => !allowed.has(url))) return { answer: '제공된 자료에서 답변의 출처를 확인하지 못했다냥.', valid: false };
  if (!cited.length && !/확인.*못|확인되지|알 수 없|근거.*부족|자료.*없/.test(answer)) {
    return { answer: '제공된 자료만으로 답변의 근거를 특정하지 못했다냥.', valid: false };
  }
  return { answer, valid: true };
}
