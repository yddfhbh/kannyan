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

test('native tools can be enabled in all channels explicitly', () => {
  const env = {
    GEMINI_NATIVE_TOOLS_ENABLED: 'true',
    GEMINI_NATIVE_TOOLS_TEST_CHANNEL_ID: '123456789012345678',
    GEMINI_NATIVE_TOOLS_ALL_CHANNELS: 'true',
  };

  assert.equal(shouldUseNativeToolsForChannel('123456789012345678', env), true);
  assert.equal(shouldUseNativeToolsForChannel('123456789012345679', env), true);
  assert.equal(shouldUseNativeToolsForChannel('not-a-channel', env), false);
  assert.equal(shouldUseNativeToolsForChannel(undefined, env), false);

  assert.equal(
    shouldUseNativeToolsForChannel('123456789012345679', {
      ...env,
      GEMINI_NATIVE_TOOLS_ALL_CHANNELS: 'false',
    }),
    false
  );

  assert.equal(
    shouldUseNativeToolsForChannel('123456789012345679', {
      ...env,
      GEMINI_NATIVE_TOOLS_ENABLED: 'false',
    }),
    false
  );
});
