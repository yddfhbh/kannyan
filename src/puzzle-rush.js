import 'dotenv/config';

import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AttachmentBuilder, MessageFlags } from 'discord.js';
import {
  buildPlayablePuzzleFromPoolItem,
  getMoveFromUci,
  isMatchingExpectedMove,
  readPuzzlePool,
  renderPuzzleImage,
  resolveDailyPuzzleUserDisplayName,
  tryApplyUserMove,
} from './daily-chess-puzzle.js';

const statePath = fileURLToPath(new URL('../data/puzzle-rush-sessions.json', import.meta.url));
const puzzleRushPoolPath = fileURLToPath(new URL('../data/lichess-puzzle-rush-pool.jsonl', import.meta.url));
const dailyPuzzlePoolPath = fileURLToPath(new URL('../data/lichess-puzzle-pool.jsonl', import.meta.url));

export const PUZZLE_RUSH_CONFIG = {
  START_LIVES: 3,
  START_RATING: 800,
  MIN_RATING: 800,
  MAX_RATING: 3200,
  RATING_PER_SOLVE: 40,
  RATING_BONUS_EVERY: 5,
  RATING_BONUS_AMOUNT: 50,
  SEARCH_WINDOW_INITIAL: 75,
  SEARCH_WINDOW_SECOND: 150,
  SEARCH_WINDOW_THIRD: 250,
  SESSION_IDLE_MS: 60 * 60 * 1000,
  GIVE_UP_WORDS: ['포기', '그만', '중단', 'gg', 'GG'],
};

const puzzleRushCheckIntervalMs = Math.max(
  30_000,
  Number(process.env.PUZZLE_RUSH_CHECK_INTERVAL_MS) || 60_000
);
const puzzleRushFinishedHistoryLimit = 100;

const activePuzzleRushSessions = new Map();

let state = null;
let stateSaveQueue = Promise.resolve();
let timer = null;
let puzzleRushPool = null;

export function initPuzzleRush(client) {
  if (timer) {
    clearInterval(timer);
  }

  void hydratePuzzleRushSessions(client).catch((error) => {
    console.error('Failed to initialize puzzle rush sessions:');
    console.error(error);
  });

  timer = setInterval(() => {
    void expirePuzzleRushSessions(client).catch((error) => {
      console.error('Failed to expire puzzle rush sessions:');
      console.error(error);
    });
  }, puzzleRushCheckIntervalMs);

  console.log('Puzzle rush enabled.');
}

export async function handlePuzzleRushMessage(message) {
  const content = message.content?.trim() ?? '';

  if (!message.guild) {
    const session = await getActivePuzzleRushSession(message.author.id, message.client);

    if (/^%퍼즐러쉬\s*$/i.test(content)) {
      if (!session) {
        await message.reply({
          content: '퍼즐러쉬는 서버 채널에서 `%퍼즐러쉬` 또는 `/퍼즐러쉬`로 시작해달라냥.',
          allowedMentions: {
            repliedUser: false,
          },
        });
        return true;
      }

      const resent = await resendPuzzleRushPuzzle(message.author, session, {
        prefix: '현재 진행 중인 퍼즐을 다시 보냈다냥.',
      });

      await message.reply({
        content: resent
          ? '이미 DM에서 진행 중이다냥. 현재 퍼즐을 다시 보냈다냥.'
          : '이미 DM에서 진행 중이다냥. 다만 DM 재전송은 실패했다냥.',
        allowedMentions: {
          repliedUser: false,
        },
      });
      return true;
    }

    if (!session) {
      return false;
    }

    if (isPuzzleRushGiveUpCommand(content)) {
      await finishPuzzleRushSession({
        client: message.client,
        session,
        reason: 'give_up',
      });
      await message.reply({
        content: '퍼즐러쉬를 종료했다냥. 결과는 원래 채널에 보냈다냥.',
        allowedMentions: {
          repliedUser: false,
        },
      });
      return true;
    }

    let answerText = content;

    if (answerText.startsWith('%') && !/^%퍼즐러쉬\s*$/i.test(answerText)) {
      answerText = answerText.slice(1).trim();
    }

    if (answerText.startsWith('/')) {
      return false;
    }

    await handlePuzzleRushAnswer(message, session, answerText);
    return true;
  }

  if (!/^%퍼즐러쉬\s*$/i.test(content)) {
    return false;
  }

  const result = await startPuzzleRushForUser({
    client: message.client,
    user: message.author,
    guildId: message.guildId,
    channelId: message.channelId,
  });

  await message.reply({
    content: createPuzzleRushStartResultText(result),
    allowedMentions: {
      repliedUser: false,
    },
  });
  return true;
}

