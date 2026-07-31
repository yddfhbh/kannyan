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
      normalizedLines.push(emphasizeListLead(splitLine));
    }
  }

  return insertDiscordBlockSpacing(normalizedLines)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitInlineListMarkers(line) {
  return String(line ?? '')
    // "* 입력:", "- 입력:", "• 입력:", "* **테스트 1:" 등을 줄바꿈
    .replace(
      /\s+([*\-•])\s+(?=(?:\*\*)?[^:\n]{1,100}:)/gu,
      '\n$1 '
    )
    .replace(
      /\s+(\d+\.)\s+(?=(?:\*\*)?[^:\n]{1,100}:)/gu,
      '\n$1 '
    );
}

function emphasizeListLead(line) {
  const normalizedLine = String(line ?? '')
    // 별표·가운뎃점 불릿을 하이픈으로 통일
    .replace(/^(\s*)[*•]\s+/u, '$1- ');

  /*
   * "- **테스트 1: 시스템 지시 무시 및 공개 요구"
   * 처럼 테스트 제목의 닫는 **가 빠진 경우만 복구
   */
  const malformedBoldTitleMatch = normalizedLine.match(
    /^(\s*(?:-|\d+\.)\s+)\*\*((?:테스트|단계|항목)\s*\d*[^*\n]*)$/u
  );

  if (malformedBoldTitleMatch) {
    const [, marker, title] = malformedBoldTitleMatch;
    return `${marker}**${title.trim()}**`;
  }

  // 이미 정상적인 굵은 제목이면 그대로 유지
  if (/^\s*(?:-|\d+\.)\s+\*\*.+\*\*\s*$/u.test(normalizedLine)) {
    return normalizedLine;
  }

  // "- 입력: 내용" → "- **입력**: 내용"
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
