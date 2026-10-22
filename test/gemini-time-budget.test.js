import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { runChatBudget, chatStageTimeout } from '../src/chat-time-budget.js';
import { requestChatWithFallback, classifyChatRequestError } from '../src/gemini-chat-request.js';
import { source, declaration } from '../scripts/lib/chat-verification-runtime.js';

const payload = () => ({ generationConfig: { responseSchema: { properties: {} } } });

test('a stage with only a few milliseconds left is rejected before fetch', async () => {
  let calls = 0;
  await runChatBudget(async () => {
    assert.ok(chatStageTimeout(payload()) < 10);
    await assert.rejects(requestChatWithFallback(payload(), {
      models: ['primary'], keys: ['key'], request: async () => { calls += 1; },
    }), (error) => error.code === 'CHAT_STAGE_TIME_LIMIT' && error.remainingStageMs < 10);
  }, 9_001);
  assert.equal(calls, 0);
});
test('an exhausted budget does not retry after an earlier network timeout', async () => {
  let calls = 0;
  await runChatBudget(async () => {
    await assert.rejects(requestChatWithFallback(payload(), {
      models: ['primary', 'fallback'], keys: ['key'], maxAttempts: 3,
      request: async () => {
        calls += 1;
        const error = new Error('socket timed out');
        error.name = 'TimeoutError';
        throw error;
      },
      sleep: async () => {},
    }), (error) => error.code === 'CHAT_STAGE_TIME_LIMIT');
  }, 9_001);
  assert.equal(calls, 0);
});

test('concurrent chat budgets remain independent', async () => {
  const slow = runChatBudget(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return chatStageTimeout(payload());
  }, 9_100);
  const fresh = runChatBudget(async () => chatStageTimeout(payload()), 38_000);
  const [slowRemaining, freshRemaining] = await Promise.all([slow, fresh]);
  assert.ok(slowRemaining < 200);
  assert.ok(freshRemaining > 1_000);
});

function requestTransport({ timeoutMs = 5, fetchImpl }) {
  const context = vm.createContext({
    chatStageTimeout, AbortController, setTimeout, clearTimeout,
    geminiRequestTimeoutMs: timeoutMs, geminiApiBaseUrl: 'https://api.test',
    fetch: fetchImpl,
  });
  vm.runInContext(declaration('requestGeminiGenerateContent'), context);
  return context.requestGeminiGenerateContent;
}

test('a real request timeout is classified separately and can fall back', async () => {
  const request = requestTransport({
    fetchImpl: (_url, options) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted by timeout');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  });
  const timeout = await assert.rejects(request('primary', {}, 'key'), (error) => error.name === 'TimeoutError' && error.code === 'GEMINI_NETWORK_TIMEOUT');
  assert.equal(timeout, undefined);
  assert.equal(classifyChatRequestError(Object.assign(new Error(), { name: 'TimeoutError' })), 'model');

  let attempts = 0;
  const result = await requestChatWithFallback({}, {
    models: ['primary', 'fallback'], keys: ['key'], request: async (model) => {
      attempts += 1;
      if (model === 'primary') throw Object.assign(new Error(), { name: 'TimeoutError' });
      return { modelVersion: 'fallback-ok' };
    },
  });
  assert.equal(attempts, 2);
  assert.equal(result._requestMeta.model, 'fallback');
});

test('API-key rotation remains intact for key errors', async () => {
  const calls = [];
  const result = await requestChatWithFallback({}, {
    models: ['primary'], keys: ['bad', 'good'], request: async (_model, _payload, key) => {
      calls.push(key);
      if (key === 'bad') throw Object.assign(new Error(), { status: 401 });
      return {};
    },
  });
  assert.deepEqual(calls, ['bad', 'good']);
  assert.equal(result._requestMeta.keyLabel, 'key#2');
});