export async function handlePuzzleRushInteraction(interaction) {
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  const result = await startPuzzleRushForUser({
    client: interaction.client,
    user: interaction.user,
    guildId: interaction.guildId ?? null,
    channelId: interaction.channelId ?? null,
  });

  await interaction.editReply(createPuzzleRushStartResultText(result));
}

async function startPuzzleRushForUser({
  client,
  user,
  guildId,
  channelId,
}) {
  if (!guildId || !channelId) {
    return {
      ok: false,
      reason: 'SERVER_CONTEXT_REQUIRED',
    };
  }

  const activeSession = await getActivePuzzleRushSession(user.id, client);
  if (activeSession) {
    const resent = await resendPuzzleRushPuzzle(user, activeSession, {
      prefix: '현재 진행 중인 퍼즐을 다시 보냈다냥.',
    });
    return {
      ok: true,
      alreadyActive: true,
      resent,
    };
  }

  const session = createPuzzleRushSession({
    user,
    guildId,
    channelId,
  });

  try {
    await assignNextPuzzleToSession(session);
  } catch (error) {
    console.error('Failed to create the first puzzle rush puzzle:');
    console.error(error);
    return {
      ok: false,
      reason: 'PUZZLE_FAILED',
      error,
    };
  }

  activePuzzleRushSessions.set(session.userId, session);
  await persistPuzzleRushSession(session);

  try {
    await sendPuzzleRushPuzzle(user, session, {
      prefix: '퍼즐러쉬 시작이다냥!',
    });
  } catch (error) {
    console.error(`Failed to send puzzle rush DM to ${user.tag}:`);
    console.error(error);
    activePuzzleRushSessions.delete(session.userId);
    await deletePersistedPuzzleRushSession(session.userId);
    return {
      ok: false,
      reason: 'DM_FAILED',
    };
  }

  return {
    ok: true,
    alreadyActive: false,
  };
}

function createPuzzleRushSession({
  user,
  guildId,
  channelId,
}) {
  const now = new Date().toISOString();
  return {
    userId: user.id,
    userTag: user.tag,
    guildId,
    channelId,
    startedAt: now,
    updatedAt: now,
    status: 'active',
    lives: PUZZLE_RUSH_CONFIG.START_LIVES,
    solvedCount: 0,
    wrongCount: 0,
    startRating: PUZZLE_RUSH_CONFIG.START_RATING,
    currentTargetRating: PUZZLE_RUSH_CONFIG.START_RATING,
    highestRating: PUZZLE_RUSH_CONFIG.START_RATING,
    currentPuzzleId: null,
    currentFen: null,
    solutionMoves: [],
    solutionIndex: 0,
    currentPuzzleRating: null,
    currentPuzzleThemes: [],
    currentTurnText: null,
    usedPuzzleIds: [],
  };
}

