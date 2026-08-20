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

  return ensureCouncilRoleSectionLineBreaks(
    insertDiscordBlockSpacing(normalizedLines)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

export function ensureCouncilRoleSectionLineBreaks(text) {
  return String(text ?? '').replace(
    /(^|\n)(\*\*(?:kanna|isharong|gangji)(?:[^*\n]{0,80})\*\*)[ \t]*(?=\S)/giu,
    '$1$2\n'
  );
}

function splitInlineListMarkers(line) {
  return String(line ?? '')
    // "문장. - **장르**: 내용"을 반드시 새 줄로 분리
    .replace(
      /(\S)[ \t]+(?=[\-•–—−][ \t]*\*\*[^*\n]{1,120}\*\*[ \t]*[:：])/gu,
      '$1\n'
    )

    // "문장. **- 출시일:**2025"
    .replace(
      /(\S)\s+\*\*\s*([\-•–—−])\s*([^*\n:：]{1,100}?)([:：])\s*\*\*/gu,
      '$1\n$2 **$3**$4 '
    )

    // "문장. **- 출시일**: 2025"
    .replace(
      /(\S)\s+\*\*\s*([\-•–—-−])\s*([^*\n:：]{1,100}?)\s*\*\*\s*([:：])/gu,
      '$1\n$2 **$3**$4 '
    )

    // "문장. -출시일:2025", 유니코드 대시 포함
    .replace(
      /(\S)\s+([\-•–—-−])(?=(?:\*\*)?[^:：\n]{1,100}[:：])/gu,
      '$1\n$2 '
    )

    // 기존: "문장. - **출시일:** 2025"
    .replace(
      /(\S)\s+([*\-•–—-−])\s+(?=\*\*[^*\n]{1,120}(?:\*\*|[,：:]))/gu,
      '$1\n$2 '
    )

    // 기존 번호 목록
    .replace(
      /(\S)\s+(\d+\.)\s+(?=\*\*[^*\n]{1,120}(?:\*\*|[,：:]))/gu,
      '$1\n$2 '
    )

    // 기존 일반 라벨 목록
    .replace(
      /\s+([*\-•–—-−])\s+(?=(?:\*\*)?[^:：\n]{1,100}[:：])/gu,
      '\n$1 '
    )

    // 기존 번호 라벨 목록
    .replace(
      /\s+(\d+\.)\s+(?=(?:\*\*)?[^:：\n]{1,100}[:：])/gu,
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
  .replace(/^(\s*)[*•–—-−]\s+/u, '$1- ')
  .replace(/^(\s*)-\s*/u, '$1- ');

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
      // Discord가 순수 빈 줄이나 U+200B를 접는 경우가 있어서
      // 실제 줄 높이를 차지하는 Braille Pattern Blank를 사용한다.
      result.push('\u2800');
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
