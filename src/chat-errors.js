// Diagnostics contain only controlled categories/codes, never error messages,
// URLs, headers, response bodies or arbitrary provider fields.
export function classifyChatError(error) {
  const code = String(error?.code || error?.cause?.code || '');
  if (/^VERIFY_(?:QUESTION|TOTAL)_(?:HTTP|MODEL|TIME)_LIMIT$/.test(code)) {
    return { category: code.endsWith('TIME_LIMIT') ? 'time-limit' : 'request-limit', code };
  }
  if (['AbortError', 'TimeoutError'].includes(error?.name) || /TIMEOUT|TIMEDOUT/.test(code)) return { category: 'timeout' };
  if (Number.isInteger(error?.status)) return { category: 'api', status: error.status };
  if (/^(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT)$/.test(code)) return { category: 'network', code };
  if (error?.name === 'TypeError' && /fetch|network/i.test(error.message || '')) return { category: 'network' };
  return { category: 'validator', code: 'UNCLASSIFIED_ERROR' };
}

