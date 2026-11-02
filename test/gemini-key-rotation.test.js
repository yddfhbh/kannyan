import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiKeyRotation } from '../src/gemini-key-rotation.js';
import { requestChatWithFallback } from '../src/gemini-chat-request.js';

test('four keys rotate in a stable cycle', () => {
  const r = createGeminiKeyRotation(['a', 'b', 'c', 'd']);
  const first = Array.from({ length: 8 }, () => r.nextKeys()[0]);
  assert.deepEqual(first, ['a','b','c','d','a','b','c','d']);
});

test('rotated requests keep their original key number', async () => {
  const r = createGeminiKeyRotation(['a','b','c','d']);
  r.nextKeys();
  const response = await requestChatWithFallback({}, {
    models: ['mock'],
    keys: r.nextKeys(),
    keyLabel: key => r.label(key),
    request: async () => ({ modelVersion: 'mock' }),
  });
  assert.equal(response._requestMeta.keyLabel, 'key#2');
});

test('quota failure can switch to another key', async () => {
  const r = createGeminiKeyRotation(['a','b','c','d']);
  const attempted = [];
  const response = await requestChatWithFallback({}, {
    models: ['mock'],
    keys: r.nextKeys(),
    keyLabel: key => r.label(key),
    request: async (_model, _payload, key) => {
      attempted.push(key);
      if (key === 'a')
        throw Object.assign(new Error('quota'), { status: 429 });
      return { modelVersion: 'mock' };
    },
  });
  assert.deepEqual(attempted, ['a','b']);
  assert.equal(response._requestMeta.keyLabel, 'key#2');
});
