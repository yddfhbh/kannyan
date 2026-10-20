import { EmbedBuilder, MessageFlags, PermissionsBitField } from 'discord.js';
import { ChessAccountMonitor, describeStatus, formatKst, platformNames, profileUrl } from './chess-account-monitor.js';

export function createChessAccountMonitor(client, filePath, options = {}) {
  return new ChessAccountMonitor({
    filePath,
    ...options,
    sendAlert: options.sendAlert ?? (async (channelId, account, checkedAt) => {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased() || !channel.send) throw new Error('알림 채널에 메시지를 보낼 수 없습니다.');
      const embed = new EmbedBuilder()
        .setTitle('🔔 의심 유저 계정 상태 변경 감지')
        .setColor(0xed4245)
        .addFields(
          { name: '플랫폼', value: platformNames[account.platform], inline: true },
          { name: '닉네임', value: account.username, inline: true },
          { name: '확인된 상태', value: account.closedStatus },
          { name: '상태 설명', value: describeStatus(account.platform, account.closedStatus) },
          { name: '확인 시각', value: `${formatKst(checkedAt)} (KST)` },
          { name: '프로필', value: profileUrl(account.platform, account.username) },
        );
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    }),
  });
}

export async function handleChessAccountMonitorCommand(interaction, monitor) {
  const command = interaction.commandName;
  if (!['의심유저', '의심유저목록', '의심유저중지'].includes(command)) return false;
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 채널에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (command === '의심유저목록') {
    const accounts = await monitor.list(interaction.channelId);
    const lines = accounts.map((account) => {
      const owners = Object.values(account.channels[interaction.channelId].owners);
      return `${platformNames[account.platform]} / ${account.username}\n등록: ${formatKst(Math.min(...owners))} (KST) · 마지막 검사: ${account.lastCheckedAt ? `${formatKst(account.lastCheckedAt)} (KST)` : '없음'} · 상태: ${account.closedStatus ?? account.status}`;
    });
    const content = lines.length ? `🔎 현재 채널 감시 대상 (${lines.length}개)\n\n${lines.join('\n\n')}` : '현재 채널의 감시 대상이 없습니다.';
    await interaction.reply({ content: content.slice(0, 1900), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return true;
  }
  const platform = interaction.options.getString('플랫폼', true);
  const username = interaction.options.getString('닉네임', true);
  if (command === '의심유저중지') {
    const result = await monitor.remove({
      platform, username, channelId: interaction.channelId, userId: interaction.user.id,
      admin: interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ?? false,
    });
    const messages = { removed: '현재 채널의 감시를 종료했습니다.', missing: '현재 채널에서 해당 계정을 감시하고 있지 않습니다.', forbidden: '본인이 등록한 감시만 종료할 수 있습니다. 관리자는 채널의 감시를 종료할 수 있습니다.' };
    await interaction.reply({ content: messages[result], flags: MessageFlags.Ephemeral });
    return true;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await monitor.register({ platform, username, channelId: interaction.channelId, userId: interaction.user.id });
  let content;
  if (result.kind === 'registered') {
    content = `🔎 감시 대상 등록 완료\n플랫폼: ${platformNames[platform]}\n닉네임: ${result.account.username}\n검사 간격: 약 5분\n알림 채널: 현재 채널`;
  } else if (result.kind === 'duplicate') {
    content = '이미 이 채널에서 해당 계정을 감시하고 있습니다.';
  } else if (result.kind === 'closed') {
    content = `이미 확인된 계정 상태: ${result.status}\n${describeStatus(platform, result.status)}\n감시를 등록하지 않았습니다.`;
  } else {
    content = `계정 상태를 확인할 수 없어 감시를 등록하지 않았습니다. ${result.reason}`;
  }
  await interaction.editReply({ content, allowedMentions: { parse: [] } });
  return true;
}
