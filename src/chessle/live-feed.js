import fs from 'node:fs/promises';
import path from 'node:path';

const snowflake = /^\d{15,22}$/;
const colors = { green: '🟩', yellow: '🟨', gray: '⬛' };
const modes = { normal: '노멀', expert: '익스퍼트' };

function previousDate(date) {
  const at = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(at.getTime())) return '';
  at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString().slice(0, 10);
}

export function guildStreak(winningDates, date) {
  const wins = new Set(winningDates);
  let cursor = wins.has(date) ? date : previousDate(date);
  let count = 0;
  while (wins.has(cursor) && count < 10000) {
    count++;
    cursor = previousDate(cursor);
  }
  return count;
}

export function renderChessleLiveBoard(board, winningDates = []) {
  const streak = guildStreak(winningDates, board.date);
  const users = Object.entries(board.players || {})
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
  const rows = [
    `♟️ **Chessle · ${modes[board.mode] || '노멀'}** | ${board.date}`,
    `🔥 서버 연속 성공: **${streak}일** · 참여 ${users.length}명`,
    '',
  ];
  for (const [userId, player] of users.slice(0, 6)) {
    if (!snowflake.test(userId)) continue;
    const outcome = player.solved ? '✅ 성공' : player.finished ? '❌ 종료' : '진행 중';
    const entry = [
      `**<@${userId}>** · ${outcome} (${player.attempt}/6)`,
      ...(player.rows || []).slice(-6).map(line =>
        line.map(color => colors[color] || '⬛').join('')
      ),
    ];
    if ([...rows, ...entry].join('\n').length > 1650) break;
    rows.push(...entry, '');
  }
  if (users.length > 6) rows.push(`외 ${users.length - 6}명 참가`);
  rows.push('수순을 제출하면 이 메시지가 갱신됩니다.');
  return rows.join('\n').slice(0, 1900);
}

export function isChessleLiveEvent(event) {
  return Boolean(event && typeof event === 'object'
    && typeof event.id === 'string' && event.id.length <= 160
    && snowflake.test(event.userId)
    && /^\d{4}-\d{2}-\d{2}$/.test(event.date)
    && Object.hasOwn(modes, event.mode)
    && /^[\w-]{8,240}$/.test(event.instanceId)
    && Number.isInteger(event.attempt) && event.attempt >= 1 && event.attempt <= 6
    && Array.isArray(event.result)
    && event.result.length === (event.mode === 'expert' ? 10 : 6)
    && event.result.every(cell => Object.hasOwn(colors, cell))
    && typeof event.solved === 'boolean'
    && typeof event.finished === 'boolean'
    && Number.isFinite(event.createdAt));
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await fs.rename(temporary, file);
}

export function createChessleLiveMonitor({
  client, botToken, applicationId, gamesFile, stateFile,
  fetchImpl = fetch, intervalMs = 2500, now = () => Date.now(),
} = {}) {
  if (!gamesFile || !stateFile || !botToken || !applicationId) {
    return { enabled: false, async tick() {}, start() {}, stop() {} };
  }
  let timer = null;
  let busy = false;
  let state = null;

  async function verify(event) {
    const url = `https://discord.com/api/v10/applications/${applicationId}/activity-instances/${encodeURIComponent(event.instanceId)}`;
    const response = await fetchImpl(url, {
      headers: { authorization: `Bot ${botToken}` },
      signal: AbortSignal.timeout(4000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw Error(`Activity verification HTTP ${response.status}`);
    const instance = await response.json();
    const location = instance.location || {};
    if (instance.instance_id !== event.instanceId
      || !Array.isArray(instance.users)
      || !instance.users.some(id => String(id) === event.userId)
      || !snowflake.test(location.guild_id || '')
      || !snowflake.test(location.channel_id || '')) return null;
    return { guildId: location.guild_id, channelId: location.channel_id };
  }

  async function post(board, guildWins) {
    const channel = await client.channels.fetch(board.channelId).catch(() => null);
    if (!channel || channel.guildId !== board.guildId || typeof channel.send !== 'function') return;
    const payload = { content: renderChessleLiveBoard(board, Object.keys(guildWins)), allowedMentions: { parse: [] } };
    if (board.messageId) {
      try {
        const existing = await channel.messages.fetch(board.messageId);
        await existing.edit(payload);
        return;
      } catch (error) {
        if (error.code !== 10008) throw error;
      }
    }
    const posted = await channel.send(payload);
    board.messageId = posted.id;
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      if (!state) state = await readJson(stateFile, { version: 1, processed: {}, boards: {}, guildWins: {} });
      const games = await readJson(gamesFile, { liveEvents: [] });
      const events = Array.isArray(games.liveEvents) ? games.liveEvents : [];
      let processed = 0;
      for (const event of events) {
        if (processed >= 30) break;
        if (!isChessleLiveEvent(event) || state.processed[event.id]) continue;
        // Do not publish stale or unverifiable attempts into Discord channels.
        if (Math.abs(now() - event.createdAt) > 10 * 60 * 1000) {
          state.processed[event.id] = now();
          continue;
        }
        const location = await verify(event);
        if (!location) continue; // Retry while this Activity is still running.
        if (!client.guilds.cache.has(location.guildId)) continue;
        const { guildId, channelId } = location;
        const key = `${guildId}:${channelId}:${event.date}:${event.mode}`;
        const board = state.boards[key] ||= { guildId, channelId, date: event.date, mode: event.mode, players: {} };
        const player = board.players[event.userId] ||= { rows: [], attempt: 0, solved: false, finished: false };
        if (event.attempt > player.attempt && event.attempt <= 6) {
          player.rows.push(event.result);
          player.attempt = event.attempt;
          player.solved = event.solved;
          player.finished = event.finished;
          player.updatedAt = event.createdAt;
        }
        const wins = state.guildWins[guildId] ||= {};
        if (event.solved) {
          const members = wins[event.date] ||= [];
          if (!members.includes(event.userId)) members.push(event.userId);
        }
        // Persist progress before attempting Discord delivery; if posting fails
        // this event will retry without incrementing win counts twice.
        await atomicJson(stateFile, state);
        try { await post(board, wins); }
        catch (error) { console.error('[CHESSLE LIVE] Discord message:', error.message); continue; }
        state.processed[event.id] = now();
        if (Object.keys(state.processed).length > 12000) {
          const sorted = Object.entries(state.processed).sort((a, b) => a[1] - b[1]);
          for (const [id] of sorted.slice(0, sorted.length - 10000)) delete state.processed[id];
        }
        await atomicJson(stateFile, state);
        processed++;
      }
    } finally { busy = false; }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => void tick().catch(error =>
      console.error('[CHESSLE LIVE]', error.message)), intervalMs);
    timer.unref?.();
    void tick().catch(error => console.error('[CHESSLE LIVE]', error.message));
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { enabled: true, tick, start, stop };
}
