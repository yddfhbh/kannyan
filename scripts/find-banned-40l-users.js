import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

const API_BASE = 'https://ch.tetr.io/api';
const DISCORD_API_BASE = 'https://discord.com/api/v10';

const LEADERBOARD = process.env.TETRIO_RECORD_LEADERBOARD || '40l_global';
const LIMIT = Math.max(1, Math.min(100, Number(process.env.TETRIO_SCAN_LIMIT) || 100));
const DELAY_MS = Math.max(0, Number(process.env.TETRIO_SCAN_DELAY_MS) || 300);
const TARGET_RANK = Math.max(1, Number(process.env.TETRIO_SCAN_TARGET_RANK) || 100_000);
const DEFAULT_MAX_PAGES = Math.ceil(TARGET_RANK / LIMIT);
const MAX_PAGES_RAW = Number(process.env.TETRIO_SCAN_MAX_PAGES ?? DEFAULT_MAX_PAGES);
const MAX_PAGES =
  Number.isFinite(MAX_PAGES_RAW) && MAX_PAGES_RAW > 0
    ? Math.floor(MAX_PAGES_RAW)
    : Infinity;

const PROGRESS_UPDATE_PAGE_INTERVAL = Math.max(
  1,
  Number(process.env.TETRIO_SCAN_PROGRESS_PAGE_INTERVAL) || 10
);
const PROGRESS_UPDATE_USER_INTERVAL = Math.max(
  1,
  Number(process.env.TETRIO_SCAN_PROGRESS_USER_INTERVAL) || 250
);
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_PROGRESS_CHANNEL_ID =
  process.env.TETRIO_BANNED_SCAN_PROGRESS_CHANNEL_ID || '1523323621861359758';
const DISCORD_RESULT_CHANNEL_ID =
  process.env.TETRIO_BANNED_SCAN_RESULT_CHANNEL_ID || '1523323630891700434';
const RESET_SCAN = /^(1|true|yes)$/i.test(process.env.TETRIO_SCAN_RESET || '');

const OUTPUT_DIR = path.resolve('data');
const OUTPUT_PATH = path.join(OUTPUT_DIR, `banned-${LEADERBOARD}.json`);
const STATE_PATH = path.join(OUTPUT_DIR, `banned-${LEADERBOARD}-scan-state.json`);
const STATE_TEMP_PATH = path.join(OUTPUT_DIR, `banned-${LEADERBOARD}-scan-state.tmp.json`);
const OUTPUT_LABEL = path.relative(process.cwd(), OUTPUT_PATH) || OUTPUT_PATH;
const STATE_LABEL = path.relative(process.cwd(), STATE_PATH) || STATE_PATH;

let activeState = null;
let shutdownStarted = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US');
}

function toPrisecter(value) {
  if (!value) return '';

  if (typeof value === 'string') return value;

  const pri = value.pri;
  const sec = value.sec;
  const ter = value.ter;

  if (pri == null || sec == null || ter == null) return '';

  return `${pri}:${sec}:${ter}`;
}

function getRecordUser(record) {
  return record?.user ?? record?.u ?? null;
}

function getUserId(user) {
  return String(user?._id ?? user?.id ?? '').trim();
}

function getUsername(user) {
  return String(user?.username ?? '').trim();
}

function formatTimeMs(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return '-';
  }

  return `${(n / 1000).toFixed(3)}s`;
}

function chunkDiscordText(text, maxLength = 1800) {
  const lines = String(text ?? '').split('\n');
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;

    if (next.length > maxLength) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);

  return chunks.length > 0 ? chunks : ['-'];
}

function createInitialState() {
  return {
    version: 1,
    leaderboard: LEADERBOARD,
    sessionId: `kannyan-banned-40l-scan-${Date.now().toString(36)}`,
    status: 'scanning-records',
    startedAt: nowIso(),
    updatedAt: nowIso(),
    completedAt: '',
    after: '',
    lastNextAfter: '',
    scannedPages: 0,
    scannedRecords: 0,
    users: [],
    seenUserKeys: [],
    seenRecordIds: [],
    nextUserIndex: 0,
    banned: [],
    reportedBannedKeys: [],
    progressMessageId: '',
  };
}

