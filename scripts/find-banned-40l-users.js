import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

const API_BASE = 'https://ch.tetr.io/api';
const DISCORD_API_BASE = 'https://discord.com/api/v10';

const LEADERBOARD = process.env.TETRIO_RECORD_LEADERBOARD || '40l_global';
const LIMIT = Math.max(1, Math.min(100, Number(process.env.TETRIO_SCAN_LIMIT) || 100));
const DELAY_MS = Math.max(0, Number(process.env.TETRIO_SCAN_DELAY_MS) || 300);

// 기본값: 상위 100페이지까지만 스캔
// 전체 스캔하고 싶으면 TETRIO_SCAN_MAX_PAGES=0 으로 실행
const MAX_PAGES_RAW = Number(process.env.TETRIO_SCAN_MAX_PAGES ?? 100);
const MAX_PAGES =
  Number.isFinite(MAX_PAGES_RAW) && MAX_PAGES_RAW > 0
    ? Math.floor(MAX_PAGES_RAW)
    : Infinity;

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_RESULT_CHANNEL_ID =
  process.env.TETRIO_BANNED_SCAN_CHANNEL_ID || '1516439867238645851';

const SESSION_ID =
  process.env.TETRIO_SCAN_SESSION_ID ||
  `kannyan-banned-40l-scan-${Date.now().toString(36)}`;

const OUTPUT_DIR = path.resolve('data');
const OUTPUT_PATH = path.join(OUTPUT_DIR, `banned-${LEADERBOARD}.json`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  return chunks;
}

