const percentImageRequestPattern =
  /^(?<prompt>[\s\S]*?)\s*(?:(?:그려|그림(?:을|으로)?\s*(?:만들어|그려)?|이미지(?:로|를)?\s*(?:만들어|생성해)?)\s*(?:줘(?:요)?|주세요|주라|줄래|봐(?:요)?)?)\s*[.!?~ㅋㅎ]*$/u;

export function parseImageGenerationRequestContent(content) {
  const text = String(content ?? '').trim();

  if (!text.startsWith('%')) {
    return null;
  }

  const body = text.slice(1).trim();
  const match = body.match(percentImageRequestPattern);
  if (!match) {
    return null;
  }

  return {
    prompt: String(match.groups?.prompt ?? '').trim(),
  };
}

export function parseImageGenerationRequest(message) {
  return parseImageGenerationRequestContent(message?.content ?? '');
}
