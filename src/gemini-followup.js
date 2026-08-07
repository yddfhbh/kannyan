const explicitFollowupPattern =
  /^(?:왜|왜\?|뭐|뭐야|그게 뭐야|그건|이건|저건|그거|이거|저거|그럼|그래서|근데|그리고|ㅇㅇ|ㅇㅋ|ok|네|응|야|동)$/i;

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
