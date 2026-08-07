const imageGenerationRequestPattern =
  /^(?<prompt>[\s\S]*?)\s*(?:그려(?:줘|주라|줄래|주세요)?|그림(?:으로)?\s*(?:만들어|생성해)?(?:줘|주라|줄래|주세요)?|이미지(?:로)?\s*(?:만들어|생성해)?(?:줘|주라|줄래|주세요)?|이미지\s*생성(?:해)?(?:줘|해줘)?|그림\s*생성(?:해)?(?:줘|해줘)?)\s*[.!?~\-_]*$/u;

const vagueImagePromptPattern =
  /^(?:그거|그걸|그거로|그걸로|이거|이걸|이거로|이걸로|저거|저걸|저거로|저걸로|이렇게|저렇게|그렇게|그림|이미지|사진)$/u;

const imagePromptContextLabelPatterns = [
  /\[현재 질문\]\s*([\s\S]+)$/u,
  /\[현재 요청\]\s*([\s\S]+)$/u,
  /현재 요청:\s*([\s\S]+)$/u,
  /\[latest request\]\s*([\s\S]+)$/iu,
];

const imagePromptNoisePattern =
  /(?:ㅋㅋ+|ㅎㅎ+|하하+|헤헤+|호호+|lol+|lmao+|pls|please)/giu;

const imagePromptFillerPattern =
  /(?:그냥|바로|좀만|조금만|좀|제발|알아서|대충|일단|이제|이번엔|바로바로|그거|그걸로|그거로|이거|이걸로|이거로|이렇게|저렇게|그렇게|그려|그림|이미지|사진|생성|만들어|해줘|해주라|해줘봐|부탁|물어보지\s*말고|묻지\s*말고|말고|그대로|곧바로|냅다)/gu;

function normalizeImageGenerationText(value) {
  return String(value ?? '').trim();
}

function truncateImageGenerationText(value, maxLength) {
  const text = normalizeImageGenerationText(value);
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 20)).trim()}... [truncated]`;
}

function extractStructuredImagePromptCandidate(value) {
  const text = normalizeImageGenerationText(value);
  if (!text) {
    return '';
  }

  for (const pattern of imagePromptContextLabelPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return normalizeImageGenerationText(match[1]);
    }
  }

  return text;
}

function isMeaningfulImagePromptText(value) {
  const text = normalizeImageGenerationText(value);
  if (!text) {
    return false;
  }

  if (vagueImagePromptPattern.test(text) || text.length === 1) {
    return false;
  }

  const deNoised = text
    .replace(imagePromptNoisePattern, ' ')
    .replace(imagePromptFillerPattern, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '');

  return deNoised.length >= 2;
}

function extractMeaningfulImagePromptCandidate(value) {
  const structuredCandidate = extractStructuredImagePromptCandidate(value);
  if (!structuredCandidate) {
    return '';
  }

  const extractedPrompt = extractImageGenerationPromptText(structuredCandidate);
  const candidate = extractedPrompt === null
    ? structuredCandidate.replace(/^%+/, '').trim()
    : extractedPrompt;

  return isMeaningfulImagePromptText(candidate) ? candidate : '';
}

export function extractImageGenerationPromptText(content) {
  const text = normalizeImageGenerationText(content);
  if (!text) {
    return null;
  }

  const match = text.match(imageGenerationRequestPattern);
  if (!match) {
    return null;
  }

  return normalizeImageGenerationText(match.groups?.prompt ?? '');
}

export function parseImageGenerationRequestContent(content) {
  const text = normalizeImageGenerationText(content);

  if (!text.startsWith('%')) {
    return null;
  }

  const body = normalizeImageGenerationText(text.slice(1));
  const prompt = extractImageGenerationPromptText(body);
  if (prompt === null) {
    return null;
  }

  return { prompt };
}

export function parseImageGenerationRequest(message) {
  return parseImageGenerationRequestContent(message?.content ?? '');
}

export function shouldClarifyImageGenerationPrompt(prompt, options = {}) {
  const text = normalizeImageGenerationText(prompt);
  const replyContext = normalizeImageGenerationText(options.replyContext);
  const history = Array.isArray(options.history)
    ? options.history
        .map((entry) => normalizeImageGenerationText(entry?.text))
        .filter(Boolean)
    : [];
  const hasContext = Boolean(replyContext) || history.length > 0;

  if (!text) {
    return !hasContext;
  }

  if (vagueImagePromptPattern.test(text)) {
    return !hasContext;
  }

  if (text.length === 1) {
    return !hasContext;
  }

  return false;
}

export function inferImageGenerationPromptFromContext(prompt, options = {}) {
  if (isMeaningfulImagePromptText(prompt)) {
    return normalizeImageGenerationText(prompt);
  }

  const replyCandidate = extractMeaningfulImagePromptCandidate(options.replyContext);
  if (replyCandidate) {
    return replyCandidate;
  }

  const history = Array.isArray(options.history)
    ? [...options.history].reverse()
    : [];

  for (const entry of history) {
    if (entry?.role === 'model') {
      continue;
    }

    const candidate = extractMeaningfulImagePromptCandidate(entry?.text);
    if (candidate) {
      return candidate;
    }
  }

  return '';
}

export function buildImageGenerationPrompt(prompt, options = {}) {
  const primaryPrompt = truncateImageGenerationText(prompt, 220);
  const replyContext = truncateImageGenerationText(options.replyContext, 260);
  const recentHistory = Array.isArray(options.history)
    ? options.history
        .map((entry) => {
          const authorName = truncateImageGenerationText(entry?.authorName ?? '', 40);
          const text = truncateImageGenerationText(entry?.text ?? '', 140);
          if (!text) {
            return '';
          }

          return authorName ? `${authorName}: ${text}` : text;
        })
        .filter(Boolean)
        .slice(-4)
    : [];

  return [
    'Create a single coherent image based on the latest user request.',
    `Latest request: ${primaryPrompt || 'Use the conversation context to infer the subject.'}`,
    replyContext ? `Reply context: ${replyContext}` : '',
    recentHistory.length > 0
      ? `Recent conversation:\n${recentHistory.map((line) => `- ${line}`).join('\n')}`
      : '',
    'Resolve words like "this", "that", or omitted subjects from the context above when possible.',
    'Keep the image focused on the requested subject and do not replace it with an unrelated landscape or street scene.',
    'If the user did not specify a style, make it a clean, appealing digital illustration.',
    'No text, logo, watermark, interface, or caption.',
  ].filter(Boolean).join('\n');
}