async function handlePuzzleRushAnswer(message, session, answerText = null) {
  const rawInput = answerText ?? message.content?.trim() ?? '';

  if (!rawInput) {
    return;
  }

  const expectedUci = session.solutionMoves[session.solutionIndex];
  if (!expectedUci) {
    activePuzzleRushSessions.delete(session.userId);
    await deletePersistedPuzzleRushSession(session.userId);
    await message.reply({
      content: '퍼즐러쉬 세션 상태가 이상해서 종료했다냥. 서버 채널에서 `%퍼즐러쉬`로 다시 시작해달라냥.',
      allowedMentions: {
        repliedUser: false,
      },
    });
    return;
  }

  let expectedMove;

  try {
    expectedMove = getMoveFromUci(session.currentFen, expectedUci);
  } catch (error) {
    console.error('Failed to apply expected puzzle rush move:');
    console.error(error);
    activePuzzleRushSessions.delete(session.userId);
    await deletePersistedPuzzleRushSession(session.userId);
    await message.reply({
      content: '퍼즐러쉬 처리 중 오류가 나서 종료했다냥. 서버 채널에서 `%퍼즐러쉬`로 다시 시작해달라냥.',
      allowedMentions: {
        repliedUser: false,
      },
    });
    return;
  }

  const userMateMove = tryApplyUserMove(session.currentFen, rawInput);

  if (
    !isMatchingExpectedMove(rawInput, expectedMove)
    && !(isPuzzleRushMateInOneSession(session) && userMateMove?.isCheckmate)
  ) {
    await handlePuzzleRushWrongAnswer(message, session, expectedMove);
    return;
  }

  if (userMateMove?.isCheckmate && isPuzzleRushMateInOneSession(session)) {
    session.currentFen = userMateMove.nextFen;
    session.solutionIndex = session.solutionMoves.length;
    await handlePuzzleRushSolved(message, session);
    return;
  }

  session.currentFen = expectedMove.nextFen;
  session.solutionIndex += 1;

  if (session.solutionIndex >= session.solutionMoves.length) {
    await handlePuzzleRushSolved(message, session);
    return;
  }

  const opponentUci = session.solutionMoves[session.solutionIndex];
  let opponentMove;

  try {
    opponentMove = getMoveFromUci(session.currentFen, opponentUci);
  } catch (error) {
    console.error('Failed to apply opponent puzzle rush move:');
    console.error(error);
    activePuzzleRushSessions.delete(session.userId);
    await deletePersistedPuzzleRushSession(session.userId);
    await message.reply({
      content: '상대 수 처리 중 오류가 나서 퍼즐러쉬를 종료했다냥. 서버 채널에서 `%퍼즐러쉬`로 다시 시작해달라냥.',
      allowedMentions: {
        repliedUser: false,
      },
    });
    return;
  }

  session.currentFen = opponentMove.nextFen;
  session.solutionIndex += 1;

  if (session.solutionIndex >= session.solutionMoves.length) {
    await handlePuzzleRushSolved(message, session);
    return;
  }

  touchPuzzleRushSession(session);
  await persistPuzzleRushSession(session);

  await message.reply({
    content: [
      `맞았다냥! 상대는 \`${opponentMove.san}\` 뒀다냥.`,
      `남은 목숨: **${session.lives}개**`,
      '다음 수를 입력해달라냥.',
    ].join('\n'),
    allowedMentions: {
      repliedUser: false,
    },
  });
}

async function handlePuzzleRushSolved(message, session) {
  session.solvedCount += 1;

  try {
    await assignNextPuzzleToSession(session);
  } catch (error) {
    console.error('Failed to assign the next puzzle rush puzzle:');
    console.error(error);
    await finishPuzzleRushSession({
      client: message.client,
      session,
      reason: 'pool_exhausted',
    });
    await message.reply({
      content: '정답이다냥! 더 이어서 낼 퍼즐을 찾지 못해서 여기서 종료했다냥.',
      allowedMentions: {
        repliedUser: false,
      },
    });
    return;
  }

  await persistPuzzleRushSession(session);

  await message.reply({
    content: [
      `정답이다냥! 지금까지 **${session.solvedCount}개** 풀었다냥.`,
      `다음 목표 레이팅: **${session.currentTargetRating}**`,
      '다음 퍼즐을 보낸다냥.',
    ].join('\n'),
    allowedMentions: {
      repliedUser: false,
    },
  });

  try {
    await sendPuzzleRushPuzzle(message.author, session, {
      prefix: '다음 퍼즐이다냥!',
    });
  } catch (error) {
    console.error(`Failed to send next puzzle rush DM to ${message.author.tag}:`);
    console.error(error);
    await finishPuzzleRushSession({
      client: message.client,
      session,
      reason: 'dm_failed_mid_session',
    });
    await message.reply({
      content: '다음 퍼즐 DM 전송에 실패해서 여기서 종료했다냥. 결과는 원래 채널에 보냈다냥.',
      allowedMentions: {
        repliedUser: false,
      },
    });
  }
}

