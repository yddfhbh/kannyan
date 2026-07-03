import crypto from 'node:crypto';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { renderStarforceCard } from './starforce-card.js';
import {
  createStarforceSessionState,
  parseStarforceLevelInput,
  performStarforceAttempt,
  recoverStarforceSessionState,
  STARFORCE_SUPPORTED_LEVELS,
} from './starforce-simulator.js';

const STARFORCE_CUSTOM_ID_PREFIX = 'starforce';
const STARFORCE_SESSION_TTL_MS = 20 * 60 * 1000;
const STARFORCE_SESSION_CLEANUP_INTERVAL_MS = 60 * 1000;
const STARFORCE_SESSION_GRACE_MS = 60 * 60 * 1000;
const STARFORCE_USAGE_MESSAGE = [
  '사용법:',
  '%스타포스 <장비레벨>',
  '/스타포스 장비레벨:<장비레벨>',
  '예시: %스타포스 160',
].join('\n');
const STARFORCE_UNSUPPORTED_LEVEL_MESSAGE =
  `지원하는 장비 레벨: ${STARFORCE_SUPPORTED_LEVELS.join(', ')}`;

const starforceSessions = new Map();

let cleanupTimer = null;

export function initStarforceCommand() {
  if (cleanupTimer) {
    return;
  }

  cleanupTimer = setInterval(() => {
    pruneStarforceSessions();
  }, STARFORCE_SESSION_CLEANUP_INTERVAL_MS);

  cleanupTimer.unref?.();
}

export async function handleStarforcePercentCommandMessage(message, input) {
  const parsed = parseStarforceLevelInput(input);

  if (!parsed.ok) {
    await message.reply({
      content: parsed.error === 'unsupported_level'
        ? STARFORCE_UNSUPPORTED_LEVEL_MESSAGE
        : STARFORCE_USAGE_MESSAGE,
      allowedMentions: { repliedUser: false },
    });
    return true;
  }

  const now = Date.now();
  const session = createStarforceSessionState({
    sessionId: crypto.randomUUID(),
    ownerUserId: message.author.id,
    level: parsed.level,
    now,
  });

  touchStarforceSession(session, now);
  starforceSessions.set(session.sessionId, session);

  const sentMessage = await message.reply({
    ...(await buildStarforceMessagePayload(session)),
    allowedMentions: { repliedUser: false, parse: [] },
  });

  session.channelId = sentMessage.channelId;
  session.messageId = sentMessage.id;
  return true;
}

