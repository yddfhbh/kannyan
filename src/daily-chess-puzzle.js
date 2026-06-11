import 'dotenv/config';

import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { Chess } from 'chess.js';

const dailyPuzzleStatePath = fileURLToPath(
  new URL('../data/daily-chess-puzzle.json', import.meta.url)
);

const chessPuzzleDailyApiUrl = 'https://chesspuzzle.net/Daily/Api';
const chessPuzzleBaseUrl = 'https://chesspuzzle.net';

const defaultDailyPuzzleAdminId = '635107514471415808';

const dailyPuzzleAdminIds = new Set([
  defaultDailyPuzzleAdminId,
  ...parseCommaSeparatedValues(process.env.DAILY_CHESS_PUZZLE_ADMIN_IDS),
]);

const dailyPuzzlePostHour = clampInteger(
  Number(process.env.DAILY_CHESS_PUZZLE_HOUR) || 12,
  0,
  23
);

const dailyPuzzleCheckIntervalMs = Math.max(
  30_000,
  Number(process.env.DAILY_CHESS_PUZZLE_CHECK_INTERVAL_MS) || 60_000
);

const dailyPuzzleFetchTimeoutMs = Math.max(
  5_000,
  Number(process.env.DAILY_CHESS_PUZZLE_FETCH_TIMEOUT_MS) || 20_000
);

const activeSessions = new Map();
const dailyPuzzleCache = new Map();

let dailyPuzzleState = null;
let dailyPuzzleSaveQueue = Promise.resolve();
let dailyPuzzleTimer = null;

