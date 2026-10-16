import { MessageFlags } from 'discord.js';
import { findTetrioUsername, findTetrioUsernameByDiscordId } from './tetrio-card.js';

export const TETRIO_LINK_ADMIN_ID = '635107514471415808';

export function createTetrioAccountResolver({ store, findUsername = findTetrioUsername, findOfficial = findTetrioUsernameByDiscordId }) {
  return async ({ nickname, discordUserId }) => {
    if (String(nickname ?? '').trim()) return findUsername(nickname);
    const official = await findOfficial(discordUserId);
    // Errors must propagate: only a successful empty official search permits fallback.
    if (official !== null) return official;
    return store.getNickname(discordUserId);
  };
}

export async function handleTetrioLogin(interaction, { store, findUsername = findTetrioUsername }) {
  if (interaction.user.id !== TETRIO_LINK_ADMIN_ID) {
    await interaction.reply({ content: '이 명령어를 사용할 권한이 없다냥.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const user = interaction.options.getUser('유저', true);
    const nickname = await findUsername(interaction.options.getString('닉네임', true).trim());
    if (!nickname) {
      await interaction.editReply('그런 TETR.IO 유저는 없다냥.');
      return;
    }
    await store.setNickname(user.id, nickname);
    await interaction.editReply({ content: `등록 완료! <@${user.id}> → ${nickname}`, allowedMentions: { parse: [] } });
  } catch (error) {
    console.error('[TETRIO LINK] registration failed:', error);
    await interaction.editReply('TETR.IO 계정 확인 또는 저장에 실패했다냥. 잠시 뒤 다시 시도해달라냥.');
  }
}
