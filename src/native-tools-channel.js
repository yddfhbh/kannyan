export function shouldUseNativeToolsForChannel(channelId, env = process.env) {
  if (String(env.GEMINI_NATIVE_TOOLS_ENABLED ?? '').toLowerCase() !== 'true') {
    return false;
  }

  const id = String(channelId ?? '');
  if (!/^\d{17,20}$/.test(id)) return false;

  if (String(env.GEMINI_NATIVE_TOOLS_ALL_CHANNELS ?? '').toLowerCase() === 'true') {
    return true;
  }

  const allowed = String(env.GEMINI_NATIVE_TOOLS_TEST_CHANNEL_ID ?? '').trim();
  return /^\d{17,20}$/.test(allowed) && id === allowed;
}
