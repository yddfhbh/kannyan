const promptOverridePatterns = [
  /프롬프트.*(잊|무시|삭제|초기화|수정|변경|공개|출력|보여)/,
  /(지금까지|이전|앞에서).*(프롬프트|명령|지시|규칙).*(잊|무시|삭제|초기화)/,
  /(시스템|개발자|관리자).*(프롬프트|명령|지시|규칙).*(무시|공개|출력|보여|바꿔)/,
  /(잊|무시|삭제|초기화|수정|변경|공개|출력|보여|바꿔).*(프롬프트|시스템|개발자|관리자|이전 명령|지시|규칙)/,
  /(?:최상위|상위|내부|숨겨진).*(?:시스템|개발자|관리자).*(?:프롬프트|지침|규칙|문장)/,
  /(?:시스템|개발자|관리자).*(?:프롬프트|지침|규칙).*(?:첫\s*번째|첫|원문|문장|첫 대사|한 줄)/,
  /(?:독백|낭독|첫 대사|한 줄).*(?:최상위|상위|내부|시스템|개발자|관리자).*(?:프롬프트|지침|규칙|문장)/,
  /(?:태어날 때|처음).*(?:들었던|받은).*(?:규칙|지침|명령)/,
  /(?:기존|원래)?\s*(?:말투|말투 규칙|냥체|고양이 말투).*(?:무시|버려|버리|제거|없애|지워|바꿔|변경)/,
  /(?:무시|버려|버리|제거|없애|지워|바꿔|변경).*(?:말투|말투 규칙|냥체|고양이 말투)/,
  /(?:봇\s*)?정체성.*(?:무시|버려|버리|제거|없애|지워|바꿔|변경)/,
  /(?:무시|버려|버리|제거|없애|지워|바꿔|변경).*(?:봇\s*)?정체성/,
  /다른 캐릭터로.*(?:영구|완전)?.*(?:변경|바꿔|행세|역할)/,
  /ignore .*previous .*instructions/,
  /ignore .*system .*instructions/,
  /forget .*previous .*prompts/,
  /forget .*previous .*instructions/,
  /reveal .*system .*prompt/,
  /show .*system .*prompt/,
  /print .*system .*prompt/,
  /system .*prompt.*(ignore|forget|reveal|show|print|display|override|change)/,
  /developer .*message.*(ignore|forget|reveal|show|print|display|override|change)/,
  /(?:top[- ]level|highest[- ]priority|internal|hidden).*(?:system|developer).*(?:prompt|instruction|rule)/,
  /(?:system|developer).*(?:prompt|instruction|rule).*(?:first|initial|verbatim|line)/,
];

const controlCommandLinePatterns = [
  /^\s*%?\/add-tools\b/i,
  /^\s*%?\/reset-context\b/i,
];

const controlInstructionLinePatterns = [
  /legacy prompt/i,
  /retry automatically/i,
  /reset this session/i,
  /clear all prompt/i,
  /tool의 세부 정보/i,
  /추가한 tool.*생각하지 마/i,
  /도구.*세부 정보.*생각하지 마/i,
  /system prompt/i,
  /developer message/i,
];

