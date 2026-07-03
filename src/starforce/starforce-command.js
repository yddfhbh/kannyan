import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import {
  primeStarforceCardCache,
  renderStarforceCard,
} from './starforce-card.js';
import {
  createStarforceSessionState,
  parseStarforceLevelInput,
  performStarforceAttempt,
  recoverStarforceSessionState,
  STARFORCE_SUPPORTED_LEVELS,
} from './starforce-simulator.js';
import {
  ensureStarforceSessionsLoaded,
  persistStarforceSessions,
} from './starforce-session-store.js';
import {
  addStarforceRankingEntry,
  ensureStarforceRankingsLoaded,
  getStarforceLeaderboard,
} from './starforce-ranking-store.js';

const STARFORCE_CUSTOM_ID_PREFIX = 'starforce';
const STARFORCE_SESSION_TTL_MS = 20 * 60 * 1000;
const STARFORCE_SESSION_CLEANUP_INTERVAL_MS = 60 * 1000;
const STARFORCE_SESSION_GRACE_MS = 60 * 60 * 1000;
const STARFORCE_EFFECT_DURATION_MS = 500;
const STARFORCE_USAGE_MESSAGE = [
  '사용법: %스타포스 <장비레벨>',
  '사용법: /스타포스 장비레벨:<장비레벨>',
  '예시: %스타포스 160',
].join('\n');
const STARFORCE_UNSUPPORTED_LEVEL_MESSAGE =
  `지원하는 장비 레벨: ${STARFORCE_SUPPORTED_LEVELS.join(', ')}`;

const STARFORCE_RANKING_LIMIT = 50;
const starforceSessions = new Map();

let cleanupTimer = null;

export function initStarforceCommand() {
  if (cleanupTimer) {
    return;
  }

  void ensureStarforceSessionsLoaded(starforceSessions)
    .then(() => {
      pruneStarforceSessions();
    })
    .catch((error) => {
      console.error('[STARFORCE] failed to load persisted sessions:');
      console.error(error);
    });

  void ensureStarforceRankingsLoaded().catch((error) => {
    console.error('[STARFORCE] failed to load persisted rankings:');
    console.error(error);
  });

  cleanupTimer = setInterval(() => {
    pruneStarforceSessions();
  }, STARFORCE_SESSION_CLEANUP_INTERVAL_MS);

  cleanupTimer.unref?.();
}

export async function handleStarforcePercentCommandMessage(message, input) {
  await ensureStarforceSessionsLoaded(starforceSessions);

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
  scheduleStarforceCardPrime(session);
  await persistStarforceSessions(starforceSessions);
  return true;
}

export async function handleStarforceSlashCommand(interaction) {
  await ensureStarforceSessionsLoaded(starforceSessions);

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
  scheduleStarforceCardPrime(session);
  await persistStarforceSessions(starforceSessions);
  return true;
}

export async function handleStarforceRankingPercentCommandMessage(message, input) {
  await ensureStarforceRankingsLoaded();

  const parsed = parseStarforceLevelInput(input);
  if (!parsed.ok) {
    await message.reply({
      content: parsed.error === 'unsupported_level'
        ? STARFORCE_UNSUPPORTED_LEVEL_MESSAGE
        : '사용법: %강화랭킹 <장비레벨>\n예시: %강화랭킹 160',
      allowedMentions: { repliedUser: false },
    });
    return true;
  }

  const leaderboard = await getStarforceLeaderboard(parsed.level, STARFORCE_RANKING_LIMIT);
  await message.reply({
    content: buildStarforceLeaderboardMessage(parsed.level, leaderboard),
    allowedMentions: { repliedUser: false, parse: [] },
  });
  return true;
}