function normalizeState(raw) {
  const base = createInitialState();
  const state = raw && typeof raw === 'object' ? { ...base, ...raw } : base;

  state.version = 1;
  state.leaderboard = LEADERBOARD;
  state.sessionId = String(state.sessionId || base.sessionId);
  state.status =
    state.status === 'checking-users' || state.status === 'completed'
      ? state.status
      : 'scanning-records';
  state.startedAt = String(state.startedAt || base.startedAt);
  state.updatedAt = String(state.updatedAt || base.updatedAt);
  state.completedAt = String(state.completedAt || '');
  state.after = String(state.after || '');
  state.lastNextAfter = String(state.lastNextAfter || '');
  state.scannedPages = Math.max(0, Number(state.scannedPages) || 0);
  state.scannedRecords = Math.max(0, Number(state.scannedRecords) || 0);
  state.nextUserIndex = Math.max(0, Number(state.nextUserIndex) || 0);
  state.progressMessageId = String(state.progressMessageId || '');

  state.users = Array.isArray(state.users)
    ? state.users
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
          key: String(entry.key || '').trim(),
          id: String(entry.id || '').trim(),
          username: String(entry.username || '').trim(),
          recordId: String(entry.recordId || '').trim(),
          replayId: String(entry.replayId || '').trim(),
          score: Number.isFinite(Number(entry.score)) ? Number(entry.score) : null,
          scoreText: String(entry.scoreText || formatTimeMs(entry.score)),
          ts: String(entry.ts || '').trim(),
          rank: Math.max(0, Number(entry.rank) || 0),
        }))
        .filter((entry) => entry.key)
    : [];

  state.seenUserKeys = Array.isArray(state.seenUserKeys)
    ? state.seenUserKeys.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  state.seenRecordIds = Array.isArray(state.seenRecordIds)
    ? state.seenRecordIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  state.banned = Array.isArray(state.banned)
    ? state.banned
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
          username: String(entry.username || '').trim(),
          id: String(entry.id || '').trim(),
          role: String(entry.role || '').trim(),
          badstanding: Boolean(entry.badstanding),
          recordId: String(entry.recordId || '').trim(),
          replayId: String(entry.replayId || '').trim(),
          score: Number.isFinite(Number(entry.score)) ? Number(entry.score) : null,
          scoreText: String(entry.scoreText || formatTimeMs(entry.score)),
          ts: String(entry.ts || '').trim(),
          rank: Math.max(0, Number(entry.rank) || 0),
        }))
        .filter((entry) => entry.username || entry.id)
    : [];
  state.reportedBannedKeys = Array.isArray(state.reportedBannedKeys)
    ? state.reportedBannedKeys.map((value) => String(value || '').trim()).filter(Boolean)
    : [];

  if (state.nextUserIndex > state.users.length) {
    state.nextUserIndex = state.users.length;
  }

  return state;
}

async function saveState(state) {
  state.updatedAt = nowIso();
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(STATE_TEMP_PATH, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(STATE_TEMP_PATH, STATE_PATH);
}

async function loadState() {
  if (RESET_SCAN) {
    return createInitialState();
  }

  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8');
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return createInitialState();
    }
    throw error;
  }
}

function buildProgressMessage(state) {
  const phaseText =
    state.status === 'checking-users'
      ? '유저 밴 여부 확인 중'
      : state.status === 'completed'
        ? '완료'
        : '랭킹 기록 수집 중';

  const lines = [];
  lines.push(`**TETR.IO ${state.leaderboard} 밴 스캔 진행**`);
  lines.push(`상태: \`${phaseText}\``);
  lines.push(`세션: \`${state.sessionId}\``);
  lines.push(`목표 범위: \`상위 ${formatNumber(TARGET_RANK)}등\``);
  lines.push(`페이지: \`${formatNumber(state.scannedPages)} / ${Number.isFinite(MAX_PAGES) ? formatNumber(MAX_PAGES) : 'all'}\``);
  lines.push(`수집한 기록: \`${formatNumber(state.scannedRecords)}\``);
  lines.push(`고유 유저: \`${formatNumber(state.users.length)}\``);
  lines.push(`유저 확인: \`${formatNumber(state.nextUserIndex)} / ${formatNumber(state.users.length)}\``);
  lines.push(`밴 발견: \`${formatNumber(state.banned.length)}\``);
  lines.push(`다음 after: \`${state.lastNextAfter || state.after || '-'}\``);
  lines.push(`마지막 갱신: \`${state.updatedAt}\``);
  lines.push(`체크포인트: \`${STATE_LABEL}\``);
  return lines.join('\n');
}

