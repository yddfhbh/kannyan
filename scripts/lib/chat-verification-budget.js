import { classifyChatError as classifyVerificationError } from '../../src/chat-errors.js';
export { classifyChatError as classifyVerificationError } from '../../src/chat-errors.js';

export function createVerificationBudget(totalLimits, questionLimits) {
  const counts = { modelRequests: 0, httpRequests: 0 };
  let questionCounts, started, controller, reservation = { modelRequests: 0, httpRequests: 0 };
  const failures = [];
  let stages = {}, activeStage = '';
  const totalStarted = Date.now();
  const fail = (scope, resource, { record = true, abort = true } = {}) => {
    const error = Object.assign(new Error('Verification limit reached'), { code: `VERIFY_${scope}_${resource}_LIMIT` });
    if (record) failures.push(classifyVerificationError(error));
    if (abort) controller?.abort(error);
    throw error;
  };
  return {
    counts, failures,
    canConsume(model, { required = false } = {}) {
      return [['TOTAL', counts, totalLimits, totalStarted], ['QUESTION', questionCounts, questionLimits, started]].every(([, used, limits, since]) =>
        Date.now() - since < limits.durationMs
        && used.httpRequests < limits.httpRequests - (required ? 0 : reservation.httpRequests)
        && (!model || used.modelRequests < limits.modelRequests - (required ? 0 : reservation.modelRequests)));
    },
    retainStage(stage, count) {
      const released = Math.max(0, (stages[stage] || 0) - count);
      stages[stage] = Math.max(0, (stages[stage] || 0) - released);
      reservation.modelRequests -= released;
      reservation.httpRequests -= released;
    },
    setStage(stage) { activeStage = stage; },
    hasReservation(stage) { return (stages[stage] || 0) > 0; },
    get questionCounts() { return questionCounts; },
    get signal() { return controller.signal; },
    begin(required = {}) {
      questionCounts = { modelRequests: 0, httpRequests: 0 };
      stages = { ...(required.stages || {}) };
      const stageCount = Object.values(stages).reduce((sum, n) => sum + n, 0);
      reservation = {
        modelRequests: Math.max(0, Math.min(Number(required.modelRequests) || stageCount, questionLimits.modelRequests)),
        httpRequests: Math.max(0, Math.min(Number(required.httpRequests) || stageCount, questionLimits.httpRequests)),
      };
      started = Date.now(); controller = new AbortController(); failures.length = 0;
    },
    remaining() {
      return {
        modelRequests: Math.min(totalLimits.modelRequests - counts.modelRequests - reservation.modelRequests, questionLimits.modelRequests - (questionCounts?.modelRequests ?? 0), questionLimits.modelRequests - (questionCounts?.modelRequests ?? 0) - reservation.modelRequests),
        httpRequests: Math.min(totalLimits.httpRequests - counts.httpRequests - reservation.httpRequests, questionLimits.httpRequests - (questionCounts?.httpRequests ?? 0), questionLimits.httpRequests - (questionCounts?.httpRequests ?? 0) - reservation.httpRequests),
        reservedEvidenceRequests: stages['evidence-review'] || 0,
        reservedModelRequests: reservation.modelRequests,
        reservedHttpRequests: reservation.httpRequests,
        durationMs: Math.max(0, Math.min(totalLimits.durationMs - (Date.now() - totalStarted), questionLimits.durationMs - (Date.now() - (started ?? Date.now())))),
      };
    },
    consume(model, { required = false } = {}) {
      for (const [scope, used, limits, since] of [['TOTAL', counts, totalLimits, totalStarted], ['QUESTION', questionCounts, questionLimits, started]]) {
        if (Date.now() - since >= limits.durationMs) fail(scope, 'TIME');
        const reservedHttp = reservation.httpRequests;
        const reservedModel = reservation.modelRequests;
        if (!required && reservedHttp > 0 && used.httpRequests >= limits.httpRequests - reservedHttp) {
          fail(scope, 'HTTP_RESERVED', { record: false, abort: false });
        }
        if (!required && model && reservedModel > 0 && used.modelRequests >= limits.modelRequests - reservedModel) {
          fail(scope, 'MODEL_RESERVED', { record: false, abort: false });
        }
        if (used.httpRequests >= limits.httpRequests) fail(scope, 'HTTP');
        if (model && used.modelRequests >= limits.modelRequests) fail(scope, 'MODEL');
      }
      counts.httpRequests++; questionCounts.httpRequests++;
      if (model) { counts.modelRequests++; questionCounts.modelRequests++; }
      if (required) {
        if (stages[activeStage] > 0) stages[activeStage]--;
        if (reservation.httpRequests > 0) reservation.httpRequests--;
        if (model && reservation.modelRequests > 0) reservation.modelRequests--;
      }
    },
    expire() { fail('QUESTION', 'TIME'); },
  };
}