export function initDailyChessPuzzle(client) {
  if (dailyPuzzleTimer) {
    clearInterval(dailyPuzzleTimer);
  }

  void hydrateDailyPuzzleSessions();
  void checkDailyPuzzlePosts(client);

  dailyPuzzleTimer = setInterval(() => {
    void checkDailyPuzzlePosts(client);
  }, dailyPuzzleCheckIntervalMs);

  console.log(
    `Daily chess puzzle enabled. Post hour: ${dailyPuzzlePostHour}:00 KST`
  );
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

    const session = await getActiveDailyPuzzleSession(message.author.id);
if (!session) {
  return false;
}

    if (/^(포기|그만|취소|cancel|quit)$/i.test(content)) {
      activeSessions.delete(message.author.id);
await deletePersistedDailyPuzzleSession(message.author.id);
await message.reply('이번 일일퍼즐 시도를 취소했다냥.');
return true;
    }

    if (content.startsWith('%') || content.startsWith('/')) {
      return false;
    }

    await handleDailyPuzzleAnswer(message, session);
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

  const state = await loadDailyPuzzleState();

  state.settings.guilds[interaction.guildId] = {
    channelId: interaction.channelId,
    setBy: interaction.user.id,
    setAt: new Date().toISOString(),
  };

  await saveDailyPuzzleState();

  await interaction.reply({
    content: `이 채널을 일일 체스 퍼즐 알림 채널로 지정했다냥.\n매일 KST ${String(
      dailyPuzzlePostHour
    ).padStart(2, '0')}:00 이후에 퍼즐을 올린다냥.`,
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
  const state = await loadDailyPuzzleState();

  const announcementConfig = resolveAnnouncementConfig(state, sourceGuildId, {
    allowFallback: !sourceGuildId,
  });

  if (!announcementConfig) {
    return {
      ok: false,
      reason: 'NO_CHANNEL',
    };
  }

  const { dateKey } = getKstDateInfo();
  const previousSolve = state.solved[dateKey]?.[user.id];

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
    puzzle = await getDailyPuzzleForPlay(dateKey);
  } catch (error) {
    console.error('Failed to fetch daily chess puzzle:');
    console.error(error);

    return {
      ok: false,
      reason: 'FETCH_FAILED',
      error,
    };
  }

  const previousSession = await getActiveDailyPuzzleSession(user.id);
  const keepStartedAt =
    previousSession?.dateKey === dateKey &&
    previousSession?.puzzleId === puzzle.puzzleId
      ? previousSession.startedAtMs
      : startedAtMs;

  const session = {
    userId: user.id,
    dateKey,
    puzzleId: puzzle.puzzleId,
    fen: puzzle.fen,
    solutionMoves: puzzle.solutionMoves,
    index: 0,
    startedAtMs: keepStartedAt,
    sourceGuildId: announcementConfig.guildId,
    sourceChannelId: announcementConfig.channelId,
  };

  activeSessions.set(user.id, session);
  await persistDailyPuzzleSession(session);
  try {
    const imageBuffer = await fetchBinary(puzzle.imageUrl);
    const attachment = new AttachmentBuilder(imageBuffer, {
      name: `daily-chess-puzzle-${puzzle.puzzleId}.png`,
    });

    await user.send({
      content: [
        `오늘의 일일 체스 퍼즐이다냥.`,
        `**${puzzle.turnText} 차례**다냥.`,
        '',
        '수를 SAN 표기법으로 보내면 된다냥.',
        '예: `Nf3+`, `Qh7#`, `O-O`, `Rxe8`',
        '',
        '`포기`라고 보내면 이번 시도를 취소한다냥.',
      ].join('\n'),
      files: [attachment],
    });
  } catch (error) {
    console.error(`Failed to send daily puzzle DM to ${user.tag}:`);
    console.error(error);

    activeSessions.delete(user.id);

    return {
      ok: false,
      reason: 'DM_FAILED',
    };
  }

  return {
    ok: true,
    alreadySolved: false,
    puzzleId: puzzle.puzzleId,
    dateKey,
  };
}

async function handleDailyPuzzleAnswer(message, session) {
  const rawInput = message.content?.trim() ?? '';

  if (!rawInput) {
    return;
  }

  const expectedSan = session.solutionMoves[session.index];

  if (!expectedSan) {
    activeSessions.delete(message.author.id);
    await message.reply('세션 상태가 이상해서 초기화했다냥. `%일일퍼즐`로 다시 시작해달라냥.');
    return;
  }

  let expectedMove;

  try {
    expectedMove = getExpectedMoveFromFen(session.fen, expectedSan);
  } catch (error) {
    console.error('Failed to apply expected daily puzzle move:');
    console.error(error);
    activeSessions.delete(message.author.id);
    await message.reply('퍼즐 처리 중 오류가 났다냥. 잠시 뒤 다시 시도해달라냥.');
    return;
  }

  if (!isMatchingExpectedMove(rawInput, expectedSan, expectedMove)) {
    await message.reply('틀렸다냥. 다시 생각해보라냥.');
    return;
  }

  session.fen = expectedMove.nextFen;
  session.index += 1;

  if (session.index >= session.solutionMoves.length) {
    await completeDailyPuzzle(message, session);
    return;
  }

  const opponentSan = session.solutionMoves[session.index];

  let opponentMove;

  try {
    opponentMove = getExpectedMoveFromFen(session.fen, opponentSan);
  } catch (error) {
    console.error('Failed to apply opponent daily puzzle move:');
    console.error(error);
    activeSessions.delete(message.author.id);
    await message.reply('상대 수 처리 중 오류가 났다냥. 잠시 뒤 다시 시도해달라냥.');
    return;
  }

  session.fen = opponentMove.nextFen;
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
      `오늘 퍼즐은 이미 풀었다냥. 기록은 ${formatElapsed(
        recordResult.previous.elapsedMs
      )}이다냥.`
    );
    return;
  }

  await message.reply(`정답이다냥! ${formatElapsed(elapsedMs)} 만에 풀었다냥.`);

  await announceDailyPuzzleSolved(message.client, message.author, session, elapsedMs);
}

