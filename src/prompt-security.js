const promptOverridePatterns = [
  /프롬프트.*(잊|무시|삭제|초기화|수정|변경|공개|출력|보여)/,
  /(지금까지|이전|앞에서).*(프롬프트|명령|지시|규칙).*(잊|무시|삭제|초기화)/,
  /(시스템|개발자|관리자).*(프롬프트|명령|지시|규칙).*(무시|공개|출력|보여|바꿔)/,
  /(잊|무시|삭제|초기화|수정|변경|공개|출력|보여|바꿔).*(프롬프트|시스템|개발자|관리자|이전 명령|지시|규칙)/,
  /ignore .*previous .*instructions/,
  /ignore .*system .*instructions/,
  /forget .*previous .*prompts/,
  /forget .*previous .*instructions/,
  /reveal .*system .*prompt/,
  /show .*system .*prompt/,
  /print .*system .*prompt/,
  /system .*prompt.*(ignore|forget|reveal|show|print|display|override|change)/,
  /developer .*message.*(ignore|forget|reveal|show|print|display|override|change)/,
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

export function isPromptOverrideAttempt(prompt) {
  const text = normalizePromptInspectionText(prompt);
  if (!text) {
    return false;
  }

  return promptOverridePatterns.some((pattern) => pattern.test(text));
}

export function sanitizePromptInjectionText(value) {
  const lines = String(value ?? '').replace(/\r\n/g, '\n').split('\n');
  const keptLines = [];
  let skippingControlPayload = false;

  for (const line of lines) {
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

  return {
    sanitizedText,
    removedMetaPayload: sanitizedText !== originalText,
    shouldBlock: sanitizedText
      ? isPromptOverrideAttempt(sanitizedText)
      : originalText.length > 0,
  };
}

export function sanitizeContextTextForModel(value) {
  const { sanitizedText, shouldBlock } = analyzePromptSecurity(value);
  return shouldBlock ? '' : sanitizedText;
}
