import { classifyChatError as classifyVerificationError } from '../../src/chat-errors.js';
export { classifyChatError as classifyVerificationError } from '../../src/chat-errors.js';

export function createVerificationBudget(totalLimits, questionLimits) {
  const counts = { modelRequests: 0, httpRequests: 0 };
  let questionCounts, started, controller;
  const failures = [];
  const totalStarted = Date.now();
  const fail = (scope, resource) => {
    const error = Object.assign(new Error('Verification limit reached'), { code: `VERIFY_${scope}_${resource}_LIMIT` });
    failures.push(classifyVerificationError(error));
    controller?.abort(error);
    throw error;
  };
  return {
    counts, failures,
    get questionCounts() { return questionCounts; },
    get signal() { return controller.signal; },
    begin() { questionCounts = { modelRequests: 0, httpRequests: 0 }; started = Date.now(); controller = new AbortController(); failures.length = 0; },
    remaining() {
      return {
        modelRequests: Math.min(totalLimits.modelRequests - counts.modelRequests, questionLimits.modelRequests - (questionCounts?.modelRequests ?? 0)),
        httpRequests: Math.min(totalLimits.httpRequests - counts.httpRequests, questionLimits.httpRequests - (questionCounts?.httpRequests ?? 0)),
        durationMs: Math.max(0, Math.min(totalLimits.durationMs - (Date.now() - totalStarted), questionLimits.durationMs - (Date.now() - (started ?? Date.now())))),
      };
    },
    consume(model) {
      for (const [scope, used, limits, since] of [['TOTAL', counts, totalLimits, totalStarted], ['QUESTION', questionCounts, questionLimits, started]]) {
        if (Date.now() - since >= limits.durationMs) fail(scope, 'TIME');
        if (used.httpRequests >= limits.httpRequests) fail(scope, 'HTTP');
        if (model && used.modelRequests >= limits.modelRequests) fail(scope, 'MODEL');
      }
      counts.httpRequests++; questionCounts.httpRequests++;
      if (model) { counts.modelRequests++; questionCounts.modelRequests++; }
    },
    expire() { fail('QUESTION', 'TIME'); },
  };
}
