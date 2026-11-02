import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldUseNativeToolsForChannel } from '../src/native-tools-channel.js';

test('native tools are limited to the explicitly configured test channel', () => {
  const enabled = { GEMINI_NATIVE_TOOLS_ENABLED: 'true', GEMINI_NATIVE_TOOLS_TEST_CHANNEL_ID: '123456789012345678' };
  assert.equal(shouldUseNativeToolsForChannel('123456789012345678', enabled), true);
  assert.equal(shouldUseNativeToolsForChannel('123456789012345679', enabled), false);
  assert.equal(shouldUseNativeToolsForChannel('123456789012345678', { GEMINI_NATIVE_TOOLS_ENABLED: 'true' }), false);
  assert.equal(shouldUseNativeToolsForChannel('123456789012345678', { ...enabled, GEMINI_NATIVE_TOOLS_TEST_CHANNEL_ID: 'not-a-channel' }), false);
  assert.equal(shouldUseNativeToolsForChannel('123456789012345678', { ...enabled, GEMINI_NATIVE_TOOLS_TEST_CHANNEL_ID: '123456789012345678,123456789012345679' }), false);
  assert.equal(shouldUseNativeToolsForChannel('123456789012345678', { ...enabled, GEMINI_NATIVE_TOOLS_ENABLED: 'false' }), false);
});
