import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const CHECK_INTERVAL_MS = 5 * 60_000;
const USER_AGENT = 'kannyan-discord-bot/1.0 (https://github.com/yddfhbh/kannyan)';
const names = { chesscom: 'Chess.com', lichess: 'Lichess' };

export function normalizeAccount(platform, input) {
  const username = String(input ?? '').trim();
  if (!names[platform] || !/^[a-z0-9_-]{1,32}$/i.test(username)) {
    throw new Error('플랫폼 또는 닉네임이 올바르지 않습니다. 닉네임은 영문, 숫자, _, -만 입력해 주세요.');
  }
  return username.toLowerCase();
}

export function describeStatus(platform, status) {
  if (platform === 'lichess') return '계정 비활성화/종료 상태 확인 (사유 미공개)';
  if (status === 'closed:fair_play_violations') return '공정 플레이 위반에 따른 계정 종료 상태';
  if (status === 'closed') return '계정 종료 상태 (구체적인 사유는 확인할 수 없음)';
  return `계정 종료 상태 (API 상태: ${status}; 구체적인 사유는 확인할 수 없음)`;
}

export function profileUrl(platform, username) {
  return platform === 'chesscom'
    ? `https://www.chess.com/member/${encodeURIComponent(username)}`
    : `https://lichess.org/@/${encodeURIComponent(username)}`;
}

export function formatKst(time) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(time));
}

function retryAfterMs(value, now) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

export async function queryAccount(platform, username, { fetchImpl = fetch, now = Date.now() } = {}) {
  const url = platform === 'chesscom'
    ? `https://api.chess.com/pub/player/${encodeURIComponent(username)}`
    : `https://lichess.org/api/user/${encodeURIComponent(username)}`;
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return { kind: 'error', reason: `네트워크 오류: ${error.message}` };
  }
  if (response.status === 404) return { kind: 'not_found', reason: '사용자를 찾을 수 없습니다 (HTTP 404)' };
  if (!response.ok) {
    const delay = response.status === 429
      ? Math.max(platform === 'lichess' ? 60_000 : CHECK_INTERVAL_MS, retryAfterMs(response.headers?.get('retry-after'), now))
      : 0;
    return { kind: 'error', reason: `HTTP ${response.status}`, retryAfterMs: delay };
  }
  let body;
  try { body = await response.json(); } catch {
    return { kind: 'error', reason: 'JSON 파싱 오류' };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { kind: 'error', reason: '예상하지 못한 응답 형식' };
  }
  if (platform === 'chesscom') {
    if (typeof body.status !== 'string' || !body.status.trim()) return { kind: 'error', reason: 'status 필드 누락' };
    const status = body.status;
    return { kind: status === 'closed' || status.startsWith('closed:') ? 'closed' : 'active', status };
  }
  if (typeof body.disabled !== 'boolean') return { kind: 'error', reason: 'disabled 필드 누락' };
  return { kind: body.disabled ? 'closed' : 'active', status: body.disabled ? 'disabled' : 'active' };
}

export class ChessAccountMonitor {
  constructor({ filePath, sendAlert, fetchImpl = fetch, now = Date.now, logger = console, intervalMs = CHECK_INTERVAL_MS }) {
    this.filePath = filePath;
    this.sendAlert = sendAlert;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.logger = logger;
    this.intervalMs = intervalMs;
    this.accounts = new Map();
    this.cooldown = { chesscom: 0, lichess: 0 };
    this.queue = Promise.resolve();
    this.timer = null;
    this.loaded = false;
  }

  enqueue(work) {
    const result = this.queue.then(work);
    this.queue = result.catch((error) => this.logger.error('[CHESS MONITOR] 작업 실패:', error));
    return result;
  }