async function handlePuzzleRushWrongAnswer(message, session, expectedMove) {
  session.lives = Math.max(0, Number(session.lives) - 1);
  session.wrongCount += 1;

  if (session.lives <= 0) {
    await finishPuzzleRushSession({
      client: message.client,
      session,
      reason: 'lives_depleted',
    });
    await message.reply({
      content: [
        `틀렸다냥. 정답은 \`${expectedMove.san}\`였다냥.`,
        '목숨이 0개가 돼서 퍼즐러쉬를 종료했다냥. 결과는 원래 채널에 보냈다냥.',
      ].join('\n'),
      allowedMentions: {
        repliedUser: false,
      },
    });
    return;
  }

  try {
    await assignNextPuzzleToSession(session);
  } catch (error) {
    console.error('Failed to assign a replacement puzzle rush puzzle:');
    console.error(error);
    await finishPuzzleRushSession({
      client: message.client,
      session,
      reason: 'pool_exhausted',
    });
    await message.reply({
      content: [
        `틀렸다냥. 정답은 \`${expectedMove.san}\`였다냥.`,
        '다음 퍼즐을 찾지 못해서 여기서 종료했다냥. 결과는 원래 채널에 보냈다냥.',
      ].join('\n'),
      allowedMentions: {
        repliedUser: false,
      },
    });
    return;
  }

  await persistPuzzleRushSession(session);

  await message.reply({
    content: [
      `틀렸다냥. 정답은 \`${expectedMove.san}\`였다냥.`,
      `목숨이 1 줄어서 **${session.lives}개** 남았다냥.`,
      '다음 퍼즐을 보낸다냥.',
    ].join('\n'),
    allowedMentions: {
      repliedUser: false,
    },
  });

  try {
    await sendPuzzleRushPuzzle(message.author, session, {
      prefix: '다음 퍼즐이다냥!',
    });
  } catch (error) {
    console.error(`Failed to send replacement puzzle rush DM to ${message.author.tag}:`);
    console.error(error);
    await finishPuzzleRushSession({
      client: message.client,
      session,
      reason: 'dm_failed_mid_session',
    });
    await message.reply({
      content: '다음 퍼즐 DM 전송에 실패해서 여기서 종료했다냥. 결과는 원래 채널에 보냈다냥.',
      allowedMentions: {
        repliedUser: false,
      },
    });
  }
}

async function assignNextPuzzleToSession(session) {
  const targetRating = calculatePuzzleRushTargetRating(session.solvedCount);
  const pool = await readPuzzleRushPool();
  const candidates = rankPuzzleRushPoolItems(pool, {
    usedPuzzleIds: session.usedPuzzleIds,
    targetRating,
  });

  if (candidates.length === 0) {
    throw new Error('No unused puzzle rush candidates remain.');
  }

  let puzzle = null;

  for (const item of candidates) {
    try {
      puzzle = buildPlayablePuzzleFromPoolItem(item);
      break;
    } catch (error) {
      console.error(`Skipping invalid puzzle rush candidate ${item?.id ?? 'unknown'}:`);
      console.error(error);
    }
  }

  if (!puzzle) {
    throw new Error('No valid puzzle rush candidate could be prepared.');
  }

  session.currentPuzzleId = puzzle.id;
  session.currentFen = puzzle.playFen;
  session.solutionMoves = puzzle.solutionMoves;
  session.solutionIndex = 0;
  session.currentPuzzleRating = puzzle.rating;
  session.currentPuzzleThemes = Array.isArray(puzzle.themes) ? [...puzzle.themes] : [];
  session.currentTurnText = puzzle.turnText;
  session.currentTargetRating = targetRating;
  session.highestRating = Math.max(Number(session.highestRating) || 0, targetRating);

  const usedPuzzleIds = new Set(session.usedPuzzleIds ?? []);
  usedPuzzleIds.add(puzzle.id);
  session.usedPuzzleIds = [...usedPuzzleIds];

  touchPuzzleRushSession(session);
}

async function readPuzzleRushPool() {
  if (puzzleRushPool) {
    return puzzleRushPool;
  }

  puzzleRushPool = await readJsonlPoolFile(puzzleRushPoolPath).catch(async (error) => {
    if (error?.code !== 'ENOENT') {
      throw error;
    }

    console.warn('Puzzle rush pool file not found. Falling back to the daily puzzle pool.');
    return readJsonlPoolFile(dailyPuzzlePoolPath);
  });

  console.log(`Loaded ${puzzleRushPool.length} puzzle rush puzzle(s).`);
  return puzzleRushPool;
}