async function recordDailyPuzzleSolve(user, session, elapsedMs) {
  const state = await loadDailyPuzzleState();

  state.solved[session.dateKey] ??= {};

  const previous = state.solved[session.dateKey][user.id];

  if (previous) {
    return {
      recorded: false,
      previous,
    };
  }

  state.solved[session.dateKey][user.id] = {
    userId: user.id,
    userTag: user.tag,
    elapsedMs,
    solvedAt: new Date().toISOString(),
    guildId: session.sourceGuildId,
  };

  await saveDailyPuzzleState();

  return {
    recorded: true,
  };
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
    content: `<@${user.id}> 님이 ${formatKoreanDateKey(
      session.dateKey
    )} 일일퍼즐을 ${formatElapsed(elapsedMs)}만에 푸셨다냥!`,
    allowedMentions: {
      users: [user.id],
    },
  });
}

async function checkDailyPuzzlePosts(client) {
  const { dateKey, hour } = getKstDateInfo();

  if (hour < dailyPuzzlePostHour) {
    return;
  }

  const state = await loadDailyPuzzleState();
  const guildEntries = Object.entries(state.settings.guilds ?? {});

  if (guildEntries.length === 0) {
    return;
  }

  const targets = guildEntries.filter(([guildId]) => {
    const postKey = createPostKey(guildId, dateKey);
    return !state.posts[postKey];
  });

  if (targets.length === 0) {
    return;
  }

  let puzzle;

  try {
    puzzle = await getDailyPuzzleForPlay(dateKey);
  } catch (error) {
    console.error('Failed to fetch daily puzzle for scheduled post:');
    console.error(error);
    return;
  }

  const imageBuffer = await fetchBinary(puzzle.imageUrl).catch((error) => {
    console.error('Failed to fetch daily puzzle image:');
    console.error(error);
    return null;
  });

  if (!imageBuffer) {
    return;
  }

  const yesterdayKey = addDaysToDateKey(dateKey, -1);
  const content = createDailyPostContent(state, puzzle, dateKey, yesterdayKey);

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
      const attachment = new AttachmentBuilder(Buffer.from(imageBuffer), {
        name: `daily-chess-puzzle-${puzzle.puzzleId}.png`,
      });

      const sent = await channel.send({
        content,
        files: [attachment],
        allowedMentions: {
          parse: [],
        },
      });

      state.posts[createPostKey(guildId, dateKey)] = {
        guildId,
        channelId: config.channelId,
        messageId: sent.id,
        puzzleId: puzzle.puzzleId,
        postedAt: new Date().toISOString(),
      };

      await saveDailyPuzzleState();
    } catch (error) {
      console.error(`Failed to post daily puzzle to channel ${config.channelId}:`);
      console.error(error);
    }
  }
}

function createDailyPostContent(state, puzzle, dateKey, yesterdayKey) {
  return [
    `**${formatKoreanDateKey(dateKey)} 일일 체스 퍼즐이다냥!**`,
    `${puzzle.turnText} 차례다냥.`,
    '풀려면 %일일퍼즐을 입력하라냥.',
    '',
    createLeaderboardText(state, yesterdayKey),
  ].join('\n');
}

