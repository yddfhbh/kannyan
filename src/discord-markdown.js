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

    line = splitInlineListMarkers(line);
    line = splitInlineHeadings(line);

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

    for (const splitLine of line.split('\n')) {
      normalizedLines.push(...emphasizeListLead(splitLine).split('\n'));
    }
  }

  return insertDiscordBlockSpacing(normalizedLines)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitInlineListMarkers(line) {
  return String(line ?? '')
    .replace(
      /(\S)\s+([*\-•])\s+(?=\*\*[^*\n]{1,120}(?:\*\*|[,：:]))/gu,
      '$1\n$2 '
    )
    .replace(
      /(\S)\s+(\d+\.)\s+(?=\*\*[^*\n]{1,120}(?:\*\*|[,：:]))/gu,
      '$1\n$2 '
    )
    .replace(
      /\s+([*\-•])\s+(?=(?:\*\*)?[^:\n]{1,100}:)/gu,
      '\n$1 '
    )
    .replace(
      /\s+(\d+\.)\s+(?=(?:\*\*)?[^:\n]{1,100}:)/gu,
      '\n$1 '
    );
}

function splitInlineHeadings(line) {
  return String(line ?? '').replace(
    /([^\n])\s*#{1,6}\s+([^#\n]+?)\s+((?:\d+\.|[-*•])\s+.+)$/u,
    '$1\n**$2**\n$3'
  );
}

function emphasizeListLead(line) {
  const normalizedLine = String(line ?? '')
    .replace(/^(\s*)[*•]\s+/u, '$1- ');

  const malformedBoldTitleMatch = normalizedLine.match(
    /^(\s*(?:-|\d+\.)\s+)\*\*((?:테스트(?: 케이스)?|항목)\s*\d*[^*\n]*)$/u
  );

  if (malformedBoldTitleMatch) {
    const [, marker, title] = malformedBoldTitleMatch;
    return `${marker}**${title.trim()}**`;
  }

  const brokenInlineBoldPairMatch = normalizedLine.match(
    /^(\s*(?:-|\d+\.)\s+)\*\*([^*\n]+?),\s*((?:-|\*|\d+\.)?)\s*\*\*\s*([^*\n]+)\*\*\s*$/u
  );

  if (brokenInlineBoldPairMatch) {
    const [, firstMarker, firstTitle, secondMarkerRaw, secondTitle] = brokenInlineBoldPairMatch;
    const secondMarker = /^\d+\.$/u.test(secondMarkerRaw) ? secondMarkerRaw : '-';

    return `${firstMarker}**${firstTitle.trim()}**\n${secondMarker} **${secondTitle.trim()}**`;
  }

  if (/^\s*(?:-|\d+\.)\s+\*\*.+\*\*\s*$/u.test(normalizedLine)) {
    return normalizedLine;
  }

  const match = normalizedLine.match(
    /^(\s*(?:-|\d+\.)\s+)([^:\n*]{2,80}):\s+(.+)$/u
  );

  if (!match) {
    return normalizedLine;
  }

  const [, marker, rawLabel, rest] = match;
  const label = rawLabel.trim();

  return `${marker}**${label}**: ${rest.trim()}`;
}

function insertDiscordBlockSpacing(lines) {
  const result = [];

  for (const line of lines) {
    const trimmed = String(line ?? '').trim();

    if (!trimmed) {
      if (result.at(-1) !== '') {
        result.push('');
      }
      continue;
    }

    const previous = result.at(-1) ?? '';
    const previousTrimmed = previous.trim();

    if (
      previousTrimmed
      && shouldInsertBlankLineBetween(previousTrimmed, trimmed)
      && previous !== ''
    ) {
      result.push('');
    }

    result.push(line);
  }

  return result;
}

function shouldInsertBlankLineBetween(previousLine, currentLine) {
  if (isDiscordHeadingLine(currentLine) && !isDiscordHeadingLine(previousLine)) {
    return true;
  }

  if (isDiscordListLine(currentLine) && !isDiscordListLine(previousLine)) {
    return true;
  }

  return false;
}

function isDiscordHeadingLine(line) {
  return /^\*\*.+\*\*$/u.test(String(line ?? '').trim());
}

function isDiscordListLine(line) {
  return /^(?:[-*]|\d+\.)\s+/u.test(String(line ?? '').trim());
}