async function sendDiscordMessage(content) {
  if (!DISCORD_TOKEN) {
    console.warn('[discord] DISCORD_TOKEN is not set. Skip Discord result post.');
    return;
  }

  if (!DISCORD_RESULT_CHANNEL_ID) {
    console.warn('[discord] result channel id is not set. Skip Discord result post.');
    return;
  }

  const chunks = chunkDiscordText(content);

  for (const chunk of chunks) {
    const response = await fetch(
      `${DISCORD_API_BASE}/channels/${DISCORD_RESULT_CHANNEL_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bot ${DISCORD_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: chunk,
          allowed_mentions: {
            parse: [],
          },
        }),
      }
    );

    const body = await response.text();

    if (!response.ok) {
      throw new Error(
        `Discord message send failed status=${response.status} body=${body.slice(0, 500)}`
      );
    }

    await sleep(700);
  }
}

async function requestJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'KannyanBot banned 40l scanner',
      'X-Session-ID': SESSION_ID,
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

async function fetchRecordPage(after) {
  const url = new URL(`${API_BASE}/records/${encodeURIComponent(LEADERBOARD)}`);
  url.searchParams.set('limit', String(LIMIT));

  if (after) {
    url.searchParams.set('after', after);
  }

  const json = await requestJson(url);
  return json?.data?.entries ?? [];
}

async function fetchUserDetail(userIdOrName) {
  const json = await requestJson(`${API_BASE}/users/${encodeURIComponent(userIdOrName)}`);
  return json?.data ?? null;
}

function buildDiscordResultMessage(result) {
  const lines = [];

  lines.push(`**TETR.IO ${result.leaderboard} 밴 유저 스캔 결과**`);
  lines.push(`스캔 범위: \`상위 ${result.scannedPages}페이지\``);
  lines.push(`스캔 시각: \`${result.scannedAt}\``);
  lines.push(`스캔 기록 수: \`${result.scannedRecords}\``);
  lines.push(`고유 유저 수: \`${result.uniqueUsers}\``);
  lines.push(`밴 유저 수: \`${result.bannedCount}\``);
  lines.push('');

  if (result.banned.length === 0) {
    lines.push('밴 유저 없음.');
  } else {
    lines.push('**밴 유저 목록**');

    for (const user of result.banned) {
      lines.push(
        `- **${user.username}** / \`${user.scoreText}\` / id=\`${user.id}\`${user.replayId ? ` / replay=\`${user.replayId}\`` : ''}`
      );
    }
  }

  lines.push('');
  lines.push(`저장 파일: \`${OUTPUT_PATH}\``);

  return lines.join('\n');
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const seenRecordIds = new Set();
  const seenUserIds = new Set();
  const users = new Map();

  let after = '';
  let page = 0;
  let scannedRecords = 0;

  console.log(`[scan] leaderboard=${LEADERBOARD} limit=${LIMIT} delay=${DELAY_MS}ms maxPages=${Number.isFinite(MAX_PAGES) ? MAX_PAGES : 'all'}`);
  console.log(`[scan] session=${SESSION_ID}`);

  while (true) {
    page += 1;

    const entries = await fetchRecordPage(after);

    if (entries.length === 0) {
      console.log('[scan] no more entries');
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

      scannedRecords += 1;

      const user = getRecordUser(entry);
      const userId = getUserId(user);
      const username = getUsername(user);

      if (!userId && !username) {
        continue;
      }

      const key = userId || username.toLowerCase();

      if (!seenUserIds.has(key)) {
        seenUserIds.add(key);
        users.set(key, {
          id: userId,
          username,
          recordId,
          replayId: entry?.replayid ?? '',
          score: entry?.results?.stats?.finaltime ?? entry?.p?.pri ?? null,
          ts: entry?.ts ?? '',
          rawUser: user,
        });
      }
    }

    const last = entries.at(-1);
    const nextAfter = toPrisecter(last?.p);

    console.log(
      `[page ${page}] entries=${entries.length} scannedRecords=${scannedRecords} uniqueUsers=${users.size} nextAfter=${nextAfter || '-'}`
    );

    if (page >= MAX_PAGES) {
      console.log(`[scan] reached max pages=${MAX_PAGES}`);
      break;
    }

    if (!nextAfter || nextAfter === after) {
      console.log('[scan] pagination stopped: no next after');
      break;
    }

    after = nextAfter;
    await sleep(DELAY_MS);
  }

  console.log(`[users] checking roles for ${users.size} users...`);

  const banned = [];
  let checked = 0;

  for (const user of users.values()) {
    checked += 1;

    const lookup = user.id || user.username;

    try {
      const detail = await fetchUserDetail(lookup);
      const role = String(detail?.role ?? '').toLowerCase();

      if (role === 'banned') {
        const row = {
          username: detail?.username ?? user.username,
          id: detail?._id ?? user.id,
          role,
          badstanding: Boolean(detail?.badstanding),
          recordId: user.recordId,
          replayId: user.replayId,
          score: user.score,
          scoreText: formatTimeMs(user.score),
          ts: user.ts,
        };

        banned.push(row);

        console.log(
          `[BANNED] ${row.username} id=${row.id} score=${row.scoreText} replay=${row.replayId || '-'}`
        );
      }
    } catch (error) {
      console.error(`[user ${checked}/${users.size}] failed lookup=${lookup}`);
      console.error(error);
    }

    if (checked % 50 === 0 || checked === users.size) {
      console.log(`[users] checked=${checked}/${users.size} banned=${banned.length}`);
    }

    await sleep(DELAY_MS);
  }

  const result = {
    leaderboard: LEADERBOARD,
    scannedPages: page,
    scannedRecords,
    uniqueUsers: users.size,
    bannedCount: banned.length,
    scannedAt: new Date().toISOString(),
    banned,
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(result, null, 2), 'utf8');

  console.log('');
  console.log(`=== BANNED USERS IN ${LEADERBOARD} ===`);

  if (banned.length === 0) {
    console.log('없음');
  } else {
    for (const user of banned) {
      console.log(`${user.username}`);
    }
  }

  console.log('');
  console.log(`[saved] ${OUTPUT_PATH}`);

  const discordMessage = buildDiscordResultMessage(result);

  try {
    await sendDiscordMessage(discordMessage);
    console.log(`[discord] result posted to channel=${DISCORD_RESULT_CHANNEL_ID}`);
  } catch (error) {
    console.error('[discord] failed to post result');
    console.error(error);
  }
}

main().catch((error) => {
  console.error('[fatal]');
  console.error(error);
  process.exit(1);
});