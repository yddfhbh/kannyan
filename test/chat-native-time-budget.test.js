import test from 'node:test';
import assert from 'node:assert/strict';
import { runChatBudget, chatStageTimeout } from '../src/chat-time-budget.js';

test('native model has an extended but bounded request window', () => {
  runChatBudget(() => {
    const native = {
      [Symbol.for('chat.nativeDeadline')]: Date.now() + 35000,
    };
    assert.ok(chatStageTimeout(native) > 12000);
    assert.ok(chatStageTimeout(native) <= 18000);
    assert.ok(chatStageTimeout({}) <= 12000);
  });
});
