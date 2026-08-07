const imageGenerationRequestPattern =
  /^(?<prompt>[\s\S]*?)\s*(?:(?:그려(?:줘(?:요)?|주(?:세(?:요)?)?)?|그림(?:을|으로)?\s*(?:만들어|그려)?\s*(?:줘(?:요)?|주(?:세(?:요)?)?)?|이미지(?:로|를)?\s*(?:만들어|생성해)?\s*(?:줘(?:요)?|주(?:세(?:요)?)?)?))\s*[.!?~ㅋㅎ\-]*$/u;

const vagueImagePromptPattern =
  /^(?:이거|그거|저거|이걸|그걸|저걸|이거로|그거로|저거로|이렇게|그렇게|저렇게|그림|이미지|짤)$/u;

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
    return true;
  }

  if (vagueImagePromptPattern.test(text)) {
    return !hasContext;
  }

  if (text.length === 1) {
    return !hasContext;
  }

  return false;
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