export async function handleStarforceSlashCommand(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== '스타포스') {
    return false;
  }

  const level = interaction.options.getInteger('장비레벨', true);
  const parsed = parseStarforceLevelInput(String(level));

  if (!parsed.ok) {
    await interaction.reply({
      content: parsed.error === 'unsupported_level'
        ? STARFORCE_UNSUPPORTED_LEVEL_MESSAGE
        : STARFORCE_USAGE_MESSAGE,
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const now = Date.now();
  const session = createStarforceSessionState({
    sessionId: crypto.randomUUID(),
    ownerUserId: interaction.user.id,
    level: parsed.level,
    now,
  });

  touchStarforceSession(session, now);
  starforceSessions.set(session.sessionId, session);

  await interaction.reply({
    ...(await buildStarforceMessagePayload(session)),
    allowedMentions: { parse: [] },
  });

  const sentMessage = await interaction.fetchReply();
  session.channelId = interaction.channelId;
  session.messageId = sentMessage.id;
  return true;
}

export async function handleStarforceComponentInteraction(interaction) {
  if (!interaction.isButton()) {
    return false;
  }

  const parsed = parseStarforceCustomId(interaction.customId);
  if (!parsed) {
    return false;
  }

  const now = Date.now();
  const session = starforceSessions.get(parsed.sessionId);

  if (!session || isSessionExpired(session, now) || session.status === 'expired') {
    if (session) {
      session.status = 'expired';
      session.updatedAtMs = now;
      session.statusText = '세션 만료됨';
    }

    await interaction.reply({
      content: '이미 만료된 스타포스다냥.',
      flags: MessageFlags.Ephemeral,
    });

    await disableStarforceMessageFromInteraction(interaction, parsed.sessionId, session);
    if (session) {
      starforceSessions.delete(parsed.sessionId);
    }
    return true;
  }

  if (session.ownerUserId !== interaction.user.id) {
    await interaction.reply({
      content: '이 스타포스는 시작한 사람만 누를 수 있다냥.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  touchStarforceSession(session, now);

  if (parsed.action === 'enhance') {
    const attemptResult = performStarforceAttempt(session, { now });

    if (attemptResult.type === 'maxed') {
      await interaction.reply({
        content: attemptResult.log,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    await interaction.update(await buildStarforceMessagePayload(session));
    return true;
  }

  if (parsed.action === 'recover') {
    if (!session.pendingRecovery) {
      await interaction.reply({
        content: '지금은 복구할 장비가 없다냥.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    recoverStarforceSessionState(session, now);
    touchStarforceSession(session, now);
    await interaction.update(await buildStarforceMessagePayload(session));
    return true;
  }

  if (parsed.action === 'end') {
    session.status = 'ended';
    session.updatedAtMs = now;
    session.statusText = '세션 종료됨';

    await interaction.update(await buildStarforceMessagePayload(session, {
      disabled: true,
    }));
    return true;
  }

  await interaction.reply({
    content: '알 수 없는 스타포스 버튼이다냥.',
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function buildStarforceMessagePayload(session, options = {}) {
  const image = await renderStarforceCard(session);

  return {
    content: buildStarforceMessageContent(session),
    files: [
      new AttachmentBuilder(image, {
        name: `starforce-${session.sessionId}.png`,
      }),
    ],
    attachments: [],
    components: [
      buildStarforceButtonRow(session, {
        disabled: Boolean(options.disabled) || session.status === 'ended' || session.status === 'expired',
      }),
    ],
  };
}

function buildStarforceMessageContent(session) {
  const lines = [];

  if (session?.statusText) {
    lines.push(`상태: ${session.statusText}`);
  }

  if (session?.status === 'ended') {
    lines.push(`총 사용 메소: ${formatStarforceMesos(session?.mesoUsed ?? session?.totalMesos ?? 0)}`);
  }

  return lines.join('\n');
}

function formatStarforceMesos(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '0';
  }

  return Math.trunc(number).toLocaleString('ko-KR');
}

function buildStarforceButtonRow(session, options = {}) {
  const allDisabled = Boolean(options.disabled);
  const canEnhance = !allDisabled && session?.status === 'active';
  const canRecover = !allDisabled && session?.status === 'destroyed' && Boolean(session?.pendingRecovery);
  const canEnd = !allDisabled && (session?.status === 'active' || session?.status === 'destroyed');

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(createStarforceCustomId('enhance', session.sessionId))
      .setLabel('⭐ 강화')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!canEnhance),
    new ButtonBuilder()
      .setCustomId(createStarforceCustomId('recover', session.sessionId))
      .setLabel('복구')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canRecover),
    new ButtonBuilder()
      .setCustomId(createStarforceCustomId('end', session.sessionId))
      .setLabel('❌ 종료')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!canEnd),
  );
}

function createStarforceCustomId(action, sessionId) {
  return `${STARFORCE_CUSTOM_ID_PREFIX}:${action}:${sessionId}`;
}

function parseStarforceCustomId(customId) {
  const match = String(customId ?? '').match(/^starforce:(enhance|recover|end):([a-f0-9-]+)$/i);
  if (!match) {
    return null;
  }

  return {
    action: match[1].toLowerCase(),
    sessionId: match[2],
  };
}

function touchStarforceSession(session, now = Date.now()) {
  session.updatedAtMs = now;
  session.expiresAtMs = now + STARFORCE_SESSION_TTL_MS;
}

function isSessionExpired(session, now = Date.now()) {
  return now > Number(session.expiresAtMs || 0);
}

function pruneStarforceSessions(now = Date.now()) {
  for (const [sessionId, session] of starforceSessions.entries()) {
    if (!session || typeof session !== 'object') {
      starforceSessions.delete(sessionId);
      continue;
    }

    if ((session.status === 'active' || session.status === 'destroyed') && isSessionExpired(session, now)) {
      session.status = 'expired';
      session.updatedAtMs = now;
      session.statusText = '세션 만료됨';
    }

    if (session.status !== 'active' && session.status !== 'destroyed'
      && now - Number(session.updatedAtMs || 0) > STARFORCE_SESSION_GRACE_MS) {
      starforceSessions.delete(sessionId);
    }
  }
}

async function disableStarforceMessageFromInteraction(interaction, sessionId, session = null) {
  try {
    if (session) {
      await interaction.message.edit(await buildStarforceMessagePayload(session, {
        disabled: true,
      }));
      return;
    }

    await interaction.message.edit({
      content: '이미 만료된 스타포스다냥.',
      components: [
        buildStarforceButtonRow({
          sessionId,
          status: 'expired',
          pendingRecovery: false,
        }, { disabled: true }),
      ],
    });
  } catch (error) {
    console.error('[STARFORCE] failed to disable expired session message:');
    console.error(error);
  }
}
