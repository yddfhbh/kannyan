const DEFAULT_MODEL = '@cf/black-forest-labs/flux-1-schnell';
const MAX_PROMPT_LENGTH = 800;
const REQUEST_TIMEOUT_MS = 90_000;

export async function generateCloudflareImage(prompt) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_AI_API_TOKEN?.trim();
  const model =
    process.env.CLOUDFLARE_IMAGE_MODEL?.trim() || DEFAULT_MODEL;

  if (!accountId || !apiToken) {
    throw new Error(
      'CLOUDFLARE_ACCOUNT_ID 또는 CLOUDFLARE_AI_API_TOKEN이 설정되지 않았습니다.'
    );
  }

  const normalizedPrompt = String(prompt ?? '').trim();

  if (!normalizedPrompt) {
    throw new Error('이미지 설명이 비어 있습니다.');
  }

  if (normalizedPrompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`이미지 설명은 ${MAX_PROMPT_LENGTH}자 이하여야 합니다.`);
  }

  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/`
    + `${accountId}/ai/run/${model}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: normalizedPrompt,
      steps: 4,
      seed: Math.floor(Math.random() * 2_147_483_647),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorBody = await response.text();

    throw new Error(
      `Cloudflare 이미지 생성 실패: HTTP ${response.status} `
      + errorBody.slice(0, 300)
    );
  }

  const contentType = response.headers.get('content-type') ?? '';

  // 일부 이미지 모델은 이미지 바이너리를 바로 반환한다.
  if (contentType.startsWith('image/')) {
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType,
    };
  }

  // FLUX.1-schnell REST 응답은 일반적으로 Base64 이미지를 반환한다.
  const data = await response.json();
  const base64Image = data?.result?.image ?? data?.image;

  if (typeof base64Image !== 'string' || !base64Image) {
    throw new Error(
      `Cloudflare 응답에서 이미지를 찾지 못했습니다: `
      + JSON.stringify(data).slice(0, 300)
    );
  }

  return {
    buffer: Buffer.from(base64Image, 'base64'),
    contentType: 'image/jpeg',
  };
}