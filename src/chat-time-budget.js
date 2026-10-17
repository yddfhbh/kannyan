import { AsyncLocalStorage } from 'node:async_hooks';
const scope = new AsyncLocalStorage();
// Reserve time for delivery; optional evidence work must leave room for completion.
export function startChatBudget(durationMs = 38_000) {
  scope.enterWith({ deadline: Date.now() + durationMs });
}
export function chatTimeRemaining() {
  return Math.max(0, (scope.getStore()?.deadline ?? Infinity) - Date.now());
}
export function chatStageTimeout(payload) {
  if (!scope.getStore()) return Infinity;
  const properties = payload?.generationConfig?.responseSchema?.properties;
  const finalReview = payload?.[Symbol.for('chat.finalVerification')] === true;
  const reserve = properties?.sourcePlan ? 24_000 : properties?.evidenceReviews && !finalReview ? 16_000 : properties?.evidenceReviews ? 500 : 9000;
  return Math.max(1, Math.min(properties?.sourcePlan ? 10_000 : 12_000, chatTimeRemaining() - reserve));
}
export function canCollectEvidence(costMs = 0) {
  return chatTimeRemaining() > 14_000 + costMs;
}
