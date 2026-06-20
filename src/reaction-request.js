export const semanticReactionEmojis = [
  ['별', '⭐'],
  ['스타', '⭐'],
  ['하트', '❤️'],
  ['좋아요', '👍'],
  ['따봉', '👍'],
  ['굿', '👍'],
  ['싫어요', '👎'],
  ['체크', '✅'],
  ['확인', '✅'],
  ['엑스', '❌'],
  ['취소', '❌'],
  ['불', '🔥'],
  ['화남', '😡'],
  ['분노', '😡'],
  ['웃음', '😂'],
  ['웃긴', '😂'],
  ['슬픔', '😭'],
  ['울음', '😭'],
  ['놀람', '😮'],
  ['축하', '🎉'],
  ['박수', '👏'],
  ['고양이', '🐱'],
  ['해마', 'seahorse'],
];

const reactionWordPattern = /(?:반응|리액션|reaction|react|이모지|emoji|이모티콘)/i;
const reactionAddWordPattern = /(?:달아줘|달아주|달아라|달아|붙여줘|붙여주|붙여|찍어줘|찍어주|찍어|추가해줘|추가해주|추가해)/i;
const previousReactionPattern = /(?:여기도|이것도|이거도|그것도|거기도|똑같이|같은\s*거|같은\s*것|아까처럼|전에처럼|방금처럼|또\s*달|또\s*해)/;

export function isReactionRequestText(content, options = {}) {
  const text = normalizeReactionText(content);
  if (!text) {
    return false;
  }

  const hasReactionWord = reactionWordPattern.test(text);
  const hasAddWord = reactionAddWordPattern.test(text);
  const hasEmojiLikeText = Boolean(options.hasEmojiLikeText);
  const hasContextWord = options.hasContextWord ?? isPreviousReactionLikeText(text);

  return hasAddWord && (
    hasReactionWord
    || hasEmojiLikeText
    || hasContextWord
  );
}

export function isPreviousReactionLikeText(text) {
  return previousReactionPattern.test(String(text ?? ''));
}

export function findSemanticReactionEmojiEntry(text, entries = semanticReactionEmojis) {
  const tokens = getReactionTextTokens(text);

  for (const [keyword, emojiText] of entries) {
    if (tokens.includes(keyword.toLowerCase())) {
      return { keyword, emojiText };
    }
  }

  return null;
}

export function findSemanticReactionEmojiText(text, entries = semanticReactionEmojis) {
  return findSemanticReactionEmojiEntry(text, entries)?.emojiText ?? null;
}

function normalizeReactionText(value) {
  return String(value ?? '')
    .replace(/^%+/, '')
    .trim();
}

function getReactionTextTokens(value) {
  return normalizeReactionText(value)
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu) ?? [];
}
