import crypto from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { getCurrentStarforceEvent } from './starforce-event.js';
import {
  createStarforceSessionState,
  parseStarforceLevelInput,
  performStarforceAttempt,
  resetStarforceSessionState,
  STARFORCE_SUPPORTED_LEVELS,
} from './starforce-simulator.js';

const STARFORCE_CUSTOM_ID_PREFIX = 'starforce';
const STARFORCE_SESSION_TTL_MS = 20 * 60 * 1000;
const STARFORCE_SESSION_CLEANUP_INTERVAL_MS = 60 * 1000;
const STARFORCE_SESSION_GRACE_MS = 60 * 60 * 1000;
const STARFORCE_USAGE_MESSAGE = '사용법: %스타포스 <장비레벨>\n예시: %스타포스 160';
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
    const content = parsed.error === 'unsupported_level'
      ? STARFORCE_UNSUPPORTED_LEVEL_MESSAGE
      : STARFORCE_USAGE_MESSAGE;

    await message.reply({
      content,
      allowedMentions: { repliedUser: false },
    });
    return true;
  }

  const now = Date.now();
  const sessionId = crypto.randomUUID();
  const session = createStarforceSessionState({
    sessionId,
    ownerUserId: message.author.id,
    level: parsed.level,
    now,
  });

  touchStarforceSession(session, now);

  const sentMessage = await message.reply({
    ...buildStarforceMessagePayload(session),
    allowedMentions: { repliedUser: false, parse: [] },
  });

  session.channelId = sentMessage.channelId;
  session.messageId = sentMessage.id;
  starforceSessions.set(sessionId, session);

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
    }

    await interaction.reply({
      content: '이미 만료된 스타포스다냥.',
      flags: MessageFlags.Ephemeral,
    });

    await disableStarforceMessageFromInteraction(interaction, parsed.sessionId, '세션 상태: 만료됨');
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

    await interaction.update(buildStarforceMessagePayload(session));
    return true;
  }

  if (parsed.action === 'reset') {
    resetStarforceSessionState(session, now);
    touchStarforceSession(session, now);
    await interaction.update(buildStarforceMessagePayload(session));
    return true;
  }

  if (parsed.action === 'end') {
    session.status = 'ended';
    session.updatedAtMs = now;

    await interaction.update(buildStarforceMessagePayload(session, {
      disabled: true,
      footerStatus: '세션 상태: 종료됨',
    }));
    return true;
  }

  await interaction.reply({
    content: '알 수 없는 스타포스 버튼이다냥.',
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

export function buildStarforceMessagePayload(session, options = {}) {
  const disabled = Boolean(options.disabled) || session.status !== 'active';
  session.event = getCurrentStarforceEvent(new Date());

  return {
    content: buildStarforceMessageContent(session, options.footerStatus ?? ''),
    components: [
      buildStarforceButtonRow(session.sessionId, { disabled }),
    ],
  };
}

export function buildStarforceMessageContent(session, footerStatus = '') {
  const recentLogLines = session.recentLogs.length > 0
    ? session.recentLogs.join('\n')
    : '아직 강화하지 않았습니다.';

  return [
    '⭐ 스타포스 강화',
    '',
    `장비 레벨: ${session.level}제`,
    `현재 성: ★ ${session.currentStar}`,
    `이벤트: ${session.event?.name || '없음'}`,
    '',
    `사용 메소: ${formatStarforceNumber(session.totalMesos)}`,
    `시도: ${formatStarforceNumber(session.attemptCount)}회`,
    `파괴: ${formatStarforceNumber(session.destroyCount)}회`,
    '',
    '최근 결과:',
    recentLogLines,
    footerStatus ? `\n${footerStatus}` : '',
  ].filter(Boolean).join('\n');
}

function buildStarforceButtonRow(sessionId, options = {}) {
  const disabled = Boolean(options.disabled);

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(createStarforceCustomId('enhance', sessionId))
      .setLabel('⭐ 강화')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(createStarforceCustomId('reset', sessionId))
      .setLabel('🔄 초기화')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(createStarforceCustomId('end', sessionId))
      .setLabel('❌ 종료')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

function createStarforceCustomId(action, sessionId) {
  return `${STARFORCE_CUSTOM_ID_PREFIX}:${action}:${sessionId}`;
}

function parseStarforceCustomId(customId) {
  const match = String(customId ?? '').match(/^starforce:(enhance|reset|end):([a-f0-9-]+)$/i);
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

    if (session.status === 'active' && isSessionExpired(session, now)) {
      session.status = 'expired';
      session.updatedAtMs = now;
    }

    if (session.status !== 'active' && now - Number(session.updatedAtMs || 0) > STARFORCE_SESSION_GRACE_MS) {
      starforceSessions.delete(sessionId);
    }
  }
}

async function disableStarforceMessageFromInteraction(interaction, sessionId, footerStatus) {
  const disabledComponents = [
    buildStarforceButtonRow(sessionId, { disabled: true }),
  ];
  const nextContent = addTerminalStatusToContent(interaction.message?.content ?? '', footerStatus);

  try {
    await interaction.message.edit({
      content: nextContent,
      components: disabledComponents,
    });
  } catch (error) {
    console.error('[STARFORCE] failed to disable expired session message:');
    console.error(error);
  }
}

function addTerminalStatusToContent(content, footerStatus) {
  const normalizedContent = String(content ?? '').trimEnd();
  const trimmedStatus = String(footerStatus ?? '').trim();

  if (!trimmedStatus) {
    return normalizedContent;
  }

  const statusPattern = /\n세션 상태:\s*(?:종료됨|만료됨)\s*$/;
  if (statusPattern.test(normalizedContent)) {
    return normalizedContent.replace(statusPattern, `\n${trimmedStatus}`);
  }

  return `${normalizedContent}\n\n${trimmedStatus}`;
}

function formatStarforceNumber(value) {
  return Number(value || 0).toLocaleString('ko-KR');
}
