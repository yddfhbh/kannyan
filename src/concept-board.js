import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
} from 'discord.js';

const defaultDataDir = fileURLToPath(new URL('../data/', import.meta.url));
const dataDir = resolve(
  process.env.TETRIO_LEAGUE_DATA_DIR?.trim()
    || process.env.DATA_DIR?.trim()
    || defaultDataDir
);
const statePath = join(dataDir, 'concept-board-state.json');
const maxBodyLength = 3500;
const allowedImageContentTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

let state = null;
let stateSaveQueue = Promise.resolve();

function createEmptyState() {
  return {
    guilds: {},
    conceptPosts: {},
  };
}

function normalizeStateShape(rawState) {
  const normalized = rawState && typeof rawState === 'object'
    ? rawState
    : createEmptyState();

  normalized.guilds ??= {};
  normalized.conceptPosts ??= {};

  for (const [guildId, guildState] of Object.entries(normalized.guilds)) {
    const nextGuildState = guildState && typeof guildState === 'object'
      ? guildState
      : {};

    const legacyConfig =
      nextGuildState.channelId && nextGuildState.emojiDisplay
        ? nextGuildState
        : null;

    if (!nextGuildState.configs || typeof nextGuildState.configs !== 'object') {
      nextGuildState.configs = {};
    }

    if (!Number.isFinite(Number(nextGuildState.nextConfigId))) {
      nextGuildState.nextConfigId = 1;
    }

    if (legacyConfig) {
      const configId = '1';

      if (!nextGuildState.configs[configId]) {
        nextGuildState.configs[configId] = {
          id: configId,
          outputChannelId: String(legacyConfig.channelId),
          emojiKey: buildStoredEmojiKey(legacyConfig),
          emojiDisplay: String(legacyConfig.emojiDisplay ?? legacyConfig.emojiName ?? ''),
          threshold: Number(legacyConfig.threshold) || 1,
          createdAt: legacyConfig.createdAt ?? legacyConfig.updatedAt ?? new Date().toISOString(),
          updatedAt: legacyConfig.updatedAt ?? new Date().toISOString(),
          updatedBy: legacyConfig.updatedBy ?? null,
        };
      }

      nextGuildState.nextConfigId = Math.max(Number(nextGuildState.nextConfigId) || 1, 2);
      delete nextGuildState.channelId;
      delete nextGuildState.emojiType;
      delete nextGuildState.emojiId;
      delete nextGuildState.emojiName;
      delete nextGuildState.emojiDisplay;
      delete nextGuildState.threshold;
    }

    normalized.guilds[guildId] = nextGuildState;
  }

  if (normalized.posts && typeof normalized.posts === 'object') {
    for (const legacyPost of Object.values(normalized.posts)) {
      if (!legacyPost || typeof legacyPost !== 'object') {
        continue;
      }

      const duplicateKey = getConceptPostKey(
        legacyPost.guildId,
        legacyPost.boardChannelId,
        legacyPost.sourceMessageId
      );

      normalized.conceptPosts[duplicateKey] ??= {
        guildId: legacyPost.guildId ?? '',
        outputChannelId: legacyPost.boardChannelId ?? '',
        sourceChannelId: legacyPost.sourceChannelId ?? '',
        sourceMessageId: legacyPost.sourceMessageId ?? '',
        boardMessageId: legacyPost.boardMessageId ?? '',
        configId: legacyPost.configId ?? null,
        reactionCount: Number(legacyPost.lastReactionCount) || 0,
        createdAt: legacyPost.createdAt ?? new Date().toISOString(),
        updatedAt: legacyPost.updatedAt ?? legacyPost.createdAt ?? new Date().toISOString(),
      };
    }

    delete normalized.posts;
  }

  return normalized;
}

async function loadState() {
  if (state) {
    return state;
  }

  try {
    state = normalizeStateShape(JSON.parse(await fs.readFile(statePath, 'utf8')));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }

    state = createEmptyState();
  }

  return state;
}

