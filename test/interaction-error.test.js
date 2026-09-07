import test from 'node:test';
import assert from 'node:assert/strict';
import { respondToInteractionError } from '../src/interaction-error.js';

function createInteraction(overrides = {}) {
  const calls = { reply: [], editReply: [], followUp: [] };
  return {
    id: 'interaction-test-id',
    commandName: '테스트',
    type: 2,
    isRepliable: () => true,
    replied: false,
    deferred: false,
    reply: async (payload) => calls.reply.push(payload),
    editReply: async (payload) => calls.editReply.push(payload),
    followUp: async (payload) => calls.followUp.push(payload),
    calls,
    ...overrides,
  };
}

test('replies once when interaction has not been acknowledged', async () => {
  const interaction = createInteraction();

  await respondToInteractionError(interaction, new Error('internal detail'));

  assert.equal(interaction.calls.reply.length, 1);
  assert.equal(interaction.calls.editReply.length, 0);
});

test('edits the deferred reply and does not call reply', async () => {
  const interaction = createInteraction({ deferred: true });

  await respondToInteractionError(interaction, new Error('internal detail'));

  assert.equal(interaction.calls.editReply.length, 1);
  assert.equal(interaction.calls.reply.length, 0);
});

test('does not overwrite an already replied interaction', async () => {
  const interaction = createInteraction({ replied: true });

  await respondToInteractionError(interaction, new Error('late failure'));

  assert.equal(interaction.calls.reply.length, 0);
  assert.equal(interaction.calls.editReply.length, 0);
  assert.equal(interaction.calls.followUp.length, 0);
});

test('swallows Unknown interaction from editReply', async () => {
  const interaction = createInteraction({
    deferred: true,
    editReply: async () => {
      throw Object.assign(new Error('Unknown interaction'), { name: 'DiscordAPIError', code: 10062 });
    },
  });

  await assert.doesNotReject(() => respondToInteractionError(interaction, new Error('render failed')));
});

test('swallows already acknowledged error from reply', async () => {
  const interaction = createInteraction({
    reply: async () => {
      throw Object.assign(new Error('already acknowledged'), { name: 'DiscordAPIError', code: 40060 });
    },
  });

  await assert.doesNotReject(() => respondToInteractionError(interaction, new Error('handler failed')));
});

test('keeps the defer/edit success path unchanged', async () => {
  const interaction = createInteraction({
    deferred: true,
    editReply: async (payload) => interaction.calls.editReply.push(payload),
  });

  await interaction.editReply({ content: '성공 응답' });

  assert.deepEqual(interaction.calls.editReply, [{ content: '성공 응답' }]);
  assert.equal(interaction.calls.reply.length, 0);
});
