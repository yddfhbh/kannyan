import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiInteractionMessage } from '../src/gemini-interaction.js';
import { createGeminiSessionKey } from '../src/gemini-memory.js';

function createInteraction() {
  const calls = [];
  const channel = {
    isThread: () => true,
    sendTyping: async () => {},
  };
  const interaction = {
    id: 'interaction-1',
    user: { id: 'user-1', username: 'user', globalName: 'User' },
    member: { displayName: 'User' },
    client: { user: { username: 'Bot' } },
    guild: { id: 'guild-1' },
    guildId: 'guild-1',
    channelId: 'thread-1',
    channel,
    editReply: async (payload) => calls.push(['editReply', payload]),
    followUp: async (payload) => calls.push(['followUp', payload]),
  };
  return { interaction, calls };
}

test('interaction adapter uses the same guild/channel/thread Gemini session key', async () => {
  const { interaction } = createInteraction();
  const slashMessage = createGeminiInteractionMessage(interaction, '안녕');
  const percentMessage = {
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    threadId: interaction.channelId,
    author: interaction.user,
  };

  assert.equal(
    createGeminiSessionKey(slashMessage),
    createGeminiSessionKey(percentMessage)
  );
  assert.equal(slashMessage.content, '%안녕');
});

test('interaction adapter sends the first result as editReply and later chunks as followUp', async () => {
  const { interaction, calls } = createInteraction();
  const message = createGeminiInteractionMessage(interaction, '질문');

  await message.reply({ content: '첫 답변' });
  await message.channel.send({ content: '두 번째 답변' });

  assert.deepEqual(calls.map(([method]) => method), ['editReply', 'followUp']);
});
