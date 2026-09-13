const explicitFollowupPattern =
  /^(?:왜|왜\?|뭐|뭐야|그게 뭐야|그건|이건|저건|그거|이거|저거|그럼|그래서|근데|그리고|ㅇㅇ|ㅇㅋ|ok|네|응|야|동|검색해서알려줘|검색하여알려줘|찾아서알려줘)$/i;
const contextualReferencePattern = /(?:그|이|저)\s*(?:거|건|곡|사람|내용|걸|걸로|쪽)|(?:방금|위에|아까|직전|계속|더|도)\s*(?:알려|설명|검색|찾아|정리|말해)|(?:검색해서|검색하여|찾아서)\s*(?:알려줘|알려 줘)?$/i;

export function isLikelyContextDependentPrompt(prompt) {
  const text = String(prompt ?? '').trim();
  if (!text) {
    return false;
  }

  const normalized = text.replace(/[.!?~ㅋㅎ]+$/g, '').trim();
  if (!normalized) {
    return false;
  }

  if (explicitFollowupPattern.test(normalized)) {
    return true;
  }

  if (contextualReferencePattern.test(normalized)) {
    return true;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }

  if (tokens.length === 1) {
    const singleToken = tokens[0];

    if (/^[가-힣]$/.test(singleToken)) {
      return true;
    }

    if (/^[가-힣]{2,3}$/.test(singleToken)) {
      return true;
    }

    if (/^[a-zA-Z]{1,3}$/.test(singleToken)) {
      return true;
    }
  }

  return normalized.length <= 6 && tokens.length <= 2;
}