function createLeaderboardText(state, dateKey) {
  const records = Object.values(state.solved[dateKey] ?? {}).sort(
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

async function getDailyPuzzleForPlay(dateKey) {
  const cached = dailyPuzzleCache.get(dateKey);

  if (cached) {
    return cached;
  }

  const meta = await fetchDailyPuzzleMeta();

  const solution = await fetchPuzzleSolutionData(meta.puzzleId);
  const solutionMoves = extractSolutionMoves(solution.pgn, solution.fen);

  if (solutionMoves.length === 0) {
    throw new Error(`No solution moves found for puzzle ${meta.puzzleId}`);
  }

  const puzzle = {
    ...meta,
    ...solution,
    solutionMoves,
    turnText: getFenTurnText(solution.fen),
  };

  dailyPuzzleCache.set(dateKey, puzzle);

  return puzzle;
}

async function fetchDailyPuzzleMeta() {
  const data = await fetchJson(chessPuzzleDailyApiUrl);

  const puzzleId = Number(data.Puzzle ?? data.puzzle);

  if (!Number.isFinite(puzzleId)) {
    throw new Error('Daily puzzle API did not include Puzzle id');
  }

  return {
    puzzleId,
    link: data.Link ?? `${chessPuzzleBaseUrl}/Puzzle/${puzzleId}`,
    imageUrl: data.Image ?? `${chessPuzzleBaseUrl}/Images/Small/Puzzle${puzzleId}.png`,
    text: data.Text ?? '',
    players: data.Players ?? '',
    site: data.Site ?? '',
    shortHeader: data.ShortHeader ?? '',
  };
}

async function fetchPuzzleSolutionData(puzzleId) {
  const html = await fetchText(`${chessPuzzleBaseUrl}/Solution/${puzzleId}`);

  if (/Just a moment|cf_chl|challenge-platform|Cloudflare/i.test(html)) {
    throw new Error(
      'ChessPuzzle.net returned a Cloudflare challenge page instead of the solution page'
    );
  }

  const objectText = extractSolutionViewObjectText(html);

  const fen = extractJsStringProperty(objectText, 'fen');
  const pgn = extractJsStringProperty(objectText, 'pgn');
  const ply = Number(extractJsNumberProperty(objectText, 'ply'));
  const parsedPuzzleId = Number(extractJsNumberProperty(objectText, 'puzzleId'));

  if (!fen || !pgn || !Number.isFinite(ply)) {
    throw new Error(`Could not parse solution data for puzzle ${puzzleId}`);
  }

  return {
    fen,
    pgn,
    ply,
    puzzleId: Number.isFinite(parsedPuzzleId) ? parsedPuzzleId : puzzleId,
  };
}

function extractSolutionMoves(pgn, startFen) {
  const variations = getTopLevelVariations(pgn);

  let bestLine = [];

  for (const variation of variations) {
    const mainLine = stripNestedVariationsAndComments(variation);
    const tokens = tokenizeSanMoves(mainLine);
    const legalLine = createLegalMoveLine(startFen, tokens);

    if (legalLine.length > bestLine.length) {
      bestLine = legalLine;
    }
  }

  if (bestLine.length > 0) {
    return bestLine;
  }

  const fallbackTokens = tokenizeSanMoves(stripNestedVariationsAndComments(pgn));
  return createLegalMoveLine(startFen, fallbackTokens);
}

function createLegalMoveLine(startFen, tokens) {
  let bestLine = [];

  for (let offset = 0; offset < Math.min(4, tokens.length); offset += 1) {
    const chess = new Chess(startFen);
    const line = [];

    for (const token of tokens.slice(offset)) {
      const move = tryApplySan(chess, token);

      if (!move) {
        break;
      }

      line.push(move.san);
    }

    if (line.length > bestLine.length) {
      bestLine = line;
    }
  }

  return bestLine;
}

function getTopLevelVariations(pgn) {
  const body = pgn.replace(/\[[^\]]*]/g, ' ');
  const variations = [];

  let depth = 0;
  let start = -1;
  let inComment = false;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];

    if (inComment) {
      if (ch === '}') {
        inComment = false;
      }
      continue;
    }

    if (ch === '{') {
      inComment = true;
      continue;
    }

    if (ch === '(') {
      if (depth === 0) {
        start = i + 1;
      }
      depth += 1;
      continue;
    }

    if (ch === ')') {
      depth -= 1;

      if (depth === 0 && start >= 0) {
        variations.push(body.slice(start, i));
        start = -1;
      }
    }
  }

  return variations;
}

function stripNestedVariationsAndComments(text) {
  let result = '';
  let depth = 0;
  let inComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inComment) {
      if (ch === '}') {
        inComment = false;
      }
      continue;
    }

    if (ch === '{') {
      inComment = true;
      continue;
    }

    if (ch === '(') {
      depth += 1;
      continue;
    }

    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0) {
      result += ch;
    }
  }

  return result;
}

