import 'dotenv/config';

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderSvgToPng } from './svg-renderer.js';
import { renderPuzzleLeaderboardCard } from './puzzle-leaderboard-card.js';
import { renderPuzzleRatingCard } from './puzzle-rating-card.js';
import {
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { Chess } from 'chess.js';
import { getUserChessMoveTextCandidates } from './chess/chess-move-input.js';

const statePath = fileURLToPath(new URL('../data/daily-chess-puzzle.json', import.meta.url));
const puzzlePoolPath = fileURLToPath(new URL('../data/lichess-puzzle-pool.jsonl', import.meta.url));

const chessPieceDir = new URL('../assets/chess-pieces/cburnett/', import.meta.url);
const chessPieceSvgCache = new Map();

const defaultDailyPuzzleAdminId = '635107514471415808';

const dailyPuzzleAdminIds = new Set([
  defaultDailyPuzzleAdminId,
  ...parseCommaSeparatedValues(process.env.DAILY_CHESS_PUZZLE_ADMIN_IDS),
]);

const dailyPuzzlePostHour = clampInteger(
  parseOptionalInteger(process.env.DAILY_CHESS_PUZZLE_HOUR, 12),
  0,
  23
);

const dailyPuzzleCheckIntervalMs = Math.max(
  30_000,
  Number(process.env.DAILY_CHESS_PUZZLE_CHECK_INTERVAL_MS) || 60_000
);
const dailyPuzzleInitialRawRating = 2600;
const dailyPuzzleEloK = 32;
const dailyPuzzleAnnouncementGuildId = '1219197226572840990';
const dailyPuzzleAnnouncementUserId = '635107514471415808';

const activeSessions = new Map();
const discordAvatarDataUriCache = new Map();

let state = null;
let stateSaveQueue = Promise.resolve();
let timer = null;
let puzzlePool = null;

export function initDailyChessPuzzle(client) {
  if (timer) {
    clearInterval(timer);
  }

  void hydrateDailyPuzzleSessions()
    .then(() => checkDailyPuzzlePosts(client))
    .catch((error) => {
      console.error('Failed to initialize daily chess puzzle sessions:');
      console.error(error);
    });

  timer = setInterval(() => {
    void checkDailyPuzzlePosts(client).catch((error) => {
      console.error('Failed to check daily chess puzzle posts:');
      console.error(error);
    });
  }, dailyPuzzleCheckIntervalMs);

  console.log(`Daily chess puzzle enabled. Post hour: ${dailyPuzzlePostHour}:00 KST`);
}

export async function handleDailyPuzzleMessage(message) {
  const content = message.content?.trim() ?? '';

  if (isDailyPuzzleRatingLeaderboardCommand(content)) {
    await message.reply(await createPuzzleRatingLeaderboardReply(message.client, {
      allowMentions: {
        repliedUser: false,
      },
    }));
    return true;
  }

  if (isDailyPuzzleRatingCommand(content)) {
    await message.reply(await createPuzzleRatingProfileReply(message.client, message.author.id, {
      allowedMentions: {
        repliedUser: false,
      },
    }));
    return true;
  }

  if (!message.guild) {
    if (/^%일일퍼즐\s*$/i.test(content)) {
      const result = await startDailyPuzzleForUser({
        client: message.client,
        user: message.author,
        sourceGuildId: null,
        startedAtMs: message.createdTimestamp,
      });

      await replyDailyPuzzleStartResult(message, result);
      return true;
    }

    const session = await getActiveDailyPuzzleSession(message.author.id);
    if (!session) {
      return false;
    }

    if (isDailyPuzzleAbandonCommand(content)) {
      const abandonResult = await abandonDailyPuzzleSession(message.client, message.author, session);
      await message.reply({
        content: abandonResult.recorded
          ? [
            '이번 일일퍼즐을 포기 처리했고, 이번 포기는 퍼즐 레이팅 패배로 반영했다냥. 오늘 다시 도전할 수 있다냥.',
            ...createDailyPuzzleRatingUpdateLines(abandonResult),
          ].join('\n')
          : '이번 일일퍼즐을 포기 처리했다냥. 오늘 레이팅 반영은 이미 끝났고, 다시 도전은 할 수 있다냥.',
        allowedMentions: {
          repliedUser: false,
        },
      });
      return true;
    }

    let answerText = content;

// DM에서 진행 중인 퍼즐이 있으면 %h5h7 같은 입력도 수로 처리
if (answerText.startsWith('%') && !/^%일일퍼즐\s*$/i.test(answerText)) {
  answerText = answerText.slice(1).trim();
}

// /로 시작하는 건 디스코드 명령어 취급
if (answerText.startsWith('/')) {
  return false;
}

await handleDailyPuzzleAnswer(message, session, answerText);
return true;
  }

  if (!/^%일일퍼즐\s*$/i.test(content)) {
    return false;
  }

  const result = await startDailyPuzzleForUser({
    client: message.client,
    user: message.author,
    sourceGuildId: message.guildId,
    startedAtMs: message.createdTimestamp,
  });

  await replyDailyPuzzleStartResult(message, result);
  return true;
}

export async function handleDailyPuzzleSetInteraction(interaction) {
  if (!interaction.guildId || !interaction.channelId) {
    await interaction.reply({
      content: '서버 채널에서만 지정할 수 있다냥.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const canSet =
    dailyPuzzleAdminIds.has(interaction.user.id) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

  if (!canSet) {
    await interaction.reply({
      content: '관리자만 일일퍼즐 채널을 지정할 수 있다냥.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const loadedState = await loadState();

  loadedState.settings.guilds[interaction.guildId] = {
    channelId: interaction.channelId,
    setBy: interaction.user.id,
    setAt: new Date().toISOString(),
  };

  await saveState();

  await interaction.reply({
    content: `이 채널을 일일 체스 퍼즐 알림 채널로 지정했다냥.\n매일 KST ${String(dailyPuzzlePostHour).padStart(2, '0')}:00 이후에 퍼즐을 올린다냥.`,
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleDailyPuzzleRequestInteraction(interaction) {
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  const result = await startDailyPuzzleForUser({
    client: interaction.client,
    user: interaction.user,
    sourceGuildId: interaction.guildId ?? null,
    startedAtMs: interaction.createdTimestamp,
  });

  await interaction.editReply(createDailyPuzzleStartResultText(result));
}

export async function handleDailyPuzzleLeaderboardInteraction(interaction) {
  await interaction.reply(await createPuzzleRatingLeaderboardReply(interaction.client));
}

export async function handleDailyPuzzleRatingInteraction(interaction) {
  const targetUser = interaction.options.getUser('유저') ?? interaction.user;
  await interaction.reply(await createPuzzleRatingProfileReply(interaction.client, targetUser.id));
}

export async function handleDailyPuzzleAnnouncementInteraction(interaction) {
  if (!isDailyPuzzleAnnouncementGuildAllowed(interaction.guildId)) {
    await interaction.reply({
      content: '이 명령어는 허용된 서버에서만 쓸 수 있다냥.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!isDailyPuzzleAnnouncementUserAllowed(interaction.user.id)) {
    await interaction.reply({
      content: '이 명령어는 지정된 관리자만 쓸 수 있다냥.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const loadedState = await loadState();
  const announcementContent = interaction.options.getString('내용', true).trim();
  const guildEntries = Object.entries(loadedState.settings.guilds ?? {})
    .filter(([, config]) => typeof config?.channelId === 'string' && config.channelId);

  if (!announcementContent) {
    await interaction.reply({
      content: '공지 내용을 입력해달라냥.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (guildEntries.length === 0) {
    await interaction.reply({
      content: '아직 `/일일퍼즐지정`된 채널이 없다냥.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  try {
    const result = await broadcastDailyPuzzleManualAnnouncement({
      client: interaction.client,
      loadedState,
      content: announcementContent,
    });

    const successLine = result.successes.length > 0
      ? `보낸 채널: ${result.successes.map((entry) => `<#${entry.channelId}>`).join(', ')}`
      : '성공한 채널이 없다냥.';
    const failureLine = result.failures.length > 0
      ? `실패: ${result.failures.map((entry) => `<#${entry.channelId}> (${entry.reason})`).join(', ')}`
      : '실패한 채널은 없다냥.';

    await interaction.editReply([
      `일일퍼즐 공지를 ${result.successes.length}개 채널에 보냈다냥.`,
      successLine,
      failureLine,
    ].join('\n'));
  } catch (error) {
    console.error('Failed to broadcast manual daily puzzle announcement:');
    console.error(error);
    await interaction.editReply(`일일퍼즐 수동 공지를 보내지 못했다냥.\n원인: ${error.message}`);
  }
}

async function startDailyPuzzleForUser({
  client,
  user,
  sourceGuildId,
  startedAtMs = Date.now(),
}) {
  const loadedState = await loadState();
  const previousSession = await getActiveDailyPuzzleSession(user.id);
  const { dateKey } = getKstDateInfo();

  if (!sourceGuildId && hasDailyPuzzleAbandonedAttempt(loadedState, dateKey, user.id)) {
    return {
      ok: false,
      reason: 'CHANNEL_RESTART_REQUIRED',
    };
  }

  const announcementResolution = await resolveAnnouncementConfig(loadedState, {
    client,
    userId: user.id,
    guildId: sourceGuildId,
    previousSession,
    allowFallback: !sourceGuildId,
  });

  if (!announcementResolution.ok) {
    return { ok: false, reason: announcementResolution.reason };
  }

  const { config: announcementConfig } = announcementResolution;
  const previousSolve = loadedState.solved[dateKey]?.[user.id];
  if (previousSolve) {
    return {
      ok: true,
      alreadySolved: true,
      elapsedMs: previousSolve.elapsedMs,
      dateKey,
    };
  }

  let puzzle;

  try {
    puzzle = await getDailyPuzzle(dateKey);
  } catch (error) {
    console.error('Failed to load Lichess daily puzzle:');
    console.error(error);
    return { ok: false, reason: 'FETCH_FAILED', error };
  }

  const keepStartedAt =
    previousSession?.dateKey === dateKey &&
    previousSession?.puzzleId === puzzle.id
      ? previousSession.startedAtMs
      : startedAtMs;

  const session = {
    userId: user.id,
    userTag: user.tag,
    dateKey,
    puzzleId: puzzle.id,
    currentFen: previousSession?.currentFen ?? puzzle.playFen,
    solutionMoves: puzzle.solutionMoves,
    index: previousSession?.index ?? 0,
    startedAtMs: keepStartedAt,
    sourceGuildId: announcementConfig.guildId,
    sourceGuildDisplayName: await resolveDailyPuzzleUserDisplayName(
      client,
      user.id,
      announcementConfig.guildId,
      user.globalName ?? user.username ?? user.tag
    ),
    sourceChannelId: announcementConfig.channelId,
    rating: puzzle.rating,
    themes: puzzle.themes,
    gameUrl: puzzle.gameUrl,
    turnText: puzzle.turnText,
  };

  activeSessions.set(user.id, session);
  await persistDailyPuzzleSession(session);
  if (clearDailyPuzzleAbandonedAttempt(loadedState, dateKey, user.id)) {
    await saveState();
  }

  try {
    const image = await renderPuzzleImage({
      fen: session.currentFen,
      title: `Lichess Daily Puzzle ${puzzle.id}`,
      subtitle: `${session.turnText} 차례 · 난이도 ${puzzle.rating}`,
      flipped: getFenSideToMove(session.currentFen) === 'b',
    });

    const attachment = new AttachmentBuilder(image, {
      name: `lichess-daily-puzzle-${puzzle.id}.png`,
    });

    await user.send({
      content: [
        `오늘의 일일 체스 퍼즐이다냥.`,
        `**${session.turnText} 차례**다냥.`,
        `난이도: **${puzzle.rating}**`,
        puzzle.themes?.length ? `테마: ${puzzle.themes.slice(0, 5).join(', ')}` : '',
        '',
        '수를 SAN 또는 UCI로 보내면 된다냥.',
        '예: `Nf3+`, `Qh7#`, `e2e4`, `O-O`',
        '',
        '`포기`라고 보내면 퍼즐 채널에 공개 포기 처리된다냥.',
        '포기한 뒤에도 오늘 다시 도전할 수 있다냥.',
      ].filter(Boolean).join('\n'),
      files: [attachment],
    });
  } catch (error) {
    console.error(`Failed to send daily puzzle DM to ${user.tag}:`);
    console.error(error);

    activeSessions.delete(user.id);
    await deletePersistedDailyPuzzleSession(user.id);

    return { ok: false, reason: 'DM_FAILED' };
  }

  return {
    ok: true,
    alreadySolved: false,
    puzzleId: puzzle.id,
    dateKey,
  };
}

async function handleDailyPuzzleAnswer(message, session, answerText = null) {
  const rawInput = answerText ?? message.content?.trim() ?? '';

  if (!rawInput) {
    return;
  }

  const expectedUci = session.solutionMoves[session.index];

  if (!expectedUci) {
    activeSessions.delete(message.author.id);
    await deletePersistedDailyPuzzleSession(message.author.id);
    await message.reply('세션 상태가 이상해서 초기화했다냥. `%일일퍼즐`로 다시 시작해달라냥.');
    return;
  }

  let expectedMove;

  try {
    expectedMove = getMoveFromUci(session.currentFen, expectedUci);
  } catch (error) {
    console.error('Failed to apply expected daily puzzle move:');
    console.error(error);
    activeSessions.delete(message.author.id);
    await deletePersistedDailyPuzzleSession(message.author.id);
    await message.reply('퍼즐 처리 중 오류가 났다냥. 다시 시작해달라냥.');
    return;
  }

  const userMateMove = tryApplyUserMove(session.currentFen, rawInput);

  if (
    !isMatchingExpectedMove(rawInput, expectedMove) &&
    !(isMateInOneSession(session) && userMateMove?.isCheckmate)
  ) {
    const ratingResult = await recordDailyPuzzleRatedAttempt(message.author, session, 0);
    await message.reply(
      ratingResult.recorded
        ? [
          '틀렸다냥. 이번 판정은 실패로 기록됐지만 DM에서 계속 이어서 풀 수 있다냥.',
          ...createDailyPuzzleRatingUpdateLines(ratingResult),
        ].join('\n')
        : '틀렸다냥. 오늘 퍼즐 레이팅 반영은 이미 끝난 상태라 추가 반영은 없고, DM에서 계속 이어서 풀 수 있다냥.'
    );
    return;
  }

  if (userMateMove?.isCheckmate && isMateInOneSession(session)) {
    session.currentFen = userMateMove.nextFen;
    session.index = session.solutionMoves.length;
    await completeDailyPuzzle(message, session);
    return;
  }

  session.currentFen = expectedMove.nextFen;
  session.index += 1;

  if (session.index >= session.solutionMoves.length) {
    await completeDailyPuzzle(message, session);
    return;
  }

  const opponentUci = session.solutionMoves[session.index];

  let opponentMove;

  try {
    opponentMove = getMoveFromUci(session.currentFen, opponentUci);
  } catch (error) {
    console.error('Failed to apply opponent daily puzzle move:');
    console.error(error);
    activeSessions.delete(message.author.id);
    await deletePersistedDailyPuzzleSession(message.author.id);
    await message.reply('상대 수 처리 중 오류가 났다냥. 다시 시작해달라냥.');
    return;
  }

  session.currentFen = opponentMove.nextFen;
  session.index += 1;

  if (session.index >= session.solutionMoves.length) {
    await completeDailyPuzzle(message, session);
    return;
  }

  await persistDailyPuzzleSession(session);

  await message.reply(
    `맞았다냥! 상대는 \`${opponentMove.san}\` 뒀다냥.\n다음 수를 입력해달라냥.`
  );
}

async function completeDailyPuzzle(message, session) {
  const elapsedMs = Math.max(0, Date.now() - session.startedAtMs);
  const ratingResult = await recordDailyPuzzleRatedAttempt(message.author, session, 1);
  const recordResult = await recordDailyPuzzleSolve(message.author, session, elapsedMs);

  activeSessions.delete(message.author.id);
  await deletePersistedDailyPuzzleSession(message.author.id);

  if (!recordResult.recorded) {
    await message.reply(
      `오늘 퍼즐은 이미 풀었다냥. 기록은 ${formatElapsed(recordResult.previous.elapsedMs)}이다냥.`
    );
    return;
  }

  await message.reply(
    ratingResult.recorded
      ? [
        `정답이다냥! ${formatElapsed(elapsedMs)} 만에 풀었다냥.`,
        ...createDailyPuzzleRatingUpdateLines(ratingResult),
      ].join('\n')
      : `정답이다냥! ${formatElapsed(elapsedMs)} 만에 풀었다냥.\n오늘 퍼즐 레이팅 반영은 이미 끝난 상태라 추가 변동은 없다냥.`
  );
  await announceDailyPuzzleSolved(message.client, message.author, session, elapsedMs);
}

async function recordDailyPuzzleSolve(user, session, elapsedMs) {
  const loadedState = await loadState();
  const profile = ensureDailyPuzzleRatingProfile(loadedState, user, session);

  loadedState.solved[session.dateKey] ??= {};

  const previous = loadedState.solved[session.dateKey][user.id];

  if (previous) {
    return { recorded: false, previous };
  }

  loadedState.solved[session.dateKey][user.id] = {
    userId: user.id,
    userTag: user.tag,
    guildDisplayName: normalizeDailyPuzzleDisplayName(
      session.sourceGuildDisplayName
        ?? user.globalName
        ?? user.username
        ?? user.tag
    ),
    elapsedMs,
    solvedAt: new Date().toISOString(),
    guildId: session.sourceGuildId,
    puzzleId: session.puzzleId,
    rating: session.rating,
    puzzleRatingDisplay: formatDailyPuzzleDisplayRating(profile.rawRating),
  };

  profile.solvedCount += 1;
  syncDailyPuzzleRatingProfile(profile, user, session);
  profile.updatedAt = new Date().toISOString();

  await saveState();

  return { recorded: true };
}

async function announceDailyPuzzleSolved(client, user, session, elapsedMs) {
  const channel = await client.channels.fetch(session.sourceChannelId).catch((error) => {
    console.error(`Failed to fetch daily puzzle announcement channel ${session.sourceChannelId}:`);
    console.error(error);
    return null;
  });

  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
    return;
  }

  await channel.send({
    content: `<@${user.id}> 님이 ${formatKoreanDateKey(session.dateKey)} 일일퍼즐을 ${formatElapsed(elapsedMs)}만에 푸셨다냥!`,
    allowedMentions: {
      users: [user.id],
    },
  });
}

async function abandonDailyPuzzleSession(client, user, session) {
  const ratingResult = await recordDailyPuzzleRatedAttempt(user, session, 0);
  await markDailyPuzzleAbandonedAttempt(session);
  activeSessions.delete(session.userId);
  await deletePersistedDailyPuzzleSession(session.userId);
  await announceDailyPuzzleAbandoned(client, session);
  return ratingResult;
}

async function announceDailyPuzzleAbandoned(client, session) {
  const channel = await client.channels.fetch(session.sourceChannelId).catch((error) => {
    console.error(`Failed to fetch daily puzzle announcement channel ${session.sourceChannelId}:`);
    console.error(error);
    return null;
  });

  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
    return;
  }

  try {
    await channel.send({
      content: createDailyPuzzleAbandonAnnouncement(session.userId),
      allowedMentions: {
        users: [session.userId],
      },
    });
  } catch (error) {
    console.error(`Failed to announce daily puzzle abandonment for ${session.userId}:`);
    console.error(error);
  }
}

async function markDailyPuzzleAbandonedAttempt(session) {
  const loadedState = await loadState();
  loadedState.abandoned ??= {};
  loadedState.abandoned[session.dateKey] ??= {};
  loadedState.abandoned[session.dateKey][session.userId] = {
    userId: session.userId,
    guildId: session.sourceGuildId,
    channelId: session.sourceChannelId,
    puzzleId: session.puzzleId,
    abandonedAt: new Date().toISOString(),
  };
  await saveState();
}

async function expireDailyPuzzleSessions(todayKey = getKstDateInfo().dateKey) {
  const loadedState = await loadState();
  let changed = false;

  for (const [userId, session] of Object.entries(loadedState.sessions ?? {})) {
    if (!isDailyPuzzleSessionExpired(session, todayKey)) {
      continue;
    }

    activeSessions.delete(userId);
    delete loadedState.sessions[userId];
    changed = true;
  }

  for (const dateKey of Object.keys(loadedState.abandoned ?? {})) {
    if (dateKey === todayKey) {
      continue;
    }

    delete loadedState.abandoned[dateKey];
    changed = true;
  }

  if (changed) {
    await saveState();
  }
}

async function checkDailyPuzzlePosts(client) {
  const { dateKey, hour } = getKstDateInfo();

  await expireDailyPuzzleSessions(dateKey);

  if (hour < dailyPuzzlePostHour) {
    return;
  }

  const loadedState = await loadState();
  const guildEntries = Object.entries(loadedState.settings.guilds ?? {});

  if (guildEntries.length === 0) {
    return;
  }

  const targets = guildEntries.filter(([guildId]) => {
    const postKey = createPostKey(guildId, dateKey);
    return !loadedState.posts[postKey];
  });

  if (targets.length === 0) {
    return;
  }

  for (const [guildId, config] of targets) {
    try {
      await postDailyPuzzleAnnouncementToGuild({
        client,
        loadedState,
        guildId,
        config,
        dateKey,
        force: false,
      });
    } catch (error) {
      console.error(`Failed to post daily puzzle to channel ${config.channelId}:`);
      console.error(error);
    }
  }
}

async function createDailyPostContent(loadedState, client, puzzle, dateKey, yesterdayKey) {
  return [
    `**${formatKoreanDateKey(dateKey)} 일일 체스 퍼즐이다냥!**`,
    `${puzzle.turnText} 차례다냥. 난이도는 ${puzzle.rating}이다냥.`,
    '풀려면 %일일퍼즐을 입력하라냥.',
    '',
    await createLeaderboardText(loadedState, client, yesterdayKey),
  ].join('\n');
}

async function postDailyPuzzleAnnouncementToGuild({
  client,
  loadedState,
  guildId,
  config,
  dateKey = getKstDateInfo().dateKey,
  force = false,
}) {
  const postKey = createPostKey(guildId, dateKey);
  if (!force && loadedState.posts?.[postKey]) {
    return null;
  }

  let puzzle;

  try {
    puzzle = await getDailyPuzzle(dateKey);
  } catch (error) {
    throw new Error(`일일퍼즐 데이터를 불러오지 못했다냥: ${error.message}`);
  }

  const image = await renderPuzzleImage({
    fen: puzzle.playFen,
    title: `${formatKoreanDateKey(dateKey)} 일일 체스 퍼즐`,
    subtitle: `${puzzle.turnText} 차례 · 난이도 ${puzzle.rating}`,
    flipped: getFenSideToMove(puzzle.playFen) === 'b',
  });

  const yesterdayKey = addDaysToDateKey(dateKey, -1);
  const content = await createDailyPostContent(loadedState, client, puzzle, dateKey, yesterdayKey);
  const channel = await client.channels.fetch(config.channelId).catch((error) => {
    console.error(`Failed to fetch daily puzzle channel ${config.channelId}:`);
    console.error(error);
    return null;
  });

  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
    throw new Error(`일일퍼즐 채널 ${config.channelId}에 메시지를 보낼 수 없다냥.`);
  }

  const attachment = new AttachmentBuilder(Buffer.from(image), {
    name: `lichess-daily-puzzle-${puzzle.id}.png`,
  });

  const sent = await channel.send({
    content,
    files: [attachment],
    allowedMentions: {
      parse: [],
    },
  });

  loadedState.posts[postKey] = {
    guildId,
    channelId: config.channelId,
    messageId: sent.id,
    puzzleId: puzzle.id,
    postedAt: new Date().toISOString(),
    forced: force,
  };

  await saveState();

  return {
    channelId: config.channelId,
    dateKey,
    puzzleId: puzzle.id,
    messageId: sent.id,
  };
}

async function broadcastDailyPuzzleManualAnnouncement({
  client,
  loadedState,
  content,
}) {
  const guildEntries = Object.entries(loadedState.settings.guilds ?? {})
    .filter(([, config]) => typeof config?.channelId === 'string' && config.channelId);
  const successes = [];
  const failures = [];

  for (const [guildId, config] of guildEntries) {
    const channelId = config.channelId;
    const channel = await client.channels.fetch(channelId).catch((error) => {
      console.error(`Failed to fetch daily puzzle announcement channel ${channelId}:`);
      console.error(error);
      return null;
    });

    if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
      failures.push({
        guildId,
        channelId,
        reason: '채널 접근 불가',
      });
      continue;
    }

    try {
      const sent = await channel.send({
        content,
        allowedMentions: {
          parse: ['users'],
        },
      });
      successes.push({
        guildId,
        channelId,
        messageId: sent.id,
      });
    } catch (error) {
      console.error(`Failed to send manual daily puzzle announcement to ${channelId}:`);
      console.error(error);
      failures.push({
        guildId,
        channelId,
        reason: error?.message ?? '전송 실패',
      });
    }
  }

  return {
    successes,
    failures,
  };
}

function parseOptionalInteger(value, fallback) {
  if (value == null || String(value).trim() === '') {
    return fallback;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.trunc(number);
}

export async function createLeaderboardText(loadedState, client, dateKey) {
  const records = Object.values(loadedState.solved[dateKey] ?? {}).sort(
    (a, b) => a.elapsedMs - b.elapsedMs
  );

  if (records.length === 0) {
    return `**어제의 리더보드 (${formatKoreanDateKey(dateKey)})**\n기록이 없다냥.`;
  }

  const lines = await Promise.all(records.slice(0, 10).map(async (record, index) => {
    const displayName = await getDailyPuzzleLeaderboardDisplayName(client, record);
    const puzzleRatingDisplay = getDailyPuzzleRecordRatingDisplay(loadedState, record);
    return `${index + 1}. ${displayName} (${puzzleRatingDisplay}) - ${formatElapsed(record.elapsedMs)}`;
  }));

  return [
    `**어제의 리더보드 (${formatKoreanDateKey(dateKey)}, 전체 서버 통합)**`,
    ...lines,
  ].join('\n');
}

async function getDailyPuzzle(dateKey) {
  const pool = await readPuzzlePool();

  if (pool.length === 0) {
    throw new Error('Lichess puzzle pool is empty. Run scripts/build-lichess-puzzle-pool.js first.');
  }

  const index = getDailyPuzzleIndex(dateKey, pool.length);
  return buildPlayablePuzzleFromPoolItem(pool[index]);
}

export async function readPuzzlePool() {
  if (puzzlePool) {
    return puzzlePool;
  }

  const raw = await fs.readFile(puzzlePoolPath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') {
      throw new Error(`Puzzle pool file not found: ${puzzlePoolPath}`);
    }
    throw error;
  });

  puzzlePool = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  console.log(`Loaded ${puzzlePool.length} Lichess puzzle(s).`);
  return puzzlePool;
}

export function buildPlayablePuzzleFromPoolItem(item) {
  const chess = new Chess(item.fen);

  const introMove = applyUciMove(chess, item.moves[0]);
  if (!introMove) {
    throw new Error(`Invalid intro move for puzzle ${item.id}`);
  }

  const playFen = chess.fen();
  const solutionMoves = item.moves.slice(1);

  if (solutionMoves.length === 0) {
    throw new Error(`Puzzle ${item.id} has no solution moves.`);
  }

  return {
    id: item.id,
    originalFen: item.fen,
    playFen,
    introMoveSan: introMove.san,
    solutionMoves,
    rating: item.rating,
    themes: item.themes,
    gameUrl: item.gameUrl,
    openingTags: item.openingTags,
    turnText: getFenTurnText(playFen),
  };
}

function getDailyPuzzleIndex(dateKey, poolLength) {
  const hash = crypto.createHash('sha256').update(`kannyan:${dateKey}`).digest();
  return hash.readUInt32BE(0) % poolLength;
}

export function getMoveFromUci(fen, uci) {
  const chess = new Chess(fen);
  const move = applyUciMove(chess, uci);

  if (!move) {
    throw new Error(`Illegal UCI move ${uci} from ${fen}`);
  }

  return {
    san: move.san,
    uci: `${move.from}${move.to}${move.promotion ?? ''}`,
    nextFen: chess.fen(),
  };
}

function applyUciMove(chess, uci) {
  const match = String(uci).match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/i);

  if (!match) {
    return null;
  }

  try {
    return chess.move({
      from: match[1],
      to: match[2],
      promotion: match[3]?.toLowerCase(),
    });
  } catch {
    return null;
  }
}

export function tryApplyUserMove(fen, rawInput) {
  const input = String(rawInput ?? '').trim();

  if (!input) {
    return null;
  }

  const chess = new Chess(fen);
  let move = null;

  const uci = normalizeUci(input);
  if (uci) {
    move = applyUciMove(chess, uci);
  }

  if (!move) {
    for (const sanInput of getUserChessMoveTextCandidates(input)) {
      try {
        move = chess.move(sanInput, { sloppy: true });
      } catch {
        try {
          move = chess.move(sanInput);
        } catch {
          move = null;
        }
      }

      if (move) {
        break;
      }
    }
  }

  if (!move) {
    return null;
  }

  return {
    san: move.san,
    uci: `${move.from}${move.to}${move.promotion ?? ''}`,
    nextFen: chess.fen(),
    isCheckmate: chess.isCheckmate(),
  };
}

export function isMatchingExpectedMove(rawInput, expectedMove) {
  const inputUci = normalizeUci(rawInput);
  const expectedSan = normalizeSanForCompare(expectedMove.san);
  const inputSans = getUserChessMoveTextCandidates(rawInput)
    .map((candidate) => normalizeSanForCompare(candidate));

  return (
    inputSans.includes(expectedSan) ||
    inputUci === expectedMove.uci
  );
}

function isMateInOneSession(session) {
  return session.solutionMoves.length === 1 && session.themes?.includes?.('mateIn1');
}

export async function renderPuzzleImage({ fen, title, subtitle, flipped = false }) {
  const size = 560;
  const boardSize = 480;
  const margin = 40;
  const top = 58;
  const squareSize = boardSize / 8;

  const chess = new Chess(fen);

  const light = '#f0d9b5';
  const dark = '#b58863';

  let squaresSvg = '';
  let piecesSvg = '';
  let coordsSvg = '';

  const files = 'abcdefgh';

  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const fileIndex = flipped ? 7 - col : col;
      const rank = flipped ? row + 1 : 8 - row;
      const square = `${files[fileIndex]}${rank}`;

      const x = margin + col * squareSize;
      const y = top + row * squareSize;
      const isLight = (fileIndex + rank) % 2 === 1;

      squaresSvg += `<rect x="${x}" y="${y}" width="${squareSize}" height="${squareSize}" fill="${isLight ? light : dark}"/>`;

      
const piece = chess.get(square);
if (piece) {
  const piecePadding = 5;

  piecesSvg += await getPieceInlineSvg(
    piece,
    x + piecePadding,
    y + piecePadding,
    squareSize - piecePadding * 2
  );
}

      if (row === 7) {
        coordsSvg += `<text x="${x + squareSize - 6}" y="${y + squareSize - 5}" text-anchor="end" font-size="12" font-family="Arial" fill="${isLight ? '#6b4c2d' : '#f6e3c6'}">${files[fileIndex]}</text>`;
      }

      if (col === 0) {
        coordsSvg += `<text x="${x + 5}" y="${y + 14}" font-size="12" font-family="Arial" fill="${isLight ? '#6b4c2d' : '#f6e3c6'}">${rank}</text>`;
      }
    }
  }

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size + 40}" viewBox="0 0 ${size} ${size + 40}">
  <rect width="100%" height="100%" fill="#222"/>
  <text x="${size / 2}" y="25" text-anchor="middle" font-size="22" font-family="Arial" fill="#fff">${escapeXml(title)}</text>
  <text x="${size / 2}" y="48" text-anchor="middle" font-size="15" font-family="Arial" fill="#ddd">${escapeXml(subtitle)}</text>
  <rect x="${margin - 4}" y="${top - 4}" width="${boardSize + 8}" height="${boardSize + 8}" fill="#111"/>
  ${squaresSvg}
  ${coordsSvg}
  ${piecesSvg}
</svg>`;

  return renderSvgToPng(svg);
}

async function createPuzzleRatingLeaderboardReply(client, { allowMentions } = {}) {
  const loadedState = await loadState();
  const profiles = Object.values(loadedState.puzzleRatings ?? {})
    .filter((profile) => Number(profile?.ratedAttempts) > 0)
    .sort(compareDailyPuzzleRatingProfiles);
  const rankedProfiles = buildDailyPuzzleRankedProfiles(profiles);
  const topProfiles = rankedProfiles.slice(0, 10);

  if (topProfiles.length === 0) {
    return {
      content: '**퍼즐 레이팅 리더보드**\n아직 레이팅 기록이 없다냥.',
      allowedMentions: allowMentions,
    };
  }

  const rows = await Promise.all(topProfiles.map(async ({ profile, rank, displayRating }) => {
    const displayName = await getDailyPuzzleRatingProfileDisplayName(client, profile);
    return {
      rank,
      name: displayName,
      rating: displayRating,
      solvedCount: profile.solvedCount,
      ratedAttempts: profile.ratedAttempts,
    };
  }));

  const image = await renderPuzzleLeaderboardCard({
    title: 'PUZZLE LEADERBOARD',
    subtitle: `TOP ${rows.length} / DAILY CHESS PUZZLE`,
    rows,
    generatedAt: new Date().toISOString(),
  });

  return {
    files: [
      new AttachmentBuilder(image, {
        name: 'daily-puzzle-leaderboard.png',
      }),
    ],
    allowedMentions: allowMentions,
  };
}

async function createPuzzleRatingProfileReply(client, userId, { allowedMentions } = {}) {
  const loadedState = await loadState();
  const profiles = Object.values(loadedState.puzzleRatings ?? {})
    .filter((profile) => Number(profile?.ratedAttempts) > 0)
    .sort(compareDailyPuzzleRatingProfiles);
  const rankedProfiles = buildDailyPuzzleRankedProfiles(profiles);
  const rankedProfile = rankedProfiles.find(({ profile }) => profile?.userId === userId);

  if (!rankedProfile) {
    return {
      content: '아직 퍼즐 레이팅 기록이 없다냥.',
      allowedMentions: allowedMentions,
    };
  }

  const { profile, rank, displayRating } = rankedProfile;
  const user = await fetchDiscordUser(client, userId);
  const avatarDataUri = await fetchDiscordAvatarDataUri(user);
  const displayName = normalizeDailyPuzzleDisplayName(
    user?.globalName
      ?? profile?.lastGuildDisplayName
      ?? user?.username
      ?? profile?.userTag
      ?? userId
  ) || userId;
  const handle = normalizeDailyPuzzleUserHandle(user?.username ?? profile?.userTag ?? userId);
  const image = await renderPuzzleRatingCard({
    displayName,
    handle,
    rating: displayRating,
    rank,
    solvedCount: profile.solvedCount,
    ratedAttempts: profile.ratedAttempts,
    avatarDataUri,
  });

  return {
    files: [
      new AttachmentBuilder(image, {
        name: 'daily-puzzle-rating.png',
      }),
    ],
    allowedMentions: allowedMentions,
  };
}

function getPieceSymbol(piece) {
  const symbols = {
    w: {
      k: '♔',
      q: '♕',
      r: '♖',
      b: '♗',
      n: '♘',
      p: '♙',
    },
    b: {
      k: '♚',
      q: '♛',
      r: '♜',
      b: '♝',
      n: '♞',
      p: '♟',
    },
  };

  return symbols[piece.color]?.[piece.type] ?? '';
}

async function getPieceInlineSvg(piece, x, y, size) {
  const pieceName = `${piece.color}${piece.type.toUpperCase()}.svg`;

  if (chessPieceSvgCache.has(pieceName)) {
    const cached = chessPieceSvgCache.get(pieceName);
    return wrapPieceSvg(cached, x, y, size);
  }

  const pieceUrl = new URL(pieceName, chessPieceDir);

  try {
    const rawSvg = await fs.readFile(pieceUrl, 'utf8');
    const parsed = parseSvgForInline(rawSvg);

    chessPieceSvgCache.set(pieceName, parsed);

    return wrapPieceSvg(parsed, x, y, size);
  } catch (error) {
    console.error(`Failed to load chess piece SVG: ${pieceUrl.pathname}`);
    console.error(error);

    const fallbackSvg = createFallbackPieceSvg(piece);
    const parsed = parseSvgForInline(fallbackSvg);

    chessPieceSvgCache.set(pieceName, parsed);

    return wrapPieceSvg(parsed, x, y, size);
  }
}

function parseSvgForInline(svg) {
  const cleaned = String(svg)
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .trim();

  const viewBoxMatch = cleaned.match(/viewBox=["']([^"']+)["']/i);
  const widthMatch = cleaned.match(/width=["']([^"']+)["']/i);
  const heightMatch = cleaned.match(/height=["']([^"']+)["']/i);

  const viewBox =
    viewBoxMatch?.[1] ??
    (widthMatch && heightMatch ? `0 0 ${widthMatch[1]} ${heightMatch[1]}` : '0 0 64 64');

  const inner = cleaned
    .replace(/^<svg\b[^>]*>/i, '')
    .replace(/<\/svg>\s*$/i, '')
    .trim();

  return {
    viewBox,
    inner,
  };
}

function wrapPieceSvg(parsed, x, y, size) {
  return `
<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${escapeXml(parsed.viewBox)}" preserveAspectRatio="xMidYMid meet">
  ${parsed.inner}
</svg>`;
}

function createFallbackPieceSvg(piece) {
  const symbol = getPieceSymbol(piece);

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <text x="32" y="48" text-anchor="middle" font-size="48" font-family="Noto Sans CJK KR, Arial">${escapeXml(symbol)}</text>
</svg>`;
}

async function hydrateDailyPuzzleSessions() {
  const todayKey = getKstDateInfo().dateKey;

  await expireDailyPuzzleSessions(todayKey);

  const loadedState = await loadState();
  let changed = false;

  for (const [userId, session] of Object.entries(loadedState.sessions ?? {})) {
    const isToday = session?.dateKey === todayKey;
    const alreadySolved = Boolean(loadedState.solved?.[session?.dateKey]?.[userId]);
    const isValid = isValidPersistedDailyPuzzleSession(session);

    if (!isToday || alreadySolved || !isValid) {
      delete loadedState.sessions[userId];
      changed = true;
      continue;
    }

    activeSessions.set(userId, session);
  }

  if (changed) {
    await saveState();
  }

  console.log(`Restored ${activeSessions.size} active daily puzzle session(s).`);
}

async function getActiveDailyPuzzleSession(userId) {
  await expireDailyPuzzleSessions();

  const cached = activeSessions.get(userId);

  if (cached) {
    return cached;
  }

  const loadedState = await loadState();
  const session = loadedState.sessions?.[userId];

  if (!session) {
    return null;
  }

  const todayKey = getKstDateInfo().dateKey;
  const alreadySolved = Boolean(loadedState.solved?.[session.dateKey]?.[userId]);

  if (
    session.dateKey !== todayKey
    || alreadySolved
    || !isValidPersistedDailyPuzzleSession(session)
  ) {
    delete loadedState.sessions[userId];
    await saveState();
    return null;
  }

  activeSessions.set(userId, session);
  return session;
}

async function persistDailyPuzzleSession(session) {
  const loadedState = await loadState();

  loadedState.sessions ??= {};
  loadedState.sessions[session.userId] = {
    userId: session.userId,
    userTag: session.userTag,
    dateKey: session.dateKey,
    puzzleId: session.puzzleId,
    currentFen: session.currentFen,
    solutionMoves: session.solutionMoves,
    index: session.index,
    startedAtMs: session.startedAtMs,
    sourceGuildId: session.sourceGuildId,
    sourceGuildDisplayName: session.sourceGuildDisplayName,
    sourceChannelId: session.sourceChannelId,
    rating: session.rating,
    themes: session.themes,
    gameUrl: session.gameUrl,
    turnText: session.turnText,
    updatedAt: new Date().toISOString(),
  };

  await saveState();
}

async function deletePersistedDailyPuzzleSession(userId) {
  const loadedState = await loadState();

  if (loadedState.sessions?.[userId]) {
    delete loadedState.sessions[userId];
    await saveState();
  }
}

async function loadState() {
  if (state) {
    return state;
  }

  try {
    state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }

    state = {};
  }

  state.settings ??= {};
  state.settings.guilds ??= {};
  state.posts ??= {};
  state.abandoned ??= {};
  state.puzzleRatings ??= {};
  state.puzzleRatedAttempts ??= {};
  state.solved ??= {};
  state.sessions ??= {};
  delete state.failed;

  return state;
}

async function saveState() {
  stateSaveQueue = stateSaveQueue.then(async () => {
    await fs.mkdir(new URL('../data/', import.meta.url), { recursive: true });

    const tempPath = `${statePath}.tmp`;

    await fs.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
    await fs.rename(tempPath, statePath);
  });

  return stateSaveQueue;
}

async function resolveAnnouncementConfig(
  loadedState,
  {
    client,
    userId,
    guildId,
    previousSession = null,
    allowFallback = false,
  } = {}
) {
  if (guildId && loadedState.settings.guilds[guildId]) {
    return {
      ok: true,
      config: {
        guildId,
        channelId: loadedState.settings.guilds[guildId].channelId,
      },
    };
  }

  if (guildId) {
    return {
      ok: false,
      reason: 'NO_CHANNEL',
    };
  }

  if (!allowFallback) {
    return {
      ok: false,
      reason: 'NO_CHANNEL',
    };
  }

  let matchingGuildIds = [];

  if (client && userId) {
    matchingGuildIds = await findConfiguredGuildIdsForUser(
      client,
      Object.keys(loadedState.settings.guilds ?? {}),
      userId
    );
  }

  return chooseDmAnnouncementConfig(loadedState.settings.guilds, {
    previousSessionGuildId: previousSession?.sourceGuildId ?? null,
    matchingGuildIds,
  });
}

async function findConfiguredGuildIdsForUser(client, guildIds, userId) {
  if (!client?.guilds || !Array.isArray(guildIds) || guildIds.length === 0 || !userId) {
    return [];
  }

  const matches = await Promise.all(guildIds.map(async (configuredGuildId) => {
    try {
      const guild =
        client.guilds.cache?.get(configuredGuildId)
        ?? await client.guilds.fetch?.(configuredGuildId);

      if (!guild) {
        return null;
      }

      if (guild.members?.cache?.get(userId)) {
        return configuredGuildId;
      }

      const member = await guild.members?.fetch?.(userId).catch(() => null);
      return member ? configuredGuildId : null;
    } catch {
      return null;
    }
  }));

  return matches.filter(Boolean);
}

export function chooseDmAnnouncementConfig(
  guildSettings,
  {
    previousSessionGuildId = null,
    matchingGuildIds = [],
  } = {}
) {
  if (previousSessionGuildId && guildSettings?.[previousSessionGuildId]?.channelId) {
    return {
      ok: true,
      config: {
        guildId: previousSessionGuildId,
        channelId: guildSettings[previousSessionGuildId].channelId,
      },
    };
  }

  const guildEntries = Object.entries(guildSettings ?? {});

  if (guildEntries.length === 0) {
    return {
      ok: false,
      reason: 'NO_CHANNEL',
    };
  }

  if (guildEntries.length === 1) {
    return {
      ok: true,
      config: {
        guildId: guildEntries[0][0],
        channelId: guildEntries[0][1].channelId,
      },
    };
  }

  const uniqueMatchingGuildIds = [...new Set(matchingGuildIds)].filter(
    (matchingGuildId) => guildSettings?.[matchingGuildId]?.channelId
  );

  if (uniqueMatchingGuildIds.length === 1) {
    return {
      ok: true,
      config: {
        guildId: uniqueMatchingGuildIds[0],
        channelId: guildSettings[uniqueMatchingGuildIds[0]].channelId,
      },
    };
  }

  return {
    ok: false,
    reason: 'DM_CONTEXT_REQUIRED',
  };
}

async function replyDailyPuzzleStartResult(message, result) {
  await message.reply({
    content: createDailyPuzzleStartResultText(result),
    allowedMentions: {
      repliedUser: false,
    },
  });
}

export function createDailyPuzzleStartResultText(result) {
  if (result.ok && result.alreadySolved) {
    return `오늘 일일퍼즐은 이미 풀었다냥. 기록은 ${formatElapsed(result.elapsedMs)}이다냥.`;
  }

  if (result.ok) {
    return 'DM으로 일일 체스 퍼즐을 보냈다냥.';
  }

  if (result.reason === 'NO_CHANNEL') {
    return '아직 일일퍼즐 채널이 지정되지 않았다냥. 관리자에게 `/일일퍼즐지정`을 먼저 해달라고 해달라냥.';
  }

  if (result.reason === 'DM_CONTEXT_REQUIRED') {
    return '여러 서버에서 일일퍼즐 채널이 지정돼 있어서 어느 서버에 기록을 올릴지 알 수 없다냥. 원하는 서버 채널에서 `%일일퍼즐`을 입력해달라냥.';
  }

  if (result.reason === 'CHANNEL_RESTART_REQUIRED') {
    return '오늘 퍼즐을 포기한 뒤에는 DM에서 바로 다시 시작할 수 없다냥. 일일퍼즐 지정 채널에서 `%일일퍼즐`을 다시 입력해달라냥.';
  }

  if (result.reason === 'DM_FAILED') {
    return 'DM을 보낼 수 없다냥. Discord 개인정보 설정에서 서버 멤버의 DM을 허용해달라냥.';
  }

  if (result.reason === 'FETCH_FAILED') {
    return `오늘 Lichess 퍼즐 데이터를 불러오지 못했다냥.\n원인: ${result.error?.message ?? '알 수 없음'}`;
  }

  return '일일퍼즐을 시작하지 못했다냥.';
}

function getFenSideToMove(fen) {
  return fen.split(/\s+/)[1];
}

function getFenTurnText(fen) {
  return getFenSideToMove(fen) === 'w' ? '백' : '흑';
}

function getKstDateInfo(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);

  return {
    dateKey: kst.toISOString().slice(0, 10),
    hour: kst.getUTCHours(),
    minute: kst.getUTCMinutes(),
  };
}

function addDaysToDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatKoreanDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-');
  return `${year}/${month}/${day}`;
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

function isDailyPuzzleRatingLeaderboardCommand(value) {
  return /^%(퍼즐리더보드|일일퍼즐리더보드)\s*$/i.test(String(value ?? '').trim());
}

function isDailyPuzzleRatingCommand(value) {
  return /^%(퍼즐레이팅|일일퍼즐레이팅)\s*$/i.test(String(value ?? '').trim());
}

function isDailyPuzzleAnnouncementGuildAllowed(guildId) {
  return String(guildId ?? '') === dailyPuzzleAnnouncementGuildId;
}

function isDailyPuzzleAnnouncementUserAllowed(userId) {
  return String(userId ?? '') === dailyPuzzleAnnouncementUserId;
}

function getDailyPuzzleRatedAttemptEntry(loadedState, dateKey, userId, puzzleId) {
  if (!dateKey || !userId || !puzzleId) {
    return null;
  }

  return loadedState.puzzleRatedAttempts?.[dateKey]?.[userId]?.[puzzleId] ?? null;
}

function hasDailyPuzzleRatedAttempt(loadedState, dateKey, userId, puzzleId) {
  return Boolean(getDailyPuzzleRatedAttemptEntry(loadedState, dateKey, userId, puzzleId));
}

function hasDailyPuzzleAbandonedAttempt(loadedState, dateKey, userId) {
  return Boolean(loadedState.abandoned?.[dateKey]?.[userId]);
}

function clearDailyPuzzleAbandonedAttempt(loadedState, dateKey, userId) {
  if (!loadedState?.abandoned?.[dateKey]?.[userId]) {
    return false;
  }

  delete loadedState.abandoned[dateKey][userId];
  if (Object.keys(loadedState.abandoned[dateKey]).length === 0) {
    delete loadedState.abandoned[dateKey];
  }
  return true;
}

function getDailyPuzzleOpponentRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) ? rating : dailyPuzzleInitialRawRating;
}

function calculateDailyPuzzleRawRating(rawRating, opponentRating, result) {
  const safeRawRating = Number.isFinite(rawRating) ? rawRating : dailyPuzzleInitialRawRating;
  const expectedScore = 1 / (1 + 10 ** ((opponentRating - safeRawRating) / 400));
  return safeRawRating + dailyPuzzleEloK * (result - expectedScore);
}

function getDailyPuzzleDisplayRating(rawRating) {
  const safeRawRating = Number.isFinite(rawRating) ? rawRating : dailyPuzzleInitialRawRating;
  const display = 1000 / (1 + Math.exp(-(safeRawRating - 2550) / 60));
  return Math.max(0, Math.min(1000, display));
}

function formatDailyPuzzleDisplayRating(rawRating) {
  return formatPuzzleDisplayRatingValue(getDailyPuzzleDisplayRating(rawRating));
}

function normalizeDailyPuzzleUserHandle(value) {
  return String(value ?? '')
    .trim()
    .replace(/^@+/, '');
}

function createDailyPuzzleRatingUpdateLines(ratingResult) {
  const attempt = ratingResult?.attempt;
  if (!attempt) {
    return [];
  }

  const displayBefore = getDailyPuzzleDisplayRating(attempt.rawBefore);
  const displayAfter = attempt.displayRating ?? getDailyPuzzleDisplayRating(attempt.rawAfter);
  const delta = displayAfter - displayBefore;
  const wins = Number(ratingResult?.summary?.wins) || 0;
  const losses = Number(ratingResult?.summary?.losses) || 0;

  return [
    `퍼즐 레이팅: ${formatIntegerValue(attempt.puzzleRating)}`,
    `퍼즐 점수: ${formatPuzzleDisplayRatingValue(displayBefore)} -> ${formatPuzzleDisplayRatingValue(displayAfter)} (${formatSignedDelta(delta)})`,
    `전적: ${wins}승 ${losses}패`,
  ];
}

function formatSignedDelta(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '0.00';
  }

  const text = number.toFixed(2);
  return number > 0 ? `+${text}` : text;
}

function formatIntegerValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number)}` : '-';
}

function formatPuzzleDisplayRatingValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : '-';
}

function getDailyPuzzleDisplayRatingForRanking(rawRating) {
  const displayRating = getDailyPuzzleDisplayRating(rawRating);
  return Number(displayRating.toFixed(2));
}

function buildDailyPuzzleRankedProfiles(profiles) {
  let previousDisplayRating = null;
  let previousRank = 0;

  return profiles.map((profile, index) => {
    const displayRating = getDailyPuzzleDisplayRatingForRanking(profile?.rawRating);
    const rank = previousDisplayRating !== null && displayRating === previousDisplayRating
      ? previousRank
      : index + 1;

    previousDisplayRating = displayRating;
    previousRank = rank;

    return {
      profile,
      rank,
      displayRating,
    };
  });
}

function ensureDailyPuzzleRatingProfile(loadedState, user, session) {
  loadedState.puzzleRatings ??= {};

  const userId = user?.id ?? session?.userId;
  if (!userId) {
    throw new Error('Daily puzzle rating profile requires a user id.');
  }

  const existingProfile = loadedState.puzzleRatings[userId];
  const profile = existingProfile && typeof existingProfile === 'object'
    ? existingProfile
    : {};

  profile.userId = userId;
  profile.rawRating = Number.isFinite(profile.rawRating)
    ? profile.rawRating
    : dailyPuzzleInitialRawRating;
  profile.solvedCount = Number.isFinite(profile.solvedCount) ? Math.trunc(profile.solvedCount) : 0;
  profile.ratedAttempts = Number.isFinite(profile.ratedAttempts) ? Math.trunc(profile.ratedAttempts) : 0;
  syncDailyPuzzleRatingProfile(profile, user, session);

  loadedState.puzzleRatings[userId] = profile;
  return profile;
}

function syncDailyPuzzleRatingProfile(profile, user, session) {
  const fallbackUserTag = normalizeDailyPuzzleDisplayName(session?.userTag);
  profile.userTag = normalizeDailyPuzzleDisplayName(user?.tag)
    || normalizeDailyPuzzleDisplayName(profile.userTag)
    || fallbackUserTag
    || `${profile.userId}`;

  profile.lastGuildId = session?.sourceGuildId ?? profile.lastGuildId ?? null;
  profile.lastGuildDisplayName = normalizeDailyPuzzleDisplayName(
    session?.sourceGuildDisplayName
      ?? user?.globalName
      ?? user?.username
      ?? profile.lastGuildDisplayName
      ?? fallbackUserTag
      ?? `${profile.userId}`
  );
}

function compareDailyPuzzleRatingProfiles(a, b) {
  const rawDiff = (Number(b?.rawRating) || 0) - (Number(a?.rawRating) || 0);
  if (rawDiff !== 0) {
    return rawDiff;
  }

  const ratedAttemptsDiff = (Number(b?.ratedAttempts) || 0) - (Number(a?.ratedAttempts) || 0);
  if (ratedAttemptsDiff !== 0) {
    return ratedAttemptsDiff;
  }

  const solvedCountDiff = (Number(b?.solvedCount) || 0) - (Number(a?.solvedCount) || 0);
  if (solvedCountDiff !== 0) {
    return solvedCountDiff;
  }

  return String(a?.userId ?? '').localeCompare(String(b?.userId ?? ''));
}

function getDailyPuzzleRecordRatingDisplay(loadedState, record) {
  if (record?.puzzleRatingDisplay != null) {
    return `${record.puzzleRatingDisplay}`;
  }

  const profile = loadedState.puzzleRatings?.[record?.userId];
  return formatDailyPuzzleDisplayRating(profile?.rawRating);
}

async function getDailyPuzzleRatingProfileDisplayName(client, profile) {
  const storedName = normalizeDailyPuzzleDisplayName(profile?.lastGuildDisplayName);
  if (storedName) {
    return storedName;
  }

  const fetchedName = await resolveDailyPuzzleUserDisplayName(
    client,
    profile?.userId,
    profile?.lastGuildId,
    profile?.userTag ?? profile?.userId ?? 'User'
  );

  const normalizedFetchedName = normalizeDailyPuzzleDisplayName(fetchedName);
  if (normalizedFetchedName && profile && typeof profile === 'object') {
    profile.lastGuildDisplayName = normalizedFetchedName;
  }

  return normalizedFetchedName || profile?.userTag || profile?.userId || 'User';
}

function getDailyPuzzleRatingRecordSummary(loadedState, userId) {
  let wins = 0;
  let losses = 0;

  for (const dateEntry of Object.values(loadedState.puzzleRatedAttempts ?? {})) {
    const userAttempts = dateEntry?.[userId];
    if (!userAttempts || typeof userAttempts !== 'object') {
      continue;
    }

    for (const attempt of Object.values(userAttempts)) {
      if (Number(attempt?.result) === 1) {
        wins += 1;
      } else if (Number(attempt?.result) === 0) {
        losses += 1;
      }
    }
  }

  return {
    wins,
    losses,
  };
}

async function fetchDiscordUser(client, userId) {
  if (!client?.users || !userId) {
    return null;
  }

  try {
    return client.users.cache?.get(userId) ?? await client.users.fetch?.(userId);
  } catch {
    return null;
  }
}

async function fetchDiscordAvatarDataUri(user) {
  const avatarUrl = user?.displayAvatarURL?.({
    extension: 'png',
    forceStatic: true,
    size: 256,
  });

  if (!avatarUrl) {
    return null;
  }

  if (discordAvatarDataUriCache.has(avatarUrl)) {
    return discordAvatarDataUriCache.get(avatarUrl);
  }

  try {
    const response = await fetch(avatarUrl);
    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') ?? 'image/png';
    const buffer = Buffer.from(await response.arrayBuffer());
    const dataUri = `data:${contentType};base64,${buffer.toString('base64')}`;
    if (discordAvatarDataUriCache.size >= 64) {
      discordAvatarDataUriCache.delete(discordAvatarDataUriCache.keys().next().value);
    }
    discordAvatarDataUriCache.set(avatarUrl, dataUri);
    return dataUri;
  } catch {
    return null;
  }
}

async function recordDailyPuzzleRatedAttempt(user, session, result) {
  const loadedState = await loadState();
  const userId = user?.id ?? session?.userId;
  const profile = ensureDailyPuzzleRatingProfile(loadedState, user, session);

  loadedState.puzzleRatedAttempts ??= {};
  loadedState.puzzleRatedAttempts[session.dateKey] ??= {};
  loadedState.puzzleRatedAttempts[session.dateKey][userId] ??= {};

  const existing = loadedState.puzzleRatedAttempts[session.dateKey][userId][session.puzzleId];
  if (existing) {
    syncDailyPuzzleRatingProfile(profile, user, session);
    profile.updatedAt = new Date().toISOString();
    await saveState();
    return {
      recorded: false,
      attempt: existing,
      profile,
      summary: getDailyPuzzleRatingRecordSummary(loadedState, userId),
    };
  }

  const rawBefore = Number(profile.rawRating);
  const opponentRating = getDailyPuzzleOpponentRating(session.rating);
  const rawAfter = calculateDailyPuzzleRawRating(rawBefore, opponentRating, result);
  const ratedAt = new Date().toISOString();

  profile.rawRating = rawAfter;
  profile.ratedAttempts += 1;
  syncDailyPuzzleRatingProfile(profile, user, session);
  profile.updatedAt = ratedAt;

  loadedState.puzzleRatedAttempts[session.dateKey][userId][session.puzzleId] = {
    userId,
    dateKey: session.dateKey,
    puzzleId: session.puzzleId,
    result,
    puzzleRating: opponentRating,
    rawBefore,
    rawAfter,
    displayRating: getDailyPuzzleDisplayRating(rawAfter),
    ratedAt,
  };

  await saveState();

  return {
    recorded: true,
    attempt: loadedState.puzzleRatedAttempts[session.dateKey][userId][session.puzzleId],
    profile,
    summary: getDailyPuzzleRatingRecordSummary(loadedState, userId),
  };
}

function normalizeDailyPuzzleDisplayName(value) {
  return String(value ?? '').trim();
}

async function getDailyPuzzleLeaderboardDisplayName(client, record) {
  const storedName = normalizeDailyPuzzleDisplayName(record?.guildDisplayName);
  if (storedName) {
    return storedName;
  }

  const fetchedName = await resolveDailyPuzzleUserDisplayName(
    client,
    record?.userId,
    record?.guildId,
    record?.userTag ?? record?.userId ?? 'User'
  );

  const normalizedFetchedName = normalizeDailyPuzzleDisplayName(fetchedName);
  if (normalizedFetchedName && record && typeof record === 'object') {
    record.guildDisplayName = normalizedFetchedName;
  }

  return normalizedFetchedName || record?.userTag || record?.userId || 'User';
}

export async function resolveDailyPuzzleUserDisplayName(client, userId, guildId, fallback = '') {
  const fallbackName = normalizeDailyPuzzleDisplayName(fallback) || String(userId ?? 'User');

  if (!client || !userId || !guildId) {
    return fallbackName;
  }

  try {
    const guild = client.guilds?.cache?.get(guildId) ?? await client.guilds?.fetch?.(guildId);
    if (!guild) {
      return fallbackName;
    }

    const member = guild.members?.cache?.get(userId) ?? await guild.members?.fetch?.(userId);
    return normalizeDailyPuzzleDisplayName(
      member?.displayName
        ?? member?.user?.globalName
        ?? member?.user?.username
        ?? fallbackName
    ) || fallbackName;
  } catch {
    return fallbackName;
  }
}

function createPostKey(guildId, dateKey) {
  return `${guildId}:${dateKey}`;
}

function normalizeSanForCompare(value) {
  return String(value ?? '')
    .trim()
    .replace(/^\d+\s*\.\.\.\s*/, '')
    .replace(/^\d+\s*\.\s*/, '')
    .replace(/0/g, 'O')
    .replace(/[+#]/g, '')
    .replace(/[?!]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizeUci(value) {
  const match = String(value ?? '')
    .trim()
    .toLowerCase()
    .match(/^([a-h][1-8])[-\s]?([a-h][1-8])([qrbn])?$/);

  if (!match) {
    return null;
  }

  return `${match[1]}${match[2]}${match[3] ?? ''}`;
}

function normalizeLooseSanInput(value) {
  let input = String(value ?? '').trim();

  if (!input) {
    return input;
  }

  input = input.replace(/0/g, 'O');

  if (/^o-o-o[+#]?$/i.test(input)) {
    return input.replace(/o/gi, 'O');
  }

  if (/^o-o[+#]?$/i.test(input)) {
    return input.replace(/o/gi, 'O');
  }

  const hasPiecePrefix = /^[kqrbn]/i.test(input);

  // G7 -> g7, EXD5 -> exd5, QXH7+ -> qxh7+ 로 일단 정리
  input = input.toLowerCase();

  // qxh7+ -> Qxh7+, nf3 -> Nf3
  if (hasPiecePrefix) {
    input = input[0].toUpperCase() + input.slice(1);
  }

  // e8=q -> e8=Q, axb8=n+ -> axb8=N+
  input = input.replace(/=([qrbn])([+#])?$/i, (_, piece, suffix = '') => {
    return `=${piece.toUpperCase()}${suffix}`;
  });

  return input;
}

export function isDailyPuzzleAbandonCommand(value) {
  return /^(포기|그만|취소|cancel|quit)$/i.test(String(value ?? '').trim());
}

export function createDailyPuzzleAbandonAnnouncement(userId) {
  return `<@${userId}> 님이 일일퍼즐을 포기했다냥. 오늘 다시 도전할 수 있다냥!`;
}

export function isDailyPuzzleSessionExpired(session, todayKey) {
  return Boolean(session?.dateKey && session.dateKey !== todayKey);
}

function isValidPersistedDailyPuzzleSession(session) {
  return Boolean(
    session
    && typeof session.userId === 'string'
    && typeof session.dateKey === 'string'
    && typeof session.puzzleId === 'string'
    && typeof session.currentFen === 'string'
    && Array.isArray(session.solutionMoves)
    && typeof session.index === 'number'
    && typeof session.startedAtMs === 'number'
    && typeof session.sourceChannelId === 'string'
  );
}

function parseCommaSeparatedValues(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function clampInteger(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