async function readJsonlPoolFile(path) {
  const raw = await fs.readFile(path, 'utf8');
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function sendPuzzleRushPuzzle(user, session, { prefix } = {}) {
  const image = await renderPuzzleImage({
    fen: session.currentFen,
    title: `Lichess Puzzle Rush ${session.currentPuzzleId}`,
    subtitle: `${session.currentTurnText} 차례 · 난이도 ${session.currentPuzzleRating} · 목표 ${session.currentTargetRating}`,
    flipped: getFenSideToMove(session.currentFen) === 'b',
  });

  const attachment = new AttachmentBuilder(image, {
    name: `lichess-puzzle-rush-${session.currentPuzzleId}.png`,
  });

  await user.send({
    content: [
      prefix,
      `**${session.currentTurnText} 차례**다냥.`,
      `현재 목표 레이팅: **${session.currentTargetRating}**`,
      `퍼즐 난이도: **${session.currentPuzzleRating}**`,
      `정답: **${session.solvedCount}개** · 오답: **${session.wrongCount}개** · 목숨: **${session.lives}개**`,
      session.currentPuzzleThemes?.length
        ? `테마: ${session.currentPuzzleThemes.slice(0, 5).join(', ')}`
        : '',
      '',
      '수를 SAN 또는 UCI로 보내면 된다냥.',
      '예: `Nf3+`, `Qh7#`, `e2e4`, `O-O`',
      '`포기`, `그만`, `중단`, `gg` 중 하나를 보내면 종료한다냥.',
      '1시간 동안 입력이 없으면 세션이 자동 종료된다냥.',
    ].filter(Boolean).join('\n'),
    files: [attachment],
  });
}

async function resendPuzzleRushPuzzle(user, session, { prefix } = {}) {
  try {
    await sendPuzzleRushPuzzle(user, session, { prefix });
    return true;
  } catch (error) {
    console.error(`Failed to resend puzzle rush DM to ${user.tag}:`);
    console.error(error);
    return false;
  }
}

async function finishPuzzleRushSession({
  client,
  session,
  reason,
}) {
  const finalized = {
    ...session,
    status: 'finished',
    finishedAt: new Date().toISOString(),
    finishReason: reason,
    updatedAt: new Date().toISOString(),
  };

  activePuzzleRushSessions.delete(session.userId);
  await saveFinishedPuzzleRushSession(finalized);
  await announcePuzzleRushResult(client, finalized);
}

async function announcePuzzleRushResult(client, session) {
  if (!client?.channels?.fetch) {
    return;
  }

  const channel = await client.channels.fetch(session.channelId).catch((error) => {
    console.error(`Failed to fetch puzzle rush result channel ${session.channelId}:`);
    console.error(error);
    return null;
  });

  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
    return;
  }

  const user = await client.users.fetch(session.userId).catch(() => null);
  const displayName = await resolveDailyPuzzleUserDisplayName(
    client,
    session.userId,
    session.guildId,
    user?.globalName ?? user?.username ?? session.userTag ?? `${session.userId}`
  );

  try {
    await channel.send({
      content: createPuzzleRushResultMessage(displayName, session),
      allowedMentions: {
        parse: [],
      },
    });
  } catch (error) {
    console.error(`Failed to announce puzzle rush result for ${session.userId}:`);
    console.error(error);
  }
}

async function hydratePuzzleRushSessions(client) {
  const loadedState = await loadState();
  let changed = false;

  for (const [userId, session] of Object.entries(loadedState.sessions ?? {})) {
    if (!isValidPuzzleRushSession(session)) {
      delete loadedState.sessions[userId];
      changed = true;
      continue;
    }

    activePuzzleRushSessions.set(userId, session);
  }

  if (changed) {
    await saveState();
  }

  await expirePuzzleRushSessions(client);
  console.log(`Restored ${activePuzzleRushSessions.size} active puzzle rush session(s).`);
}

async function expirePuzzleRushSessions(client) {
  const loadedState = await loadState();
  const expiredSessions = [];
  let changed = false;

  for (const [userId, session] of Object.entries(loadedState.sessions ?? {})) {
    if (!isValidPuzzleRushSession(session)) {
      delete loadedState.sessions[userId];
      activePuzzleRushSessions.delete(userId);
      changed = true;
      continue;
    }

    if (!isPuzzleRushSessionExpired(session)) {
      continue;
    }

    expiredSessions.push(session);
  }

  for (const session of expiredSessions) {
    await finishPuzzleRushSession({
      client,
      session,
      reason: 'idle_timeout',
    });
  }

  if (changed && expiredSessions.length === 0) {
    await saveState();
  }
}

