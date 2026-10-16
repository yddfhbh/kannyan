export function transformKannyangProse(text, transform) {
  const original = String(text ?? '');
  const protectedParts = [];
  let tokenPrefix = '\u0000KANNYANG_';
  while (original.includes(tokenPrefix)) tokenPrefix += '_';
  // Protect literals before applying the legacy cleanup. Unclosed fences are
  // protected to EOF too; source labels/links and quotations are not our prose.
  const protectedPattern = new RegExp([
    // Fenced and inline code, including backticks inside a longer delimiter.
    String.raw`^[ \t]*(?<fence>\x60{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?(?:^[ \t]*\k<fence>[^\S\r\n]*(?=\r?$)|(?![\s\S]))`,
    String.raw`(?<ticks>\x60+)(?!\x60)[\s\S]*?(?<!\x60)\k<ticks>(?!\x60)`,
    String.raw`^[ \t]*>>>[\s\S]*$|^[ \t]*>[^\r\n]*`,
    String.raw`^[ \t]*(?:[-*]\s*)?(?:\*\*)?(?:출처|참고(?:\s*자료)?|자료 종류|제목|URL|Sources?|References?)(?:\*\*)?\s*[:：][^\r\n]*`,
    String.raw`^[ \t]*\[\d+\][^\r\n]*|\[[^\]\r\n]*\]\([^\r\n]*?\)`,
    String.raw`https?:\/\/[^\s<>"'“”‘’\x60]+`,
    String.raw`“[^”]*”|‘[^’]*’|"[^"\r\n]*"|'[^'\r\n]*'`,
  ].join('|'), 'gimu');
  const prose = original.replace(
    protectedPattern,
    (part) => {
      const token = `${tokenPrefix}${protectedParts.length}\u0000`;
      protectedParts.push({ token, part });
      return token;
    }
  );
  let normalized = transform(prose);
  for (const { token, part } of protectedParts) normalized = normalized.replace(token, () => part);
  return normalized;
}

export function normalizeKannyangSpeech(text) {
  // Register and sentence wording belong to generation guidance. Keep this a
  // bounded cleanup, rather than guessing verb conjugations or appending 냥.
  return transformKannyangProse(text, (prose) => prose
    .replace(/(^|\n)\s*응냥\s*[,，.!?。！？]?\s*/g, '$1')
    .replace(/(^|\n)\s*응\s+냥\s*[,，.!?。！？]?\s*/g, '$1')
    .replace(/(^|\n)\s*응\s*[,，]\s*/g, '$1')
    .replace(/둘\s*거냐냥/g, '둘거냥')
    .replace(/둘\s*거\s*냥/g, '둘거냥')
    .replace(/인\s+것\s+같구나냥/g, '인 것 같아냥')
    .replace(/것\s+같구나냥/g, '것 같아냥')
    .replace(/보이구나냥/g, '보여냥')
    .replace(/있구나냥/g, '있네냥')
    // Do not append 냥 to polite endings; convert them to natural cat-speech endings.
    .replace(/이군요냥/g, '이네냥')
    .replace(/군요냥/g, '네냥')
    .replace(/이네요냥/g, '이네냥')
    .replace(/네요냥/g, '네냥')
    .replace(/이에요냥/g, '이야냥')
    .replace(/예요냥/g, '야냥')
    .replace(/입니다냥/g, '이다냥')
    .replace(/습니다냥/g, '다냥')
    .replace(/냐냥/g, '냥')
    .replace(/((?!냥)[가-힣])냥(?:[ \t]*냥)+(?=$|[\s.,!?。！？…~])/gu, '$1냥')
    .trim()) || '냥.';
}