function buildBannedUserMessage(user) {
  const lines = [];
  lines.push('**밴 유저 발견**');
  lines.push(`닉: **${user.username || user.id || 'unknown'}**`);
  lines.push(`기록: \`${user.scoreText}\``);
  lines.push(`리플아이디: \`${user.replayId || '-'}\``);

  if (user.rank > 0) {
    lines.push(`순위: \`#${formatNumber(user.rank)}\``);
  }

  if (user.id) {
    lines.push(`유저아이디: \`${user.id}\``);
  }

  return lines.join('\n');
}

function buildDiscordResultMessage(result) {
  const lines = [];

  lines.push(`**TETR.IO ${result.leaderboard} 밴 유저 스캔 결과**`);
  lines.push(`목표 범위: \`상위 ${formatNumber(result.targetRank)}등\``);
  lines.push(`스캔한 페이지: \`${formatNumber(result.scannedPages)}\``);
  lines.push(`스캔 기록 수: \`${formatNumber(result.scannedRecords)}\``);
  lines.push(`고유 유저 수: \`${formatNumber(result.uniqueUsers)}\``);
  lines.push(`밴 유저 수: \`${formatNumber(result.bannedCount)}\``);
  lines.push(`스캔 시각: \`${result.scannedAt}\``);
  lines.push('');

  if (result.banned.length === 0) {
    lines.push('밴 유저 없음.');
  } else {
    lines.push('**밴 유저 목록**');

    for (const user of result.banned) {
      lines.push(
        `- **${user.username || user.id || 'unknown'}** / \`${user.scoreText}\` / replay=\`${user.replayId || '-'}\`${user.rank > 0 ? ` / #${formatNumber(user.rank)}` : ''}`
      );
    }
  }

  lines.push('');
  lines.push(`저장 파일: \`${OUTPUT_LABEL}\``);
  lines.push(`체크포인트: \`${STATE_LABEL}\``);

  return lines.join('\n');
}

function getBannedResultKey(user) {
  return [user.id, user.recordId, user.replayId, user.username].map((value) => value || '').join(':');
}

