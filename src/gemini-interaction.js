function createEmptyCollection() {
  return new Map();
}

export function createGeminiInteractionMessage(interaction, question, imageAttachment = null) {
  let hasReplied = false;
  const interactionChannel = interaction.channel;
  const channel = {
    id: interaction.channelId,
    isThread: () => Boolean(interactionChannel?.isThread?.()),
    sendTyping: (...args) => interactionChannel?.sendTyping?.(...args),
    send: (payload) => interaction.followUp(payload),
  };

  return {
    content: `%${String(question ?? '').trim()}`,
    author: interaction.user,
    member: interaction.member,
    client: interaction.client,
    guild: interaction.guild,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    channel,
    attachments: imageAttachment ? new Map([[imageAttachment.id ?? 'image', imageAttachment]]) : new Map(),
    mentions: {
      users: createEmptyCollection(),
      members: createEmptyCollection(),
      roles: createEmptyCollection(),
      channels: createEmptyCollection(),
    },
    reference: null,
    reply: (payload) => {
      if (!hasReplied) {
        hasReplied = true;
        return interaction.editReply(payload);
      }

      return interaction.followUp(payload);
    },
  };
}
