const requestSuffixPattern = String.raw`(?:\s*(?:줘|줘봐|보여줘|보여\s*줘|보내줘|보내\s*줘))?`;

const chessPgnRequestPatterns = [
  new RegExp(`^(?:pgn|피지엔|기보|수순)${requestSuffixPattern}$`, 'iu'),
  new RegExp(`^(?:최근\\s*대국\\s*(?:pgn|피지엔|기보|수순))${requestSuffixPattern}$`, 'iu'),
  new RegExp(`^(?:방금\\s*(?:경기|한\\s*거)(?:\\s*기록)?)${requestSuffixPattern}$`, 'iu'),
];

function normalizeChessPgnIntentText(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/^%+/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function isChessPgnRequestText(text) {
  const normalized = normalizeChessPgnIntentText(text);

  if (!normalized) {
    return false;
  }

  if (normalized.length > 32) {
    return false;
  }

  const tokenCount = normalized.split(' ').filter(Boolean).length;
  if (tokenCount > 6) {
    return false;
  }

  return chessPgnRequestPatterns.some((pattern) => pattern.test(normalized));
}