function tokenizeSanMoves(text) {
  return text
    .replace(/\$\d+/g, ' ')
    .replace(/\d+\s*\.\.\./g, ' ')
    .replace(/\d+\s*\./g, ' ')
    .split(/\s+/)
    .map((token) =>
      token
        .trim()
        .replace(/^[.]+/, '')
        .replace(/[?!]+$/g, '')
    )
    .filter((token) => {
      if (!token) {
        return false;
      }

      if (token === '--') {
        return false;
      }

      if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(token)) {
        return false;
      }

      if (/^\[%/.test(token)) {
        return false;
      }

      return true;
    });
}

function getExpectedMoveFromFen(fen, san) {
  const chess = new Chess(fen);
  const move = tryApplySan(chess, san);

  if (!move) {
    throw new Error(`Expected move is illegal from FEN: ${san} / ${fen}`);
  }

  return {
    san: move.san,
    uci: `${move.from}${move.to}${move.promotion ?? ''}`,
    nextFen: chess.fen(),
  };
}

function isMatchingExpectedMove(rawInput, expectedSan, expectedMove) {
  const inputSan = normalizeSanForCompare(rawInput);
  const inputUci = normalizeUci(rawInput);

  return (
    inputSan === normalizeSanForCompare(expectedSan) ||
    inputSan === normalizeSanForCompare(expectedMove.san) ||
    inputUci === expectedMove.uci
  );
}

function tryApplySan(chess, san) {
  try {
    return chess.move(san, { sloppy: true });
  } catch {
    try {
      return chess.move(san);
    } catch {
      return null;
    }
  }
}

function normalizeSanForCompare(value) {
  return String(value ?? '')
    .trim()
    .replace(/^\d+\s*\.\.\.\s*/, '')
    .replace(/^\d+\s*\.\s*/, '')
    .replace(/0/g, 'O')
    .replace(/[+#]/g, '')
    .replace(/[?!]/g, '')
    .replace(/\s+/g, '');
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

function extractSolutionViewObjectText(html) {
  const callIndex = html.indexOf('SolutionView');

  if (callIndex < 0) {
    throw new Error('SolutionView call was not found');
  }

  const braceStart = html.indexOf('{', callIndex);

  if (braceStart < 0) {
    throw new Error('SolutionView object was not found');
  }

  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = braceStart; i < html.length; i += 1) {
    const ch = html[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === '\\') {
        escaped = true;
        continue;
      }

      if (ch === quote) {
        quote = null;
      }

      continue;
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;

      if (depth === 0) {
        return html.slice(braceStart, i + 1);
      }
    }
  }

  throw new Error('Could not find end of SolutionView object');
}

function extractJsStringProperty(objectText, name) {
  const regex = new RegExp(`${name}\\s*:\\s*'((?:\\\\.|[^'\\\\])*)'`, 's');
  const match = objectText.match(regex);

  if (!match) {
    return null;
  }

  return unescapeJsString(match[1]);
}

function extractJsNumberProperty(objectText, name) {
  const regex = new RegExp(`${name}\\s*:\\s*([0-9]+)`);
  const match = objectText.match(regex);
  return match?.[1] ?? null;
}

function unescapeJsString(value) {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, '\'')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

async function fetchJson(url) {
  const text = await fetchText(url);
  return JSON.parse(text);
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
  }

  return response.text();
}

