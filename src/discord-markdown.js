export function normalizeDiscordMarkdown(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const normalizedLines = [];
  let inCodeBlock = false;

  for (const originalLine of lines) {
    const trimmed = originalLine.trim();

    if (/^```/.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
      normalizedLines.push(originalLine);
      continue;
    }

    if (inCodeBlock) {
      normalizedLines.push(originalLine);
      continue;
    }

    let line = originalLine
      .replace(/^\s*---+\s*(?=#{1,6}\s+)/u, '')
      .trimEnd();

    if (/^\s*---+\s*$/u.test(line)) {
      normalizedLines.push('');
      continue;
    }

    const headingWithTailMatch = line.match(/^\s*#{1,6}\s+(.+?)\s+((?:\d+\.|[-*•])\s+.+)$/u);
    if (headingWithTailMatch) {
      normalizedLines.push(`**${headingWithTailMatch[1].trim()}**`);
      normalizedLines.push(headingWithTailMatch[2].trim());
      continue;
    }

    const headingMatch = line.match(/^\s*#{1,6}\s+(.+?)\s*$/u);
    if (headingMatch) {
      normalizedLines.push(`**${headingMatch[1].trim()}**`);
      continue;
    }

    normalizedLines.push(line);
  }

  return normalizedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