async function getActivePuzzleRushSession(userId, client) {
  await expirePuzzleRushSessions(client);

  const cached = activePuzzleRushSessions.get(userId);
  if (cached) {
    return cached;
  }

  const loadedState = await loadState();
  const session = loadedState.sessions?.[userId];

  if (!isValidPuzzleRushSession(session)) {
    return null;
  }

  activePuzzleRushSessions.set(userId, session);
  return session;
}

async function persistPuzzleRushSession(session) {
  const loadedState = await loadState();
  loadedState.sessions ??= {};
  loadedState.sessions[session.userId] = sanitizePuzzleRushSession(session);
  await saveState();
}

async function deletePersistedPuzzleRushSession(userId) {
  const loadedState = await loadState();

  if (loadedState.sessions?.[userId]) {
    delete loadedState.sessions[userId];
    await saveState();
  }
}

async function saveFinishedPuzzleRushSession(session) {
  const loadedState = await loadState();
  loadedState.sessions ??= {};
  loadedState.finished ??= [];

  delete loadedState.sessions[session.userId];
  loadedState.finished.unshift({
    ...sanitizePuzzleRushSession(session),
    finishedAt: session.finishedAt,
    finishReason: session.finishReason,
  });
  loadedState.finished = loadedState.finished.slice(0, puzzleRushFinishedHistoryLimit);

  await saveState();
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

  state.sessions ??= {};
  state.finished ??= [];
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

function sanitizePuzzleRushSession(session) {
  return {
    userId: session.userId,
    userTag: session.userTag,
    guildId: session.guildId,
    channelId: session.channelId,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    status: session.status,
    lives: session.lives,
    solvedCount: session.solvedCount,
    wrongCount: session.wrongCount,
    startRating: session.startRating,
    currentTargetRating: session.currentTargetRating,
    highestRating: session.highestRating,
    currentPuzzleId: session.currentPuzzleId,
    currentFen: session.currentFen,
    solutionMoves: session.solutionMoves,
    solutionIndex: session.solutionIndex,
    currentPuzzleRating: session.currentPuzzleRating,
    currentPuzzleThemes: session.currentPuzzleThemes,
    currentTurnText: session.currentTurnText,
    usedPuzzleIds: session.usedPuzzleIds,
  };
}

function touchPuzzleRushSession(session) {
  session.updatedAt = new Date().toISOString();
}

export function calculatePuzzleRushTargetRating(solvedCount, config = PUZZLE_RUSH_CONFIG) {
  const safeSolvedCount = Math.max(0, Math.trunc(Number(solvedCount) || 0));
  const bonusCount = Math.floor(safeSolvedCount / config.RATING_BONUS_EVERY);
  const rawTarget =
    config.START_RATING
    + safeSolvedCount * config.RATING_PER_SOLVE
    + bonusCount * config.RATING_BONUS_AMOUNT;

  return clampInteger(rawTarget, config.MIN_RATING, config.MAX_RATING);
}

export function choosePuzzleRushPoolItem(pool, { usedPuzzleIds = [], targetRating } = {}) {
  return rankPuzzleRushPoolItems(pool, { usedPuzzleIds, targetRating })[0] ?? null;
}

function rankPuzzleRushPoolItems(pool, { usedPuzzleIds = [], targetRating } = {}) {
  const safeTargetRating = Number.isFinite(targetRating)
    ? targetRating
    : PUZZLE_RUSH_CONFIG.START_RATING;
  const usedSet = new Set(usedPuzzleIds);
  const entries = [];

  for (const item of pool ?? []) {
    if (!item?.id || usedSet.has(item.id)) {
      continue;
    }

    const rating = Number(item.rating);
    if (!Number.isFinite(rating)) {
      continue;
    }

    entries.push({
      item,
      rating,
      distance: Math.abs(rating - safeTargetRating),
    });
  }

  const windows = [
    PUZZLE_RUSH_CONFIG.SEARCH_WINDOW_INITIAL,
    PUZZLE_RUSH_CONFIG.SEARCH_WINDOW_SECOND,
    PUZZLE_RUSH_CONFIG.SEARCH_WINDOW_THIRD,
  ];

  for (const window of windows) {
    const matches = entries.filter((entry) => entry.distance <= window);
    if (matches.length > 0) {
      return sortPuzzleRushEntries(matches).map((entry) => entry.item);
    }
  }

  return sortPuzzleRushEntries(entries).map((entry) => entry.item);
}

function sortPuzzleRushEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }

    if (a.rating !== b.rating) {
      return a.rating - b.rating;
    }

    return String(a.item?.id ?? '').localeCompare(String(b.item?.id ?? ''));
  });
}

