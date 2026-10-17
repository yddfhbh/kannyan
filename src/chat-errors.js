// Diagnostics contain only controlled categories/codes, never error messages,
// URLs, headers, response bodies or arbitrary provider fields.
export function classifyChatError(error) {
  const code = String(error?.code || error?.cause?.code || '');
  if (code === 'EVIDENCE_REVIEW_SCHEMA') return { category: 'schema', code, name: 'EvidenceReviewFormatError', message: 'Expected evidenceReviews array in model result', location: error.origin === 'generateGeminiAnswer' ? 'src/index.js:generateGeminiAnswer' : 'src/evidence-review.js:reviewSourceBodies', outputType: error.outputType };
  if (code === 'CHAT_STAGE_TIME_LIMIT') return { category: 'time-reservation', code, name: 'Error', message: 'Stage time reserved for completion', location: 'src/gemini-chat-request.js:requestChatWithFallback', remainingStageMs: error.remainingStageMs };
  if (/^VERIFY_(?:QUESTION|TOTAL)_(?:HTTP|MODEL|TIME|HTTP_RESERVED|MODEL_RESERVED)_LIMIT$/.test(code)) {
    return { category: code.endsWith('TIME_LIMIT') ? 'time-limit' : 'request-limit', code, resource: code.includes('_MODEL') ? 'model' : code.includes('_HTTP') ? 'http' : 'time', reserved: code.includes('_RESERVED_'), name: error.name, message: 'Verification limit reached', location: 'scripts/lib/chat-verification-budget.js:consume', stack: String(error.stack || '').split('\n').slice(1).filter(line => /chat-verification-budget\.js|requestGeminiGenerateContent|requestChatWithFallback/.test(line)).map(line => line.trim()) };
  }
  if (['AbortError', 'TimeoutError'].includes(error?.name) || /TIMEOUT|TIMEDOUT/.test(code)) return { category: 'timeout' };
  if (Number.isInteger(error?.status)) return { category: 'api', status: error.status };
  if (/^(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT)$/.test(code)) return { category: 'network', code };
  if (error?.name === 'TypeError' && /fetch|network/i.test(error.message || '')) return { category: 'network' };
  return { category: 'validator', code: 'UNCLASSIFIED_ERROR' };
}

