// Presentation only: call after citation and claim verification. Keep the
// original answer and source records available to verification and logging.
export function formatChatDisplayAnswer(answer) {
  const text = String(answer ?? '')
    .replace(/!?\[([^\]\n]*)\]\(\s*<?(?:https?:\/\/|www\.)[^\s]*?(?:\([^\s]*?\)[^\s]*?)*>?\s*(?:["'][^\n]*?["'])?\)/gi,
      (_match, label) => /^(?:\d+|문서\s*\d+|https?:\/\/\S+|www\.\S+)$/.test(label) ? '' : label)
    .replace(/^\s*\[[^\]\n]+\]:\s*(?:<?https?:\/\/|www\.)[^\n]*$/gim, '')
    .replace(/<https?:\/\/[^>\n]+>|(?:https?:\/\/|www\.)[^\s<>\[\]"']+/gi, '')
    .split('\n').map(line => line.trimEnd())
    .filter(line => !/^\s*(?:(?:[-*]\s*)?(?:URL|출처|출처 URL|공식 원문 URL|링크)\s*[:：]?\s*|[-*]\s*)$/i.test(line))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text || '확인한 자료의 주소는 답변에 표시하지 않는다냥.';
}
