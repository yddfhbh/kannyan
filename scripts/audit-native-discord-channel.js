// Read-only Discord REST audit. Never starts a Gateway session or posts a message.
const channelId = process.argv[2];
if (!/^\d{17,20}$/.test(channelId ?? '') || channelId !== process.env.GEMINI_NATIVE_TOOLS_TEST_CHANNEL_ID) {
  throw new Error('Pass the explicitly configured GEMINI_NATIVE_TOOLS_TEST_CHANNEL_ID.');
}
const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error('DISCORD_TOKEN is required.');
const headers = { authorization: `Bot ${token}` };
async function get(path) {
  const response = await fetch(`https://discord.com/api/v10${path}`, { headers, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Discord REST HTTP ${response.status}`);
  return response.json();
}
const [self, channel, messages] = await Promise.all([
  get('/users/@me'), get(`/channels/${channelId}`), get(`/channels/${channelId}/messages?limit=50`),
]);
if (String(channel.id) !== channelId || ![0, 5, 10, 11, 12, 15].includes(channel.type)) throw new Error('Unexpected channel.');
const botMessages = messages.filter((message) => message.author?.id === self.id);
const userMessages = messages.filter((message) => !message.author?.bot);
console.log(JSON.stringify({ channelId, channelType: channel.type, botId: self.id,
  messageCount: messages.length, userMessageCount: userMessages.length, botMessageCount: botMessages.length,
  botReplies: botMessages.filter((message) => message.message_reference?.message_id).length,
  botAttachments: botMessages.reduce((sum, message) => sum + (message.attachments?.length ?? 0), 0),
  newestMessageAt: messages[0]?.timestamp ?? null }));