export function isPuzzleRushGiveUpCommand(value) {
  const normalized = String(value ?? '').trim();
  return PUZZLE_RUSH_CONFIG.GIVE_UP_WORDS.some((word) => word.toLowerCase() === normalized.toLowerCase());
}

function isPuzzleRushMateInOneSession(session) {
  return session.solutionMoves.length === 1 && session.currentPuzzleThemes?.includes?.('mateIn1');
}

export function isPuzzleRushSessionExpired(
  session,
  nowMs = Date.now(),
  idleMs = PUZZLE_RUSH_CONFIG.SESSION_IDLE_MS
) {
  const updatedAtMs = Date.parse(session?.updatedAt ?? '');
  if (!Number.isFinite(updatedAtMs)) {
    return true;
  }

  return nowMs - updatedAtMs >= idleMs;
}

export function createPuzzleRushStartResultText(result) {
  if (result.ok && result.alreadyActive) {
    return result.resent
      ? '이미 DM에서 퍼즐러쉬를 진행 중이다냥. 현재 퍼즐을 다시 보냈다냥.'
      : '이미 DM에서 퍼즐러쉬를 진행 중이다냥. 다만 DM 재전송은 실패했다냥.';
  }

  if (result.ok) {
    return 'DM으로 퍼즐러쉬를 보냈다냥.';
  }

  if (result.reason === 'SERVER_CONTEXT_REQUIRED') {
    return '퍼즐러쉬는 서버 채널에서 `%퍼즐러쉬` 또는 `/퍼즐러쉬`로 시작해달라냥.';
  }

  if (result.reason === 'DM_FAILED') {
    return 'DM을 보낼 수 없다냥. Discord 개인정보 설정에서 서버 멤버의 DM을 허용해달라냥.';
  }

  if (result.reason === 'PUZZLE_FAILED') {
    return `퍼즐러쉬용 퍼즐을 준비하지 못했다냥.\n원인: ${result.error?.message ?? '알 수 없음'}`;
  }

  return '퍼즐러쉬를 시작하지 못했다냥.';
}

export function createPuzzleRushResultMessage(displayName, session) {
  const safeDisplayName = String(displayName ?? '사용자').trim() || '사용자';
  const lines = [
    `🏁 ${safeDisplayName}님의 퍼즐러쉬 종료!`,
    `정답: ${Math.max(0, Math.trunc(Number(session?.solvedCount) || 0))}개`,
    `오답: ${Math.max(0, Math.trunc(Number(session?.wrongCount) || 0))}개`,
    `최고 도달 레이팅: ${Math.max(0, Math.trunc(Number(session?.highestRating) || 0))}`,
    `남은 목숨: ${Math.max(0, Math.trunc(Number(session?.lives) || 0))}개`,
  ];

  if (session?.finishReason === 'idle_timeout') {
    lines.push('1시간 동안 입력이 없어서 자동 종료됐다냥.');
  } else {
    lines.push('수고했다냥.');
  }

  return lines.join('\n');
}

function getFenSideToMove(fen) {
  return String(fen ?? '').split(/\s+/)[1];
}

function clampInteger(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function isValidPuzzleRushSession(session) {
  return Boolean(
    session
    && session.status === 'active'
    && typeof session.userId === 'string'
    && typeof session.guildId === 'string'
    && typeof session.channelId === 'string'
    && typeof session.startedAt === 'string'
    && typeof session.updatedAt === 'string'
    && typeof session.currentPuzzleId === 'string'
    && typeof session.currentFen === 'string'
    && Array.isArray(session.solutionMoves)
    && typeof session.solutionIndex === 'number'
    && Array.isArray(session.usedPuzzleIds)
  );
}