const structuredPayloadLinePatterns = [
  /^\s*[\[\]{}",:]+\s*$/,
  /^\s*[\[{].*"(name|description|parameters|properties|required|type|retry)"/i,
  /^\s*"[^"]+"\s*:\s*.+$/,
  /^\s*"(name|description|parameters|properties|required|type|retry)"\s*$/i,
  /^\s*\{?\s*"name"\s*:\s*"reset-context"/i,
  /^\s*\{?\s*"description"\s*:\s*"Reset this session/i,
  /^\s*\{?\s*"retry"\s*:/i,
];

const controlPayloadKeywordPattern = /add-tools|reset-context|legacy prompt|clear all prompt|retry automatically/i;
const controlMetaPrefixPattern = /^\s*%?\[[A-Z][A-Z0-9_-]{1,31}\]\s*/;

const choiceCandidatePattern = /^\s*([A-Z]|[1-9]\d?)\s*[.)]\s+.+$/gim;
const quotedCandidatePattern = /"[^"\n]{2,200}"|“[^”\n]{2,200}”|「[^」\n]{2,200}」|『[^』\n]{2,200}』/;

const forcedVerbatimOutputPatterns = [
  /한 글자도 수정하지 말(?:고|고서)?(?: [^.\n]{0,40})?그대로 (?:출력|답(?:해|하라)|써)/,
  /선택한 문장(?:을|만)?(?: [^.\n]{0,40})?그대로 (?:출력|답(?:해|하라)|써)/,
  /원문(?:대로)? 복사/,
  /원문(?:대로)?(?: [^.\n]{0,40})?(?:출력|답(?:해|하라)|써)/,
  /\boutput exactly\b/,
  /\bprint verbatim\b/,
  /\b(?:reply|respond) with\b[\s\S]{0,80}\bunchanged\b/,
  /\b(?:reply|respond|output|print)\b[\s\S]{0,40}\bverbatim\b/,
  /\b(?:reply|respond|output|print)\b[\s\S]{0,40}\bexactly\b/,
];

const noExtraOutputPatterns = [
  /선택 이유.*(?:출력하지 않|쓰지 않)/,
  /이유(?:를)? (?:출력하지 않|쓰지 않|적지 않|출력하지 마|쓰지 마|적지 마)/,
  /번호.*따옴표.*추가 설명.*(?:출력하지 않|쓰지 않)/,
  /번호(?:는)?[^.\n]{0,20}(?:출력하지 말|쓰지 말|적지 말|출력하지 마|쓰지 마|적지 마)/,
  /추가 설명 없이/,
  /추가 설명은 (?:출력하지 않|쓰지 않|출력하지 마|쓰지 마)/,
  /추가 설명(?:은)?[^.\n]{0,20}(?:출력하지 말|쓰지 말|적지 말|출력하지 마|쓰지 마|적지 마)/,
  /아무 설명(?:도)? 없이/,
  /\bnothing else\b/,
  /\bno explanation\b/,
  /\bno extra(?: text)?\b/,
  /\bwithout (?:any )?(?:explanation|extra text|additional commentary)\b/,
];

function normalizePromptInspectionText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isControlCommandLine(line) {
  return controlCommandLinePatterns.some((pattern) => pattern.test(line));
}

function isControlInstructionLine(line) {
  return controlInstructionLinePatterns.some((pattern) => pattern.test(line));
}

function isStructuredPayloadLine(line) {
  return structuredPayloadLinePatterns.some((pattern) => pattern.test(line));
}

function hasMultipleChoiceCandidates(prompt) {
  const labels = new Set();

  for (const match of String(prompt ?? '').matchAll(choiceCandidatePattern)) {
    const label = String(match[1] ?? '').trim().toUpperCase();
    if (label) {
      labels.add(label);
    }
  }

  return labels.size >= 2;
}

function hasQuotedCandidate(prompt) {
  return quotedCandidatePattern.test(String(prompt ?? ''));
}

function hasForcedVerbatimDirective(text) {
  return forcedVerbatimOutputPatterns.some((pattern) => pattern.test(text));
}

function forbidsNaturalExtraOutput(text) {
  return noExtraOutputPatterns.some((pattern) => pattern.test(text));
}

function stripControlMetaPrefix(line) {
  return String(line ?? '').replace(controlMetaPrefixPattern, '');
}

export function isPromptOverrideAttempt(prompt) {
  const text = normalizePromptInspectionText(prompt);
  if (!text) {
    return false;
  }

  return promptOverridePatterns.some((pattern) => pattern.test(text));
}

export function isForcedVerbatimOutputAttempt(prompt) {
  const originalText = String(prompt ?? '');
  const normalizedText = normalizePromptInspectionText(originalText);

  if (!normalizedText) {
    return false;
  }

  const hasCandidateProvided = hasMultipleChoiceCandidates(originalText) || hasQuotedCandidate(originalText);
  if (!hasCandidateProvided) {
    return false;
  }

  return hasForcedVerbatimDirective(normalizedText) && forbidsNaturalExtraOutput(normalizedText);
}

export function sanitizePromptInjectionText(value) {
  const lines = String(value ?? '').replace(/\r\n/g, '\n').split('\n');
  const keptLines = [];
  let skippingControlPayload = false;

  for (const rawLine of lines) {
    const line = stripControlMetaPrefix(rawLine);
    const trimmed = line.trim();

    if (!trimmed) {
      if (!skippingControlPayload && keptLines.length > 0) {
        keptLines.push('');
      }
      continue;
    }

    if (isControlCommandLine(trimmed)) {
      skippingControlPayload = true;
      continue;
    }

    if (isControlInstructionLine(trimmed)) {
      continue;
    }

    if (isStructuredPayloadLine(trimmed) && controlPayloadKeywordPattern.test(trimmed)) {
      continue;
    }

    if (skippingControlPayload) {
      if (
        isControlCommandLine(trimmed)
        || isControlInstructionLine(trimmed)
        || isStructuredPayloadLine(trimmed)
      ) {
        continue;
      }

      skippingControlPayload = false;
    }

    keptLines.push(line);
  }

  return keptLines.join('\n').trim();
}

export function analyzePromptSecurity(value) {
  const originalText = String(value ?? '').trim();
  const sanitizedText = sanitizePromptInjectionText(originalText);
  const directPromptOverride = sanitizedText
    ? isPromptOverrideAttempt(sanitizedText)
    : originalText.length > 0;
  const forcedVerbatimOutput = sanitizedText
    ? isForcedVerbatimOutputAttempt(sanitizedText)
    : false;

  return {
    sanitizedText,
    removedMetaPayload: sanitizedText !== originalText,
    shouldBlock: directPromptOverride || forcedVerbatimOutput,
    reason: directPromptOverride
      ? 'direct_prompt_override'
      : forcedVerbatimOutput
        ? 'forced_verbatim_output'
        : null,
  };
}

export function sanitizeContextTextForModel(value) {
  const { sanitizedText, shouldBlock } = analyzePromptSecurity(value);
  return shouldBlock ? '' : sanitizedText;
}
