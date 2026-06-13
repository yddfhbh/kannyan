import 'dotenv/config';

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderSvgToPng } from './svg-renderer.js';
import {
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { Chess } from 'chess.js';

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

const activeSessions = new Map();

let state = null;
let stateSaveQueue = Promise.resolve();
let timer = null;
let puzzlePool = null;

export function initDailyChessPuzzle(client) {
  if (timer) {
    clearInterval(timer);
  }

  void hydrateDailyPuzzleSessions(client)
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

    const session = await getActiveDailyPuzzleSession(message.author.id, message.client);
    if (!session) {
      return false;
    }

    if (isDailyPuzzleFailureCommand(content)) {
      await failDailyPuzzleSession(message.client, message.author, session);
      await message.reply({
        content: createDailyPuzzleFailureAnnouncement(message.author.id),
        allowedMentions: {
          users: [message.author.id],
          repliedUser: false,
        },
      });
      return true;
    }

    if (/^(포기|그만|취소|cancel|quit)$/i.test(content)) {
      activeSessions.delete(message.author.id);
      await deletePersistedDailyPuzzleSession(message.author.id);
      await message.reply('이번 일일퍼즐 시도를 취소했다냥.');
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

async function startDailyPuzzleForUser({
  client,
  user,
  sourceGuildId,
  startedAtMs = Date.now(),
}) {
  const loadedState = await loadState();

  const announcementConfig = resolveAnnouncementConfig(loadedState, sourceGuildId, {
    allowFallback: !sourceGuildId,
  });

  if (!announcementConfig) {
    return { ok: false, reason: 'NO_CHANNEL' };
  }

  const { dateKey } = getKstDateInfo();
  const previousSolve = loadedState.solved[dateKey]?.[user.id];
  const previousFailure = loadedState.failed[dateKey]?.[user.id];

  if (previousSolve) {
    return {
      ok: true,
      alreadySolved: true,
      elapsedMs: previousSolve.elapsedMs,
      dateKey,
    };
  }

  if (previousFailure) {
    return {
      ok: true,
      alreadyFailed: true,
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

  const previousSession = await getActiveDailyPuzzleSession(user.id, client);
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
    sourceChannelId: announcementConfig.channelId,
    rating: puzzle.rating,
    themes: puzzle.themes,
    gameUrl: puzzle.gameUrl,
    turnText: puzzle.turnText,
  };

  activeSessions.set(user.id, session);
  await persistDailyPuzzleSession(session);

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
        '`실패`라고 보내면 실패 처리되고 퍼즐 채널에 알려진다냥.',
        '`포기`라고 보내면 공개 실패 없이 이번 시도를 취소한다냥.',
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
    await message.reply('틀렸다냥. 다시 생각해보라냥.');
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
  const recordResult = await recordDailyPuzzleSolve(message.author, session, elapsedMs);

  activeSessions.delete(message.author.id);
  await deletePersistedDailyPuzzleSession(message.author.id);

  if (!recordResult.recorded) {
    await message.reply(
      `오늘 퍼즐은 이미 풀었다냥. 기록은 ${formatElapsed(recordResult.previous.elapsedMs)}이다냥.`
    );
    return;
  }

  await message.reply(`정답이다냥! ${formatElapsed(elapsedMs)} 만에 풀었다냥.`);
  await announceDailyPuzzleSolved(message.client, message.author, session, elapsedMs);
}

async function recordDailyPuzzleSolve(user, session, elapsedMs) {
  const loadedState = await loadState();

  loadedState.solved[session.dateKey] ??= {};

  const previous = loadedState.solved[session.dateKey][user.id];

  if (previous) {
    return { recorded: false, previous };
  }

  loadedState.solved[session.dateKey][user.id] = {
    userId: user.id,
    userTag: user.tag,
    elapsedMs,
    solvedAt: new Date().toISOString(),
    guildId: session.sourceGuildId,
    puzzleId: session.puzzleId,
    rating: session.rating,
  };

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

async function failDailyPuzzleSession(client, user, session, reason = 'manual') {
  const recordResult = await recordDailyPuzzleFailure(user, session, reason);

  activeSessions.delete(session.userId);
  await deletePersistedDailyPuzzleSession(session.userId);

  if (recordResult.recorded) {
    await announceDailyPuzzleFailed(client, session);
  }

  return recordResult;
}

async function recordDailyPuzzleFailure(user, session, reason) {
  const loadedState = await loadState();

  loadedState.failed[session.dateKey] ??= {};

  const previous = loadedState.failed[session.dateKey][session.userId];
  if (previous) {
    return { recorded: false, previous };
  }

  if (loadedState.solved[session.dateKey]?.[session.userId]) {
    return { recorded: false, solved: true };
  }

  loadedState.failed[session.dateKey][session.userId] = {
    userId: session.userId,
    userTag: user?.tag ?? session.userTag ?? null,
    failedAt: new Date().toISOString(),
    guildId: session.sourceGuildId,
    puzzleId: session.puzzleId,
    rating: session.rating,
    reason,
  };

  await saveState();

  return { recorded: true };
}

async function announceDailyPuzzleFailed(client, session) {
  const channel = await client.channels.fetch(session.sourceChannelId).catch((error) => {
    console.error(`Failed to fetch daily puzzle failure channel ${session.sourceChannelId}:`);
    console.error(error);
    return null;
  });

  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
    return;
  }

  try {
    await channel.send({
      content: createDailyPuzzleFailureAnnouncement(session.userId),
      allowedMentions: {
        users: [session.userId],
      },
    });
  } catch (error) {
    console.error(`Failed to announce daily puzzle failure for ${session.userId}:`);
    console.error(error);
  }
}

async function expireDailyPuzzleSessions(client, todayKey = getKstDateInfo().dateKey) {
  const loadedState = await loadState();
  const expiredSessions = Object.values(loadedState.sessions ?? {})
    .filter((session) =>
      isValidPersistedDailyPuzzleSession(session)
      && isDailyPuzzleSessionExpired(session, todayKey)
    );

  for (const session of expiredSessions) {
    await failDailyPuzzleSession(
      client,
      { id: session.userId, tag: session.userTag },
      session,
      'date_changed'
    );
  }
}

async function checkDailyPuzzlePosts(client) {
  const { dateKey, hour } = getKstDateInfo();

  await expireDailyPuzzleSessions(client, dateKey);

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

  let puzzle;

  try {
    puzzle = await getDailyPuzzle(dateKey);
  } catch (error) {
    console.error('Failed to load daily puzzle for scheduled post:');
    console.error(error);
    return;
  }

  const image = await renderPuzzleImage({
    fen: puzzle.playFen,
    title: `${formatKoreanDateKey(dateKey)} 일일 체스 퍼즐`,
    subtitle: `${puzzle.turnText} 차례 · 난이도 ${puzzle.rating}`,
    flipped: getFenSideToMove(puzzle.playFen) === 'b',
  });

  const yesterdayKey = addDaysToDateKey(dateKey, -1);
  const content = createDailyPostContent(loadedState, puzzle, dateKey, yesterdayKey);

  for (const [guildId, config] of targets) {
    const channel = await client.channels.fetch(config.channelId).catch((error) => {
      console.error(`Failed to fetch daily puzzle channel ${config.channelId}:`);
      console.error(error);
      return null;
    });

    if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
      continue;
    }

    try {
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

      loadedState.posts[createPostKey(guildId, dateKey)] = {
        guildId,
        channelId: config.channelId,
        messageId: sent.id,
        puzzleId: puzzle.id,
        postedAt: new Date().toISOString(),
      };

      await saveState();
    } catch (error) {
      console.error(`Failed to post daily puzzle to channel ${config.channelId}:`);
      console.error(error);
    }
  }
}

function createDailyPostContent(loadedState, puzzle, dateKey, yesterdayKey) {
  return [
    `**${formatKoreanDateKey(dateKey)} 일일 체스 퍼즐이다냥!**`,
    `${puzzle.turnText} 차례다냥. 난이도는 ${puzzle.rating}이다냥.`,
    '풀려면 %일일퍼즐을 입력하라냥.',
    '',
    createLeaderboardText(loadedState, yesterdayKey),
  ].join('\n');
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

function createLeaderboardText(loadedState, dateKey) {
  const records = Object.values(loadedState.solved[dateKey] ?? {}).sort(
    (a, b) => a.elapsedMs - b.elapsedMs
  );

  if (records.length === 0) {
    return `**어제의 리더보드 (${formatKoreanDateKey(dateKey)})**\n기록이 없다냥.`;
  }

  const lines = records.slice(0, 10).map((record, index) => {
    return `${index + 1}. <@${record.userId}> - ${formatElapsed(record.elapsedMs)}`;
  });

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
  const item = pool[index];

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

async function readPuzzlePool() {
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

function getDailyPuzzleIndex(dateKey, poolLength) {
  const hash = crypto.createHash('sha256').update(`kannyan:${dateKey}`).digest();
  return hash.readUInt32BE(0) % poolLength;
}

function getMoveFromUci(fen, uci) {
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

function tryApplyUserMove(fen, rawInput) {
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
  const sanInput = normalizeLooseSanInput(input);

  try {
    move = chess.move(sanInput, { sloppy: true });
  } catch {
    try {
      move = chess.move(sanInput);
    } catch {
      move = null;
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

function isMatchingExpectedMove(rawInput, expectedMove) {
  const inputSan = normalizeSanForCompare(normalizeLooseSanInput(rawInput));
  const inputUci = normalizeUci(rawInput);

  return (
    inputSan === normalizeSanForCompare(expectedMove.san) ||
    inputUci === expectedMove.uci
  );
}

function isMateInOneSession(session) {
  return session.solutionMoves.length === 1 && session.themes?.includes?.('mateIn1');
}

async function renderPuzzleImage({ fen, title, subtitle, flipped = false }) {
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

async function getPieceImageHref(piece) {
  const pieceName = `${piece.color}${piece.type.toUpperCase()}.svg`;

  if (chessPieceSvgCache.has(pieceName)) {
    return chessPieceSvgCache.get(pieceName);
  }

  const pieceUrl = new URL(pieceName, chessPieceDir);

  try {
    const svg = await fs.readFile(pieceUrl, 'utf8');
    const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

    chessPieceSvgCache.set(pieceName, dataUri);
    return dataUri;
  } catch (error) {
    console.error(`Failed to load chess piece SVG: ${pieceUrl.pathname}`);
    console.error(error);

    const fallbackSvg = createFallbackPieceSvg(piece);
    const dataUri = `data:image/svg+xml;base64,${Buffer.from(fallbackSvg).toString('base64')}`;

    chessPieceSvgCache.set(pieceName, dataUri);
    return dataUri;
  }
}

function createFallbackPieceSvg(piece) {
  const symbol = getPieceSymbol(piece);

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <text x="32" y="48" text-anchor="middle" font-size="48" font-family="Noto Sans CJK KR, Arial">${escapeXml(symbol)}</text>
</svg>`;
}

async function hydrateDailyPuzzleSessions(client) {
  const todayKey = getKstDateInfo().dateKey;

  await expireDailyPuzzleSessions(client, todayKey);

  const loadedState = await loadState();
  let changed = false;

  for (const [userId, session] of Object.entries(loadedState.sessions ?? {})) {
    const isToday = session?.dateKey === todayKey;
    const alreadySolved = Boolean(loadedState.solved?.[session?.dateKey]?.[userId]);
    const alreadyFailed = Boolean(loadedState.failed?.[session?.dateKey]?.[userId]);
    const isValid = isValidPersistedDailyPuzzleSession(session);

    if (!isToday || alreadySolved || alreadyFailed || !isValid) {
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

async function getActiveDailyPuzzleSession(userId, client) {
  await expireDailyPuzzleSessions(client);

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
  const alreadyFailed = Boolean(loadedState.failed?.[session.dateKey]?.[userId]);

  if (
    session.dateKey !== todayKey
    || alreadySolved
    || alreadyFailed
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
  state.solved ??= {};
  state.failed ??= {};
  state.sessions ??= {};

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

function resolveAnnouncementConfig(loadedState, guildId, { allowFallback = false } = {}) {
  if (guildId && loadedState.settings.guilds[guildId]) {
    return {
      guildId,
      channelId: loadedState.settings.guilds[guildId].channelId,
    };
  }

  if (!allowFallback) {
    return null;
  }

  const first = Object.entries(loadedState.settings.guilds)[0];

  if (!first) {
    return null;
  }

  return {
    guildId: first[0],
    channelId: first[1].channelId,
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

function createDailyPuzzleStartResultText(result) {
  if (result.ok && result.alreadySolved) {
    return `오늘 일일퍼즐은 이미 풀었다냥. 기록은 ${formatElapsed(result.elapsedMs)}이다냥.`;
  }

  if (result.ok && result.alreadyFailed) {
    return '오늘 일일퍼즐은 이미 실패 처리됐다냥.';
  }

  if (result.ok) {
    return 'DM으로 일일 체스 퍼즐을 보냈다냥.';
  }

  if (result.reason === 'NO_CHANNEL') {
    return '아직 일일퍼즐 채널이 지정되지 않았다냥. 관리자에게 `/일일퍼즐지정`을 먼저 해달라고 해달라냥.';
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

export function isDailyPuzzleFailureCommand(value) {
  return /^실패$/i.test(String(value ?? '').trim());
}

export function createDailyPuzzleFailureAnnouncement(userId) {
  return `<@${userId}> 님이 퍼즐에게서 도망쳤다냥`;
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
