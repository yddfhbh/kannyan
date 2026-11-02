export function shouldUseNativeToolsForChannel(channelId, env = process.env) {
  const allowed = String(env.GEMINI_NATIVE_TOOLS_TEST_CHANNEL_ID ?? '').trim();
  return String(env.GEMINI_NATIVE_TOOLS_ENABLED ?? '').toLowerCase() === 'true'
    && /^\d{17,20}$/.test(allowed) && String(channelId ?? '') === allowed;
}