export async function handleStarforceRankingSlashCommand(interaction) {
  await ensureStarforceRankingsLoaded();

  if (!interaction.isChatInputCommand() || interaction.commandName !== '강화랭킹') {
    return false;
  }

  const level = interaction.options.getInteger('장비레벨', true);
  const parsed = parseStarforceLevelInput(String(level));

  if (!parsed.ok) {
    await interaction.reply({
      content: parsed.error === 'unsupported_level'
        ? STARFORCE_UNSUPPORTED_LEVEL_MESSAGE
        : '사용법: /강화랭킹 장비레벨:<장비레벨>',
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const leaderboard = await getStarforceLeaderboard(parsed.level, STARFORCE_RANKING_LIMIT);
  await interaction.reply({
    content: buildStarforceLeaderboardMessage(parsed.level, leaderboard),
    allowedMentions: { parse: [] },
  });
  return true;
}

export async function handleStarforceComponentInteraction(interaction) {
  await ensureStarforceSessionsLoaded(starforceSessions);

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
    await persistStarforceSessions(starforceSessions);
    return true;
  }

  if (session.ownerUserId !== interaction.user.id) {
    await interaction.reply({
      content: '이 스타포스는 시작한 사람만 누를 수 있다냥.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (session.isRendering) {
    await interaction.reply({
      content: '지금 렌더링 중이다냥. 잠시만 기다려줘.',
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
      await persistStarforceSessions(starforceSessions);
      return true;
    }

    await playStarforceResultEffect(interaction, session, attemptResult.type);
    scheduleStarforceCardPrime(session);
    await persistStarforceSessions(starforceSessions);
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
    await updateStarforceInteractionMessage(interaction, session);
    scheduleStarforceCardPrime(session);
    await persistStarforceSessions(starforceSessions);
    return true;
  }

  if (parsed.action === 'end') {
    session.status = 'ended';
    session.updatedAtMs = now;
    session.statusText = '세션 종료됨';

    await addStarforceRankingEntry({
      ownerUserId: session.ownerUserId,
      nickname: getInteractionDisplayName(interaction, session),
      level: session.equipLevel ?? session.level,
      star: session.currentStar,
      mesosUsed: session.mesoUsed ?? session.totalMesos ?? 0,
      attempts: session.attempts ?? session.attemptCount ?? 0,
      finishedAtMs: now,
    });

    await updateStarforceInteractionMessage(interaction, session, {
      disabled: true,
    });
    await persistStarforceSessions(starforceSessions);
    return true;
  }

  await interaction.reply({
    content: '알 수 없는 스타포스 버튼이다냥.',
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function buildStarforceMessagePayload(session, options = {}) {
  const image = await renderStarforceCard(session, {
    effectType: options.effectType,
  });

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
        temporarilyLocked: Boolean(options.temporarilyLocked),
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

function buildStarforceLeaderboardMessage(level, leaderboard) {
  const lines = [`⭐ ${level}제 강화 랭킹`];

  if (!Array.isArray(leaderboard) || leaderboard.length === 0) {
    lines.push('아직 기록이 없다냥.');
    return lines.join('\n');
  }

  for (const [index, entry] of leaderboard.entries()) {
    lines.push(
      `${index + 1}. ${entry.nickname} - ${entry.star}성 - ${formatStarforceMesos(entry.mesosUsed)} 메소`
    );
  }

  return lines.join('\n');
}

function getInteractionDisplayName(interaction, session) {
  return interaction.member?.displayName
    ?? interaction.user?.globalName
    ?? interaction.user?.username
    ?? session?.ownerUserId
    ?? '알 수 없음';
}

function buildStarforceButtonRow(session, options = {}) {
  const allDisabled = Boolean(options.disabled);
  const temporarilyLocked = Boolean(options.temporarilyLocked);
  const canEnhance = !allDisabled && !temporarilyLocked && session?.status === 'active';
  const canRecover = !allDisabled && !temporarilyLocked && session?.status === 'destroyed' && Boolean(session?.pendingRecovery);
  const canEnd = !allDisabled && !temporarilyLocked && (session?.status === 'active' || session?.status === 'destroyed');

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

async function playStarforceResultEffect(interaction, session, resultType) {
  session.isRendering = true;

  try {
    await interaction.deferUpdate();

    await interaction.message.edit(await buildStarforceMessagePayload(session, {
      temporarilyLocked: true,
      effectType: resultType,
    }));

    await delay(STARFORCE_EFFECT_DURATION_MS);

    await interaction.message.edit(await buildStarforceMessagePayload(session));
  } finally {
    session.isRendering = false;
  }
}

async function updateStarforceInteractionMessage(interaction, session, options = {}) {
  session.isRendering = true;

  try {
    await interaction.deferUpdate();

    await interaction.message.edit(await buildStarforceMessagePayload(session, {
      ...options,
      temporarilyLocked: true,
    }));

    await interaction.message.edit(await buildStarforceMessagePayload(session, options));
  } finally {
    session.isRendering = false;
  }
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
  let changed = false;

  for (const [sessionId, session] of starforceSessions.entries()) {
    if (!session || typeof session !== 'object') {
      starforceSessions.delete(sessionId);
      changed = true;
      continue;
    }

    if ((session.status === 'active' || session.status === 'destroyed') && isSessionExpired(session, now)) {
      session.status = 'expired';
      session.updatedAtMs = now;
      session.statusText = '세션 만료됨';
    }

    if (
      session.status !== 'active'
      && session.status !== 'destroyed'
      && now - Number(session.updatedAtMs || 0) > STARFORCE_SESSION_GRACE_MS
    ) {
      starforceSessions.delete(sessionId);
      changed = true;
    }
  }

  if (changed) {
    void persistStarforceSessions(starforceSessions);
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

function scheduleStarforceCardPrime(session) {
  if (!session || session.isPrimingCardCache) {
    return;
  }

  session.isPrimingCardCache = true;

  queueMicrotask(() => {
    primeStarforceCardCache(session)
      .catch(() => {
        // Ignore cache priming failures so interaction flow keeps working.
      })
      .finally(() => {
        session.isPrimingCardCache = false;
      });
  });
}