  async load() {
    if (this.loaded) return;
    let raw;
    try { raw = await fs.readFile(this.filePath, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.version !== 1 || !Array.isArray(parsed.accounts)) throw new Error('Invalid chess monitor state');
      for (const platform of Object.keys(this.cooldown)) {
        const saved = Number(parsed.cooldown?.[platform]);
        if (Number.isFinite(saved) && saved > 0) this.cooldown[platform] = saved;
      }
      for (const account of parsed.accounts) {
        const username = normalizeAccount(account.platform, account.username);
        if (!account.channels || typeof account.channels !== 'object') throw new Error('Invalid chess monitor channels');
        this.accounts.set(`${account.platform}:${username}`, { ...account, username });
      }
    }
    this.loaded = true;
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify({ version: 1, cooldown: this.cooldown, accounts: [...this.accounts.values()] }, null, 2), { mode: 0o600 });
      await fs.rename(temp, this.filePath);
    } finally { await fs.rm(temp, { force: true }); }
  }

  async start() {
    await this.enqueue(() => this.load());
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, 30_000);
    await this.tick();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  register({ platform, username, channelId, userId }) {
    return this.enqueue(async () => {
      await this.load();
      username = normalizeAccount(platform, username);
      const key = `${platform}:${username}`;
      let account = this.accounts.get(key);
      const now = this.now();
      if (account?.channels[channelId]?.owners[userId]) return { kind: 'duplicate', account };
      if (now < this.cooldown[platform]) return { kind: 'error', reason: 'API 호출 제한으로 잠시 후 다시 시도해 주세요.' };
      let result;
      const lastVerifiedAt = account?.lastVerifiedAt ?? (account?.failures ? 0 : account?.lastCheckedAt);
      if (account && lastVerifiedAt && now - lastVerifiedAt < this.intervalMs && account.status !== 'closed') {
        result = { kind: 'active', status: account.status };
      } else {
        result = await queryAccount(platform, username, { fetchImpl: this.fetchImpl, now });
      }
      if (result.kind === 'closed' || result.kind === 'not_found') return result;
      if (result.kind === 'error') {
        if (result.retryAfterMs) {
          this.cooldown[platform] = now + result.retryAfterMs;
          await this.save();
        }
        return result;
      }
      account ??= { platform, username, channels: {}, failures: 0 };
      account.status = result.status;
      account.lastCheckedAt = now;
      account.lastVerifiedAt = now;
      account.nextCheckAt = now + this.intervalMs;
      account.channels[channelId] ??= { owners: {} };
      account.channels[channelId].owners[userId] = now;
      this.accounts.set(key, account);
      await this.save();
      return { kind: 'registered', account };
    });
  }

  list(channelId) {
    return this.enqueue(async () => {
      await this.load();
      return [...this.accounts.values()].filter((account) => account.channels[channelId]);
    });
  }

  remove({ platform, username, channelId, userId, admin = false }) {
    return this.enqueue(async () => {
      await this.load();
      username = normalizeAccount(platform, username);
      const key = `${platform}:${username}`;
      const account = this.accounts.get(key);
      const channel = account?.channels[channelId];
      if (!channel) return 'missing';
      if (!admin && !channel.owners[userId]) return 'forbidden';
      if (admin) delete account.channels[channelId];
      else {
        delete channel.owners[userId];
        if (!Object.keys(channel.owners).length) delete account.channels[channelId];
      }
      if (!Object.keys(account.channels).length) this.accounts.delete(key);
      await this.save();
      return 'removed';
    });
  }

  tick() {
    return this.enqueue(async () => {
      await this.load();
      for (const [key, account] of this.accounts) {
        const now = this.now();
        if (now < account.nextCheckAt || now < this.cooldown[account.platform]) continue;
        let result = account.status === 'closed'
          ? { kind: 'closed', status: account.closedStatus }
          : await queryAccount(account.platform, account.username, { fetchImpl: this.fetchImpl, now });
        if (result.kind === 'closed') {
          const checkedAt = account.closedAt ?? now;
          account.status = 'closed';
          account.closedStatus = result.status;
          account.closedAt = checkedAt;
          account.lastCheckedAt = checkedAt;
          account.lastVerifiedAt = checkedAt;
          account.nextCheckAt = now + this.intervalMs;
          await this.save();
          for (const channelId of Object.keys(account.channels)) {
            try {
              await this.sendAlert(channelId, account, checkedAt);
              delete account.channels[channelId];
              await this.save();
            } catch (error) { this.logger.error(`[CHESS MONITOR] 알림 실패 ${key} ${channelId}:`, error); }
          }
          if (!Object.keys(account.channels).length) { this.accounts.delete(key); await this.save(); }
        } else if (result.kind === 'active') {
          account.status = result.status;
          account.lastCheckedAt = now;
          account.lastVerifiedAt = now;
          account.nextCheckAt = now + this.intervalMs;
          account.failures = 0;
          await this.save();
        } else {
          account.failures = Math.min((account.failures || 0) + 1, 6);
          account.lastCheckedAt = now;
          const backoff = Math.min(this.intervalMs * 2 ** (account.failures - 1), 60 * 60_000);
          account.nextCheckAt = now + Math.max(backoff, result.retryAfterMs || 0);
          if (result.retryAfterMs) this.cooldown[account.platform] = now + result.retryAfterMs;
          this.logger.error(`[CHESS MONITOR] 조회 실패 ${key}: ${result.reason}`);
          await this.save();
        }
      }
    });
  }
}

export { names as platformNames };