async function saveState() {
  stateSaveQueue = stateSaveQueue.then(async () => {
    await fs.mkdir(dataDir, { recursive: true });
    const tempPath = `${statePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
    await fs.rename(tempPath, statePath);
  });

  return stateSaveQueue;
}

function normalizeUnicodeEmoji(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFKC')
    .replace(/[\uFE0E\uFE0F]/g, '');
}

function makeUnicodeEmojiKey(name) {
  return `unicode:${normalizeUnicodeEmoji(name)}`;
}

function makeCustomEmojiKey(id) {
  return `custom:${String(id ?? '').trim()}`;
}

function buildStoredEmojiKey(config) {
  if (String(config?.emojiType ?? '') === 'custom' && config?.emojiId) {
    return makeCustomEmojiKey(config.emojiId);
  }

  return makeUnicodeEmojiKey(config?.emojiName ?? '');
}

function parseEmojiInput(value) {
  const input = String(value ?? '').trim();

  if (!input) {
    return null;
  }

  const customMatch = input.match(/^<?(a?):([a-zA-Z0-9_]+):(\d+)>?$/);

  if (customMatch) {
    const [, animatedFlag, name, id] = customMatch;
    return {
      emojiKey: makeCustomEmojiKey(id),
      emojiDisplay: `<${animatedFlag === 'a' ? 'a' : ''}:${name}:${id}>`,
      emojiType: 'custom',
      emojiId: id,
      emojiName: name,
    };
  }

  const normalized = normalizeUnicodeEmoji(input);

  if (!normalized) {
    return null;
  }

  return {
    emojiKey: makeUnicodeEmojiKey(normalized),
    emojiDisplay: input,
    emojiType: 'unicode',
    emojiId: null,
    emojiName: normalized,
  };
}

function getReactionEmojiKey(emoji) {
  if (!emoji) {
    return null;
  }

  if (emoji.id) {
    return makeCustomEmojiKey(emoji.id);
  }

  return makeUnicodeEmojiKey(emoji.name ?? '');
}

function getConceptPostKey(guildId, outputChannelId, sourceMessageId) {
  return `${guildId}:${outputChannelId}:${sourceMessageId}`;
}

function truncateMessageBody(value) {
  const text = String(value ?? '').trim();

  if (!text) {
    return '(본문 없음)';
  }

  if (text.length <= maxBodyLength) {
    return text;
  }

  return `${text.slice(0, maxBodyLength - 3).trimEnd()}...`;
}

function getFirstImageAttachment(message) {
  for (const attachment of message.attachments.values()) {
    const contentType = String(attachment.contentType ?? '').toLowerCase();
    const url = String(attachment.url ?? '');

    if (allowedImageContentTypes.has(contentType)) {
      return attachment;
    }

    if (!contentType && /\.(png|jpe?g|webp|gif)$/i.test(url)) {
      return attachment;
    }
  }

  return null;
}

function buildConceptEmbed({ message, config, reactionCount }) {
  const authorName =
    message.member?.displayName
    || message.author?.globalName
    || message.author?.username
    || 'Unknown User';
  const authorIconUrl = message.author?.displayAvatarURL?.({ size: 256 }) ?? null;
  const channelName = String(message.channel?.name ?? 'unknown');
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`${config.emojiDisplay} ${reactionCount}`)
    .setAuthor({
      name: authorName,
      ...(authorIconUrl ? { iconURL: authorIconUrl } : {}),
    })
    .setDescription(truncateMessageBody(message.content))
    .addFields({
      name: 'Original Message',
      value: `[#${channelName} Jump](${message.url})`,
    })
    .setTimestamp(message.createdAt);

  const imageAttachment = getFirstImageAttachment(message);

  if (imageAttachment?.url) {
    embed.setImage(imageAttachment.url);
  }

  return embed;
}

function getGuildConfigState(loadedState, guildId) {
  loadedState.guilds[guildId] ??= {
    nextConfigId: 1,
    configs: {},
  };

  loadedState.guilds[guildId].configs ??= {};

  if (!Number.isFinite(Number(loadedState.guilds[guildId].nextConfigId))) {
    loadedState.guilds[guildId].nextConfigId = 1;
  }

  return loadedState.guilds[guildId];
}

function formatConfigSummary(config) {
  return `ID ${config.id} | 채널 <#${config.outputChannelId}> | 이모지 ${config.emojiDisplay} | 기준 ${config.threshold}개`;
}

async function ensureManager(interaction) {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: '서버 안에서만 사용할 수 있다냥.',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({
      content: '이 명령어는 관리자만 쓸 수 있다냥.',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  return true;
}

async function fetchTextChannel(client, channelId, label) {
  const channel = await client.channels.fetch(channelId).catch((error) => {
    console.error(`[CONCEPT BOARD] ${label} 채널 fetch 실패 channel=${channelId}`);
    console.error(error);
    return null;
  });

  if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
    console.error(`[CONCEPT BOARD] ${label} 채널이 없거나 텍스트 채널이 아님 channel=${channelId}`);
    return null;
  }

  return channel;
}

async function resolveSourceMessage(reaction) {
  if (reaction.partial) {
    await reaction.fetch();
  }

  if (!reaction.message) {
    return null;
  }

  if (reaction.message.partial) {
    await reaction.message.fetch();
  }

  return reaction.message ?? null;
}

async function upsertConceptPost({ message, config, reactionCount }) {
  const loadedState = await loadState();
  const duplicateKey = getConceptPostKey(message.guildId, config.outputChannelId, message.id);
  const existingPost = loadedState.conceptPosts[duplicateKey] ?? null;

  if (existingPost && existingPost.configId && String(existingPost.configId) !== String(config.id)) {
    console.log(
      `[CONCEPT BOARD] duplicate skipped guild=${message.guildId} output=${config.outputChannelId} source=${message.id} existingConfig=${existingPost.configId} requestedConfig=${config.id}`
    );
    return;
  }

  const outputChannel = await fetchTextChannel(message.client, config.outputChannelId, 'OUTPUT');

  if (!outputChannel) {
    console.error(
      `[CONCEPT BOARD] output channel unavailable; skip guild=${message.guildId} config=${config.id} channel=${config.outputChannelId}`
    );
    return;
  }

  if (!outputChannel.permissionsFor?.(message.client.user)?.has([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.ReadMessageHistory,
  ])) {
    console.error(
      `[CONCEPT BOARD] output channel permission missing; skip guild=${message.guildId} config=${config.id} channel=${config.outputChannelId}`
    );
    return;
  }

  const embed = buildConceptEmbed({ message, config, reactionCount });

  if (existingPost?.boardMessageId) {
    const existingMessage = await outputChannel.messages.fetch(existingPost.boardMessageId).catch((error) => {
      console.error(
        `[CONCEPT BOARD] existing concept post fetch failed guild=${message.guildId} boardMessage=${existingPost.boardMessageId}`
      );
      console.error(error);
      return null;
    });

    if (existingMessage) {
      await existingMessage.edit({
        embeds: [embed],
        allowedMentions: { parse: [] },
      }).catch((error) => {
        console.error(
          `[CONCEPT BOARD] existing concept post edit failed guild=${message.guildId} boardMessage=${existingPost.boardMessageId}`
        );
        console.error(error);
        return null;
      });

      loadedState.conceptPosts[duplicateKey] = {
        ...existingPost,
        configId: String(config.id),
        reactionCount,
        updatedAt: new Date().toISOString(),
      };
      await saveState();
      return;
    }
  }

  const sent = await outputChannel.send({
    embeds: [embed],
    allowedMentions: { parse: [] },
  }).catch((error) => {
    console.error(
      `[CONCEPT BOARD] concept post send failed guild=${message.guildId} config=${config.id} output=${config.outputChannelId}`
    );
    console.error(error);
    return null;
  });

  if (!sent) {
    return;
  }

  loadedState.conceptPosts[duplicateKey] = {
    guildId: message.guildId,
    outputChannelId: config.outputChannelId,
    sourceChannelId: message.channelId,
    sourceMessageId: message.id,
    boardMessageId: sent.id,
    configId: String(config.id),
    reactionCount,
    createdAt: existingPost?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveState();
}

async function processConceptBoardReactionAdd(reaction) {
  const reactionEmojiKey = getReactionEmojiKey(reaction.emoji);

  if (!reactionEmojiKey) {
    return;
  }

  const message = await resolveSourceMessage(reaction).catch((error) => {
    console.error('[CONCEPT BOARD] source message fetch failed; skip');
    console.error(error);
    return null;
  });

  if (!message?.guildId || !message.guild) {
    return;
  }

  const sourceChannel = await fetchTextChannel(message.client, message.channelId, 'SOURCE');

  if (!sourceChannel) {
    console.error(
      `[CONCEPT BOARD] source channel unavailable; skip guild=${message.guildId} sourceChannel=${message.channelId} sourceMessage=${message.id}`
    );
    return;
  }

  const loadedState = await loadState();
  const guildState = loadedState.guilds[message.guildId];
  const configs = Object.values(guildState?.configs ?? {});

  if (configs.length === 0) {
    return;
  }

  const reactionCount = Number(reaction.count) || 0;

  for (const config of configs) {
    if (!config || config.emojiKey !== reactionEmojiKey) {
      continue;
    }

    if (reactionCount < Number(config.threshold) || message.channelId === config.outputChannelId) {
      continue;
    }

    await upsertConceptPost({
      message,
      config,
      reactionCount,
    });
  }
}

export async function handleConceptBoardAddInteraction(interaction) {
  if (!await ensureManager(interaction)) {
    return;
  }

  const outputChannel = interaction.options.getChannel('채널', true);
  const emojiInput = interaction.options.getString('이모지', true);
  const threshold = interaction.options.getInteger('개수', true);
  const parsedEmoji = parseEmojiInput(emojiInput);

  if (!outputChannel.isTextBased()) {
    await interaction.reply({
      content: '텍스트 채널만 지정할 수 있다냥.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!parsedEmoji) {
    await interaction.reply({
      content: '이모지를 읽지 못했다냥. 일반 이모지나 `<:name:id>` 형식으로 넣어달라냥.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const loadedState = await loadState();
  const guildState = getGuildConfigState(loadedState, interaction.guildId);
  const configId = String(guildState.nextConfigId);

  guildState.configs[configId] = {
    id: configId,
    outputChannelId: outputChannel.id,
    emojiKey: parsedEmoji.emojiKey,
    emojiDisplay: parsedEmoji.emojiDisplay,
    threshold,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: interaction.user.id,
  };
  guildState.nextConfigId = Number(guildState.nextConfigId) + 1;

  await saveState();

  await interaction.reply({
    content: `개념글 설정을 추가했다냥.\n${formatConfigSummary(guildState.configs[configId])}`,
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleConceptBoardListInteraction(interaction) {
  if (!await ensureManager(interaction)) {
    return;
  }

  const loadedState = await loadState();
  const configs = Object.values(getGuildConfigState(loadedState, interaction.guildId).configs);

  if (configs.length === 0) {
    await interaction.reply({
      content: '등록된 개념글 설정이 없다냥.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = ['현재 개념글 설정 목록이다냥.'];

  for (const config of configs.sort((a, b) => Number(a.id) - Number(b.id))) {
    lines.push(formatConfigSummary(config));
  }

  await interaction.reply({
    content: lines.join('\n'),
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleConceptBoardUpdateInteraction(interaction) {
  if (!await ensureManager(interaction)) {
    return;
  }

  const configId = String(interaction.options.getInteger('id', true));
  const outputChannel = interaction.options.getChannel('채널');
  const emojiInput = interaction.options.getString('이모지');
  const threshold = interaction.options.getInteger('개수');
  const loadedState = await loadState();
  const guildState = getGuildConfigState(loadedState, interaction.guildId);
  const config = guildState.configs[configId];

  if (!config) {
    await interaction.reply({
      content: `ID ${configId} 설정을 찾지 못했다냥.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!outputChannel && emojiInput == null && threshold == null) {
    await interaction.reply({
      content: '수정할 값이 하나도 없다냥. 채널, 이모지, 개수 중 하나는 넣어달라냥.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (outputChannel) {
    if (!outputChannel.isTextBased()) {
      await interaction.reply({
        content: '텍스트 채널만 지정할 수 있다냥.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    config.outputChannelId = outputChannel.id;
  }

  if (emojiInput != null) {
    const parsedEmoji = parseEmojiInput(emojiInput);

    if (!parsedEmoji) {
      await interaction.reply({
        content: '이모지를 읽지 못했다냥.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    config.emojiKey = parsedEmoji.emojiKey;
    config.emojiDisplay = parsedEmoji.emojiDisplay;
  }

  if (threshold != null) {
    config.threshold = threshold;
  }

  config.updatedAt = new Date().toISOString();
  config.updatedBy = interaction.user.id;
  await saveState();

  await interaction.reply({
    content: `개념글 설정을 수정했다냥.\n${formatConfigSummary(config)}`,
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleConceptBoardDeleteInteraction(interaction) {
  if (!await ensureManager(interaction)) {
    return;
  }

  const configId = String(interaction.options.getInteger('id', true));
  const loadedState = await loadState();
  const guildState = getGuildConfigState(loadedState, interaction.guildId);
  const config = guildState.configs[configId];

  if (!config) {
    await interaction.reply({
      content: `ID ${configId} 설정을 찾지 못했다냥.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  delete guildState.configs[configId];
  await saveState();

  await interaction.reply({
    content: `개념글 설정 ID ${configId} 를 삭제했다냥.`,
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleConceptBoardReactionAdd(reaction) {
  await processConceptBoardReactionAdd(reaction);
}

export async function handleConceptBoardReactionRemove() {
  // 개념글은 한 번 올라가면 유지한다.
}