async function fetchBinary(url) {
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), dailyPuzzleFetchTimeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        Accept: 'text/html,application/json,image/png,*/*',
        Referer: chessPuzzleBaseUrl,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function loadDailyPuzzleState() {
  if (dailyPuzzleState) {
    return dailyPuzzleState;
  }

  try {
    dailyPuzzleState = JSON.parse(await fs.readFile(dailyPuzzleStatePath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }

    dailyPuzzleState = {};
  }

  dailyPuzzleState.settings ??= {};
  dailyPuzzleState.settings.guilds ??= {};
  dailyPuzzleState.posts ??= {};
  dailyPuzzleState.solved ??= {};
dailyPuzzleState.sessions ??= {};
  return dailyPuzzleState;
}

async function saveDailyPuzzleState() {
  dailyPuzzleSaveQueue = dailyPuzzleSaveQueue.then(async () => {
    await fs.mkdir(new URL('../data/', import.meta.url), { recursive: true });

    const tempPath = `${dailyPuzzleStatePath}.tmp`;

    await fs.writeFile(
      tempPath,
      JSON.stringify(dailyPuzzleState, null, 2),
      'utf8'
    );

    await fs.rename(tempPath, dailyPuzzleStatePath);
  });

  return dailyPuzzleSaveQueue;
}

async function hydrateDailyPuzzleSessions() {
  const state = await loadDailyPuzzleState();
  const todayKey = getKstDateInfo().dateKey;

  let changed = false;

  for (const [userId, session] of Object.entries(state.sessions ?? {})) {
    const isToday = session?.dateKey === todayKey;
    const alreadySolved = Boolean(state.solved?.[session?.dateKey]?.[userId]);
    const isValid =
      session &&
      typeof session.userId === 'string' &&
      typeof session.dateKey === 'string' &&
      typeof session.puzzleId === 'number' &&
      typeof session.fen === 'string' &&
      Array.isArray(session.solutionMoves) &&
      typeof session.index === 'number' &&
      typeof session.startedAtMs === 'number' &&
      typeof session.sourceChannelId === 'string';

    if (!isToday || alreadySolved || !isValid) {
      delete state.sessions[userId];
      changed = true;
      continue;
    }

    activeSessions.set(userId, session);
  }

  if (changed) {
    await saveDailyPuzzleState();
  }

  console.log(`Restored ${activeSessions.size} active daily puzzle session(s).`);
}

async function getActiveDailyPuzzleSession(userId) {
  const cached = activeSessions.get(userId);

  if (cached) {
    return cached;
  }

  const state = await loadDailyPuzzleState();
  const session = state.sessions?.[userId];

  if (!session) {
    return null;
  }

  const todayKey = getKstDateInfo().dateKey;
  const alreadySolved = Boolean(state.solved?.[session.dateKey]?.[userId]);

  if (session.dateKey !== todayKey || alreadySolved) {
    delete state.sessions[userId];
    await saveDailyPuzzleState();
    return null;
  }

  activeSessions.set(userId, session);
  return session;
}

async function persistDailyPuzzleSession(session) {
  const state = await loadDailyPuzzleState();

  state.sessions ??= {};
  state.sessions[session.userId] = {
    userId: session.userId,
    dateKey: session.dateKey,
    puzzleId: session.puzzleId,
    fen: session.fen,
    solutionMoves: session.solutionMoves,
    index: session.index,
    startedAtMs: session.startedAtMs,
    sourceGuildId: session.sourceGuildId,
    sourceChannelId: session.sourceChannelId,
    updatedAt: new Date().toISOString(),
  };

  await saveDailyPuzzleState();
}

async function deletePersistedDailyPuzzleSession(userId) {
  const state = await loadDailyPuzzleState();

  if (state.sessions?.[userId]) {
    delete state.sessions[userId];
    await saveDailyPuzzleState();
  }
}

function resolveAnnouncementConfig(state, guildId, { allowFallback = false } = {}) {
  if (guildId && state.settings.guilds[guildId]) {
    return {
      guildId,
      channelId: state.settings.guilds[guildId].channelId,
    };
  }

  if (!allowFallback) {
    return null;
  }

  const first = Object.entries(state.settings.guilds)[0];

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
    return `오늘 일일퍼즐은 이미 풀었다냥. 기록은 ${formatElapsed(
      result.elapsedMs
    )}이다냥.`;
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
    return 'ChessPuzzle.net에서 오늘 퍼즐 데이터를 가져오지 못했다냥. 잠시 뒤 다시 시도해달라냥.';
  }

  return '일일퍼즐을 시작하지 못했다냥.';
}

function getFenTurnText(fen) {
  const side = fen.split(/\s+/)[1];
  return side === 'w' ? '백' : '흑';
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