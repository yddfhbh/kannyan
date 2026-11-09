import { MessageFlags } from 'discord.js';
import { findTetrioAccount, findTetrioAccountById, findTetrioUsername, findTetrioUsernameByDiscordId } from './tetrio-card.js';

export const TETRIO_LINK_ADMIN_ID = '635107514471415808';

export function createTetrioAccountResolver({ store, findUsername = findTetrioUsername, findOfficial = findTetrioUsernameByDiscordId, findAccountById = findTetrioAccountById }) {
  return async ({ nickname, discordUserId }) => {
    if (String(nickname ?? '').trim()) return findUsername(nickname);
    const official = await findOfficial(discordUserId);
    // Errors must propagate: only a successful empty official search permits fallback.
    if (official !== null) return official;
    const manual = await store.getLink?.(discordUserId);
    if (manual?.id) return (await findAccountById(manual.id))?.username ?? manual.username;
    return manual?.username ?? store.getNickname(discordUserId);
  };
}

export async function handleTetrioLogin(interaction, { store, findUsername, findAccount }) {
  if (interaction.user.id !== TETRIO_LINK_ADMIN_ID) {
    await interaction.reply({ content: '이 명령어를 사용할 권한이 없다냥.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const user = interaction.options.getUser('유저', true);
    const lookup = findAccount ?? findUsername ?? findTetrioAccount;
    const account = await lookup(interaction.options.getString('닉네임', true).trim());
    const normalized = typeof account === 'string' ? { username: account, id: null } : account;
    if (!normalized?.username) {
      await interaction.editReply('그런 TETR.IO 유저는 없다냥.');
      return;
    }
    await (normalized.id ? store.setAccount(user.id, normalized) : store.setNickname(user.id, normalized.username));
    await interaction.editReply({ content: `등록 완료! <@${user.id}> → ${normalized.username}`, allowedMentions: { parse: [] } });
  } catch (error) {
    console.error('[TETRIO LINK] registration failed:', error);
    await interaction.editReply('TETR.IO 계정 확인 또는 저장에 실패했다냥. 잠시 뒤 다시 시도해달라냥.');
  }
}

export async function handleTetrioLoginUpdate(interaction, { store, findAccount = findTetrioAccount }) {
  if (interaction.user.id !== TETRIO_LINK_ADMIN_ID) {
    await interaction.reply({ content: '이 명령어를 사용할 권한이 없다냥.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const user = interaction.options.getUser('유저', true);
    const before = await store.getLink(user.id);
    if (!before) {
      await interaction.editReply('기존 TETR.IO 연동 정보가 없다냥. `/리오로그인`을 이용해달라냥.');
      return;
    }
    const account = await findAccount(interaction.options.getString('닉네임', true).trim());
    if (!account?.username) {
      await interaction.editReply('그런 TETR.IO 유저는 없다냥. 기존 연동 정보는 유지했다냥.');
      return;
    }
    await store.setAccount(user.id, account);
    await interaction.editReply({ content: `수정 완료! <@${user.id}>\nTETR.IO: ${before.username} → ${account.username}`, allowedMentions: { parse: [] } });
  } catch (error) {
    console.error('[TETRIO LINK] update failed:', error);
    const message = error?.code === 'TETRIO_LINK_DUPLICATE'
      ? '이미 다른 Discord 유저와 연동된 TETR.IO 계정이다냥.'
      : 'TETR.IO 계정 확인 또는 저장에 실패했다냥. 기존 연동 정보는 유지했다냥.';
    await interaction.editReply(message);
  }
}
