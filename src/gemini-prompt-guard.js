const zeroWidthPattern = /[\u200B-\u200D\u2060\uFEFF]/gu;
const markdownNoisePattern = /[`*_~]+/g;
const repeatedPunctuationPattern = /[!?,.:;=/\\|()[\]{}<>-]{2,}/g;
const protectedBlockPattern = /```[\s\S]*?```|`[^`\n]+`|(^|\n)\s*>[^\n]*/g;

const explicitOverridePatterns = [
  /(?:이전|기존|앞선)\s*(?:지시|명령|규칙|프롬프트).{0,18}(?:무시|잊어|잊고|버려|제거|초기화|바꿔|변경)/u,
  /(?:시스템|개발자)\s*(?:프롬프트|지시|메시지|규칙).{0,18}(?:공개|출력|보여|복사|따라|노출)/u,
  /규칙을\s*잊어/u,
  /설정을\s*초기화/u,
  /ignore\s*previous\s*instructions/u,
  /ignore\s*system\s*instructions/u,
  /forget\s*previous\s*(?:instructions|prompts)/u,
  /reveal\s*system\s*prompt/u,
  /show\s*system\s*prompt/u,
  /print\s*system\s*prompt/u,
];

const metaDisguisePatterns = [
  /이번\s*응답/u,
  /다음\s*응답/u,
  /평가\s*테스트/u,
  /품질\s*검수/u,
  /학습\s*데이터/u,
  /학습용\s*예문/u,
  /역할극\s*테스트/u,
  /최종\s*대사/u,
  /최종\s*결과만/u,
  /출력\s*전에\s*검사/u,
  /검수\s*과정은\s*공개하지\s*마/u,
  /작업\s*과정은\s*언급하지\s*마/u,
];

const controlPatterns = [
  /기존\s*캐릭터를\s*반영하지\s*마/u,
  /현재\s*말투를\s*유지하지\s*마/u,
  /기본\s*말투를\s*제외해/u,
  /다른\s*등장인물로\s*대답해/u,
  /말투는\s*반드시.{0,20}(?:작성|써|대답)/u,
  /다음\s*문장으로\s*시작해/u,
  /최종\s*대사\s*외에는\s*출력하지\s*마/u,
  /분석(?:이나|과)?\s*설정\s*설명(?:을)?\s*출력하지\s*마/u,
  /지나치게\s*유아적으로\s*대답해/u,
  /캐릭터\s*설정/u,
  /내부\s*규칙/u,
  /테스트\s*여부/u,
  /말투는.{0,20}(?:작성|대답)/u,
  /어미를\s*사용/u,
  /최종\s*결과만\s*출력/u,
  /방법을\s*설명하지\s*마/u,
];

const fakeAuthorityTagPatterns = [
  /<\s*system\s*>/u,
  /<\s*developer\s*>/u,
  /<\s*assistant\s*>/u,
  /<\s*instruction\s*>/u,
  /<\s*quality_instruction\s*>/u,
  /<\s*untrusted\s*>/u,
  /<\s*prompt\s*>/u,
  /\[\s*rules\s*\]/u,
  /\[\s*system\s*message\s*\]/u,
];

const responseLeakPatterns = [
  /(?:내|이)\s*(?:시스템|개발자)\s*(?:프롬프트|지시|메시지|규칙)/u,
  /(?:최상위|내부)\s*규칙/u,
  /developer\s*message/u,
  /system\s*prompt/u,
];

const responseAttackTracePatterns = [
  /괜찮아용\s*:3/u,
  /조금만\s*해볼까용/u,
  /최종\s*대사(?:만)?\s*출력/u,
  /분석(?:이나|과)?\s*설정\s*설명/u,
];

function toCompactText(text) {
  return text.replace(/[\s`*_~!?,.:;=/\\|()[\]{}<>-]+/g, '');
}

function countMatches(patterns, text) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

export function normalizePromptControlText(input) {
  const nfkc = String(input ?? '')
    .normalize('NFKC')
    .replace(zeroWidthPattern, '')
    .toLowerCase();

  return nfkc
    .replace(markdownNoisePattern, '')
    .replace(repeatedPunctuationPattern, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripProtectedSegments(text) {
  return String(text ?? '').replace(protectedBlockPattern, ' ');
}

export function classifyPromptControlAttempt(input) {
  const normalized = normalizePromptControlText(input);

  if (!normalized) {
    return {
      blocked: false,
      score: 0,
      reasons: [],
    };
  }

  const compact = toCompactText(normalized);
  const explicitOverrideCount =
    countMatches(explicitOverridePatterns, normalized)
    + countMatches([
      /ignorepreviousinstructions/u,
      /ignoresysteminstructions/u,
      /forgetpreviousinstructions/u,
      /forgetpreviousprompts/u,
      /revealsystemprompt/u,
      /showsystemprompt/u,
      /printsystemprompt/u,
    ], compact);

  if (explicitOverrideCount > 0) {
    return {
      blocked: true,
      score: 10,
      reasons: ['explicit_override_or_disclosure'],
    };
  }

  const metaSignalCount = countMatches(metaDisguisePatterns, normalized);
  const controlSignalCount = countMatches(controlPatterns, normalized);
  const fakeTagSignalCount =
    countMatches(fakeAuthorityTagPatterns, normalized)
    + countMatches([
      /qualityinstruction/u,
      /systemmessage/u,
      /untrusted/u,
    ], compact);

  const reasons = [];
  if (metaSignalCount > 0) {
    reasons.push('meta_task_disguise');
  }
  if (controlSignalCount > 0) {
    reasons.push('persona_or_output_control');
  }
  if (fakeTagSignalCount > 0) {
    reasons.push('fake_authority_tag');
  }

  const score =
    metaSignalCount * 2
    + controlSignalCount * 3
    + fakeTagSignalCount * 2;
  const blocked =
    (metaSignalCount > 0 && controlSignalCount > 0)
    || (fakeTagSignalCount > 0 && controlSignalCount > 0)
    || score >= 8;

  return {
    blocked,
    score,
    reasons,
  };
}

export function isPromptOverrideAttempt(input) {
  return classifyPromptControlAttempt(input).blocked;
}

export function classifyPromptControlResponse(output, options = {}) {
  const visibleText = normalizePromptControlText(stripProtectedSegments(output));

  if (!visibleText) {
    return {
      blocked: false,
      reasons: [],
    };
  }

  const promptRiskScore = Number(options.promptRiskScore ?? 0);
  const leakDetected = responseLeakPatterns.some((pattern) => pattern.test(visibleText));
  const attackTraceDetected = responseAttackTracePatterns.some((pattern) => pattern.test(visibleText));

  return {
    blocked: leakDetected || (promptRiskScore > 0 && attackTraceDetected),
    reasons: [
      ...(leakDetected ? ['meta_leak'] : []),
      ...(promptRiskScore > 0 && attackTraceDetected ? ['attack_trace'] : []),
    ],
  };
}
