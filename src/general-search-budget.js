import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();
const limits = Object.freeze({ searches: 2, reads: 4, extractions: 1, durationMs: 30_000 });

export function withGeneralSearchBudget(work, options = {}) {
  const maxDurationMs = options.durationMs ?? limits.durationMs;
  const state = { searches: 0, reads: 0, extractions: 0,
    maxSearches: limits.searches, maxReads: limits.reads, maxExtractions: limits.extractions,
    deadline: Date.now() + maxDurationMs, controller: new AbortController() };
  const timer = setTimeout(() => state.controller.abort(), maxDurationMs);
  return storage.run(state, async () => {
    try { return await work(); }
    finally { clearTimeout(timer); state.controller.abort(); }
  });
}

export function generalSearchBudget() { return storage.getStore(); }

export function consumeGeneralSearchAttempt(type) {
  const state = generalSearchBudget();
  if (!state) return true;
  if (state.controller.signal.aborted) return false;
  const fields = { search: ['searches', 'maxSearches'], read: ['reads', 'maxReads'], extraction: ['extractions', 'maxExtractions'] };
  const [used, maximum] = fields[type] || [];
  if (!used || state[used] >= state[maximum]) return false;
  state[used] += 1;
  return true;
}

export function generalSearchSignal(signal) {
  const budgetSignal = generalSearchBudget()?.controller.signal;
  return budgetSignal && signal ? AbortSignal.any([budgetSignal, signal]) : budgetSignal || signal;
}

export async function withinGeneralSearchDeadline(work) {
  const signal = generalSearchBudget()?.controller.signal;
  if (!signal) return work();
  signal.throwIfAborted();
  let onAbort;
  const deadline = new Promise((_, reject) => {
    onAbort = () => reject(Object.assign(new Error('General search deadline exceeded'), { name: 'AbortError' }));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([work(), deadline]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

export function generalSearchBudgetSnapshot() {
  const state = generalSearchBudget();
  return state ? { searches: state.searches, reads: state.reads, extractions: state.extractions,
    remainingMs: Math.max(0, state.deadline - Date.now()), aborted: state.controller.signal.aborted } : null;
}
