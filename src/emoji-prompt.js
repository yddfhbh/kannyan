const discordCustomEmojiPattern = /<a?:([A-Za-z0-9_]{2,32}):\d{17,20}>/g;

export function extractDiscordCustomEmojiNames(text) {
  return Array.from(
    String(text ?? '').matchAll(discordCustomEmojiPattern),
    (match) => String(match?.[1] ?? '').trim()
  ).filter(Boolean);
}

export function extractFirstUnicodeEmoji(text) {
  return extractUnicodeEmojiSegments(text)[0] ?? null;
}

export function collectEmojiOnlyTextDetails(texts) {
  const customEmojiNames = [];
  const unicodeEmojis = [];
  let matchedTextCount = 0;

  for (const text of texts ?? []) {
    const normalized = String(text ?? '').trim();
    if (!normalized || !isEmojiOnlyText(normalized)) {
      continue;
    }

    matchedTextCount += 1;
    customEmojiNames.push(...extractDiscordCustomEmojiNames(normalized));
    unicodeEmojis.push(...extractUnicodeEmojiSegments(normalized));
  }

  return {
    matchedTextCount,
    customEmojiNames: getUniqueValues(customEmojiNames),
    unicodeEmojis: getUniqueValues(unicodeEmojis),
  };
}

export function formatEmojiOnlyTextDetails(details) {
  const customEmojiNames = getUniqueValues(details?.customEmojiNames ?? []);
  const unicodeEmojis = getUniqueValues(details?.unicodeEmojis ?? []);
  const lines = [];

  if (customEmojiNames.length === 1) {
    lines.push(`커스텀 이모지 이름은 "${customEmojiNames[0]}"이다.`);
  } else if (customEmojiNames.length > 1) {
    lines.push(`커스텀 이모지 이름들은 ${customEmojiNames.map((name) => `"${name}"`).join(', ')} 이다.`);
  }

  if (unicodeEmojis.length === 1) {
    lines.push(`일반 이모지는 ${unicodeEmojis[0]} 이다.`);
  } else if (unicodeEmojis.length > 1) {
    lines.push(`일반 이모지들은 ${unicodeEmojis.join(', ')} 이다.`);
  }

  return lines.join(' ');
}

function extractUnicodeEmojiSegments(text) {
  return segmentGraphemes(
    String(text ?? '')
      .replace(discordCustomEmojiPattern, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
  ).filter(isUnicodeEmojiSegment);
}

function isEmojiOnlyText(text) {
  const normalized = String(text ?? '').trim();
  if (!normalized) {
    return false;
  }

  const customEmojiNames = extractDiscordCustomEmojiNames(normalized);
  const unicodeEmojis = extractUnicodeEmojiSegments(normalized);
  if (customEmojiNames.length === 0 && unicodeEmojis.length === 0) {
    return false;
  }

  const withoutCustomEmoji = normalized.replace(discordCustomEmojiPattern, ' ');
  const withoutEmoji = segmentGraphemes(withoutCustomEmoji)
    .filter((segment) => !isUnicodeEmojiSegment(segment))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  return withoutEmoji.length === 0;
}

function segmentGraphemes(text) {
  const normalized = String(text ?? '');

  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return Array.from(
      new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(normalized),
      (item) => item.segment
    );
  }

  return Array.from(normalized);
}

function isUnicodeEmojiSegment(segment) {
  return /\p{Emoji_Presentation}/u.test(segment) || /\p{Extended_Pictographic}/u.test(segment);
}

function getUniqueValues(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}