async function requestDiscordApi(method, pathname, body) {
  if (!DISCORD_TOKEN) {
    return null;
  }

  const response = await fetch(`${DISCORD_API_BASE}${pathname}`, {
    method,
    headers: {
      Authorization: `Bot ${DISCORD_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = null;

  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    throw new Error(
      `Discord API failed method=${method} path=${pathname} status=${response.status} body=${text.slice(0, 500)}`
    );
  }

  return parsed;
}

async function sendDiscordMessage(channelId, content) {
  if (!DISCORD_TOKEN) {
    console.warn('[discord] DISCORD_TOKEN is not set. Skip Discord post.');
    return '';
  }

  if (!channelId) {
    console.warn('[discord] channel id is not set. Skip Discord post.');
    return '';
  }

  const chunks = chunkDiscordText(content);
  let lastMessageId = '';

  for (const chunk of chunks) {
    const message = await requestDiscordApi('POST', `/channels/${channelId}/messages`, {
      content: chunk,
      allowed_mentions: {
        parse: [],
      },
    });

    lastMessageId = String(message?.id || lastMessageId);
    await sleep(700);
  }

  return lastMessageId;
}

async function updateDiscordMessage(channelId, messageId, content) {
  if (!DISCORD_TOKEN || !channelId || !messageId) {
    return '';
  }

  const firstChunk = chunkDiscordText(content)[0];
  const message = await requestDiscordApi(
    'PATCH',
    `/channels/${channelId}/messages/${messageId}`,
    {
      content: firstChunk,
      allowed_mentions: {
        parse: [],
      },
    }
  );

  await sleep(700);
  return String(message?.id || messageId);
}

async function syncProgressMessage(state) {
  if (!DISCORD_TOKEN || !DISCORD_PROGRESS_CHANNEL_ID) {
    return;
  }

  const content = buildProgressMessage(state);

  if (!state.progressMessageId) {
    state.progressMessageId = await sendDiscordMessage(DISCORD_PROGRESS_CHANNEL_ID, content);
    await saveState(state);
    return;
  }

  try {
    await updateDiscordMessage(DISCORD_PROGRESS_CHANNEL_ID, state.progressMessageId, content);
  } catch (error) {
    console.error('[discord] failed to update progress message. creating a new one instead.');
    console.error(error);
    state.progressMessageId = await sendDiscordMessage(DISCORD_PROGRESS_CHANNEL_ID, content);
    await saveState(state);
  }
}

async function postProgressEvent(text) {
  if (!DISCORD_TOKEN || !DISCORD_PROGRESS_CHANNEL_ID) {
    return;
  }

  try {
    await sendDiscordMessage(DISCORD_PROGRESS_CHANNEL_ID, text);
  } catch (error) {
    console.error('[discord] failed to post progress event');
    console.error(error);
  }
}

async function requestJson(url, sessionId) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'KannyanBot banned 40l scanner',
      'X-Session-ID': sessionId,
    },
  });

  const text = await response.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response status=${response.status} body=${text.slice(0, 300)}`);
  }

  if (!response.ok || json.success === false) {
    throw new Error(
      `TETR.IO API failed status=${response.status} body=${JSON.stringify(json).slice(0, 500)}`
    );
  }

  return json;
}

async function fetchRecordPage(after, sessionId) {
  const url = new URL(`${API_BASE}/records/${encodeURIComponent(LEADERBOARD)}`);
  url.searchParams.set('limit', String(LIMIT));

  if (after) {
    url.searchParams.set('after', after);
  }

  const json = await requestJson(url, sessionId);
  return json?.data?.entries ?? [];
}

async function fetchUserDetail(userIdOrName, sessionId) {
  const json = await requestJson(
    `${API_BASE}/users/${encodeURIComponent(userIdOrName)}`,
    sessionId
  );
  return json?.data ?? null;
}

async function handleFoundBannedUser(state, row) {
  const bannedKey = getBannedResultKey(row);

  if (!state.reportedBannedKeys.includes(bannedKey)) {
    try {
      await sendDiscordMessage(DISCORD_RESULT_CHANNEL_ID, buildBannedUserMessage(row));
      state.reportedBannedKeys.push(bannedKey);
      await saveState(state);
    } catch (error) {
      console.error('[discord] failed to post banned user');
      console.error(error);
    }
  }
}

async function scanRecordPages(state, userMap, seenUserKeys, seenRecordIds) {
  while (state.status === 'scanning-records') {
    const nextPageNumber = state.scannedPages + 1;
    const entries = await fetchRecordPage(state.after, state.sessionId);

    if (entries.length === 0) {
      console.log('[scan] no more entries');
      state.status = 'checking-users';
      await saveState(state);
      await syncProgressMessage(state);
      break;
    }

    for (const entry of entries) {
      const recordId = String(entry?._id ?? '').trim();

      if (recordId && seenRecordIds.has(recordId)) {
        continue;
      }

      if (recordId) {
        seenRecordIds.add(recordId);
      }

      state.scannedRecords += 1;

      const user = getRecordUser(entry);
      const userId = getUserId(user);
      const username = getUsername(user);

      if (!userId && !username) {
        continue;
      }

      const key = userId || username.toLowerCase();

      if (!seenUserKeys.has(key)) {
        seenUserKeys.add(key);

        const row = {
          key,
          id: userId,
          username,
          recordId,
          replayId: String(entry?.replayid ?? '').trim(),
          score: entry?.results?.stats?.finaltime ?? entry?.p?.pri ?? null,
          scoreText: formatTimeMs(entry?.results?.stats?.finaltime ?? entry?.p?.pri ?? null),
          ts: String(entry?.ts ?? '').trim(),
          rank: state.scannedRecords,
        };

        userMap.set(key, row);
        state.users.push(row);
      }
    }

    state.scannedPages = nextPageNumber;
    state.lastNextAfter = toPrisecter(entries.at(-1)?.p);

    console.log(
      `[page ${state.scannedPages}] entries=${entries.length} scannedRecords=${state.scannedRecords} uniqueUsers=${state.users.length} nextAfter=${state.lastNextAfter || '-'}`
    );

    const reachedMaxPages = state.scannedPages >= MAX_PAGES;
    const paginationStopped = !state.lastNextAfter || state.lastNextAfter === state.after;

    if (!reachedMaxPages && !paginationStopped) {
      state.after = state.lastNextAfter;
    }

    state.seenUserKeys = [...seenUserKeys];
    state.seenRecordIds = [...seenRecordIds];
    await saveState(state);

    if (state.scannedPages % PROGRESS_UPDATE_PAGE_INTERVAL === 0) {
      await syncProgressMessage(state);
    }

    if (reachedMaxPages) {
      console.log(`[scan] reached max pages=${MAX_PAGES}`);
      state.status = 'checking-users';
      await saveState(state);
      await syncProgressMessage(state);
      break;
    }

    if (paginationStopped) {
      console.log('[scan] pagination stopped: no next after');
      state.status = 'checking-users';
      await saveState(state);
      await syncProgressMessage(state);
      break;
    }
    await sleep(DELAY_MS);
  }
}

async function checkUsers(state) {
  console.log(`[users] checking roles for ${state.users.length} users...`);
  const knownBannedKeys = new Set(state.banned.map((entry) => getBannedResultKey(entry)));

  while (state.nextUserIndex < state.users.length) {
    const user = state.users[state.nextUserIndex];
    const lookup = user.id || user.username;

    try {
      const detail = await fetchUserDetail(lookup, state.sessionId);
      const role = String(detail?.role ?? '').toLowerCase();

      if (role === 'banned') {
        const row = {
          username: String(detail?.username ?? user.username).trim(),
          id: String(detail?._id ?? user.id).trim(),
          role,
          badstanding: Boolean(detail?.badstanding),
          recordId: user.recordId,
          replayId: user.replayId,
          score: user.score,
          scoreText: formatTimeMs(user.score),
          ts: user.ts,
          rank: user.rank,
        };

        const bannedKey = getBannedResultKey(row);

        if (!knownBannedKeys.has(bannedKey)) {
          knownBannedKeys.add(bannedKey);
          state.banned.push(row);

          console.log(
            `[BANNED] ${row.username} id=${row.id} score=${row.scoreText} replay=${row.replayId || '-'} rank=${row.rank || '-'}`
          );

          await saveState(state);
          await handleFoundBannedUser(state, row);
        }
      }
    } catch (error) {
      console.error(`[user ${state.nextUserIndex + 1}/${state.users.length}] failed lookup=${lookup}`);
      console.error(error);
    }

    state.nextUserIndex += 1;

    if (
      state.nextUserIndex % PROGRESS_UPDATE_USER_INTERVAL === 0 ||
      state.nextUserIndex === state.users.length
    ) {
      console.log(
        `[users] checked=${state.nextUserIndex}/${state.users.length} banned=${state.banned.length}`
      );
      await saveState(state);
      await syncProgressMessage(state);
    } else {
      await saveState(state);
    }

    await sleep(DELAY_MS);
  }
}

async function finalizeScan(state) {
  state.status = 'completed';
  state.completedAt = nowIso();
  await saveState(state);

  const result = {
    leaderboard: LEADERBOARD,
    targetRank: TARGET_RANK,
    scannedPages: state.scannedPages,
    scannedRecords: state.scannedRecords,
    uniqueUsers: state.users.length,
    bannedCount: state.banned.length,
    scannedAt: state.completedAt,
    banned: state.banned,
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(result, null, 2), 'utf8');

  console.log('');
  console.log(`=== BANNED USERS IN ${LEADERBOARD} ===`);

  if (state.banned.length === 0) {
    console.log('없음');
  } else {
    for (const user of state.banned) {
      console.log(`${user.username || user.id || 'unknown'} / ${user.scoreText} / ${user.replayId || '-'}`);
    }
  }

  console.log('');
  console.log(`[saved] ${OUTPUT_PATH}`);
  console.log(`[state] ${STATE_PATH}`);

  await syncProgressMessage(state);

  try {
    await sendDiscordMessage(DISCORD_RESULT_CHANNEL_ID, buildDiscordResultMessage(result));
    console.log(`[discord] result posted to channel=${DISCORD_RESULT_CHANNEL_ID}`);
  } catch (error) {
    console.error('[discord] failed to post result');
    console.error(error);
  }

  await postProgressEvent(
    `[scan] 완료 leaderboard=${LEADERBOARD} scannedPages=${state.scannedPages} scannedRecords=${state.scannedRecords} uniqueUsers=${state.users.length} banned=${state.banned.length}`
  );
}

async function handleShutdown(signal) {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  console.log(`[shutdown] received ${signal}`);

  try {
    if (activeState) {
      await saveState(activeState);
      await syncProgressMessage(activeState);
      await postProgressEvent(
        `[scan] ${signal} 수신, 체크포인트 저장 후 종료. page=${activeState.scannedPages} checked=${activeState.nextUserIndex}/${activeState.users.length} banned=${activeState.banned.length}`
      );
    }
  } catch (error) {
    console.error('[shutdown] failed to persist state');
    console.error(error);
  }

  process.exit(0);
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const state = await loadState();
  activeState = state;

  if (RESET_SCAN) {
    console.log('[scan] reset requested, starting a fresh scan');
  }

  const resumed =
    state.scannedPages > 0 ||
    state.nextUserIndex > 0 ||
    state.banned.length > 0 ||
    state.status === 'checking-users' ||
    state.status === 'completed';

  console.log(
    `[scan] leaderboard=${LEADERBOARD} limit=${LIMIT} delay=${DELAY_MS}ms targetRank=${TARGET_RANK} maxPages=${Number.isFinite(MAX_PAGES) ? MAX_PAGES : 'all'}`
  );
  console.log(`[scan] session=${state.sessionId}`);
  console.log(`[scan] state=${STATE_PATH}`);

  if (state.status === 'completed') {
    console.log('[scan] existing checkpoint is already completed. set TETRIO_SCAN_RESET=1 to rescan.');
    await syncProgressMessage(state);
    await postProgressEvent('[scan] 기존 체크포인트가 이미 완료 상태라서 종료합니다. 재실행하려면 TETRIO_SCAN_RESET=1');
    return;
  }

  await syncProgressMessage(state);
  await postProgressEvent(
    resumed
      ? `[scan] 재개 leaderboard=${LEADERBOARD} page=${state.scannedPages} checked=${state.nextUserIndex}/${state.users.length} banned=${state.banned.length}`
      : `[scan] 시작 leaderboard=${LEADERBOARD} targetRank=${TARGET_RANK} limit=${LIMIT} maxPages=${Number.isFinite(MAX_PAGES) ? MAX_PAGES : 'all'}`
  );

  const seenUserKeys = new Set(state.seenUserKeys);
  const seenRecordIds = new Set(state.seenRecordIds);
  const userMap = new Map();
  for (const user of state.users) {
    userMap.set(user.key, user);
  }

  await scanRecordPages(state, userMap, seenUserKeys, seenRecordIds);
  await syncProgressMessage(state);
  await checkUsers(state);
  await finalizeScan(state);
}

process.on('SIGINT', () => {
  void handleShutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void handleShutdown('SIGTERM');
});

main().catch(async (error) => {
  console.error('[fatal]');
  console.error(error);

  if (activeState) {
    try {
      await saveState(activeState);
      await syncProgressMessage(activeState);
      await postProgressEvent(
        `[scan] fatal error. page=${activeState.scannedPages} checked=${activeState.nextUserIndex}/${activeState.users.length} banned=${activeState.banned.length}`
      );
    } catch (persistError) {
      console.error('[fatal] failed to save checkpoint after error');
      console.error(persistError);
    }
  }

  process.exit(1);
});
