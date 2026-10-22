import { chatStageTimeout } from './chat-time-budget.js';
export function classifyChatRequestError(error) {
  if (/^(?:VERIFY_|CHAT_STAGE_TIME_LIMIT|GEMINI_STAGE_TIMEOUT)/.test(error?.code || '')) return 'budget';
  const reasons = (error?.details?.details ?? []).map((d) => d.reason ?? '').join(' ');
  if ([401, 403].includes(error?.status) || (error?.status === 400 && /API_KEY_INVALID|API_KEY_EXPIRED/.test(reasons))) return 'key';
  if (error?.status === 400 && /(?:responseMimeType|responseSchema|systemInstruction|response_schema|JSON mode).*(?:unsupported|not supported)|(?:unsupported|not supported).*(?:responseMimeType|responseSchema|systemInstruction|JSON)/i.test(error.message ?? '')) return 'model';
  if (error?.status === 429) return 'quota';
  if ([404, 500, 502, 503, 504].includes(error?.status) || ['AbortError', 'TimeoutError'].includes(error?.name)) return 'model';
  // An invalid payload cannot be repaired by changing API keys.
  return 'request';
}

// Chat-only policy: try another key for the SAME model before lowering quality.
// Every attempt receives the exact same payload (including images and evidence).
export async function requestChatWithFallback(payload, options) {
  const { models, keys, request, maxAttempts = 2, canAttempt, sleep = () => Promise.resolve(), log = () => {} } = options;
  let lastError;
  for (const model of models) {
    let modelFailure = false;
    let quotaFailure = false;
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (lastError && canAttempt && !canAttempt(payload)) throw lastError;
        const remainingStageMs = chatStageTimeout(payload);
        if (remainingStageMs < 1500) throw Object.assign(new Error('Stage time reserved for completion'), { code: 'CHAT_STAGE_TIME_LIMIT', remainingStageMs, cause: lastError });
        try {
          const response = await request(model, payload, keys[keyIndex]);
          const responseModel = response.modelVersion || null;
          response._requestMeta = { ...(response._requestMeta ?? {}), model, responseModel, keyLabel: `key#${keyIndex + 1}`, attempt };
          log(`success model=${model} responseModel=${responseModel ?? 'unreported'} key#${keyIndex + 1} attempt=${attempt}`);
          return response;
        } catch (error) {
          lastError = error;
          const action = classifyChatRequestError(error);
          log(`failed model=${model} key#${keyIndex + 1} status=${error.status ?? error.name} action=${action}`);
          if (action === 'request' || action === 'budget') throw error;
          if (action === 'quota') quotaFailure = true;
          if (action === 'key' || action === 'quota') break;
          modelFailure = true;
          if ([400, 404].includes(error.status) || (models.length > 1 && (error.status === 503 || ['AbortError', 'TimeoutError'].includes(error.name))) || attempt === maxAttempts) break;
          if (canAttempt && !canAttempt(payload)) throw error;
          await sleep(Math.min(4000, 600 * (2 ** (attempt - 1))));
        }
      }
      // Key changes do not fix a missing model or an overloaded model server.
      if (modelFailure) break;
    }
    if (!modelFailure && !quotaFailure && classifyChatRequestError(lastError) === 'key') throw lastError;
  }
  throw lastError ?? new Error('No chat API keys configured.');
}
