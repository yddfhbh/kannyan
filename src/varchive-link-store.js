import fs from 'node:fs/promises';
import path from 'node:path';

const discordUserIdPattern = /^\d{17,20}$/;
const validVArchiveButtons = new Set([4, 5, 6, 8]);

export class VArchiveLinkStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.links = new Map();
    this.saveQueue = Promise.resolve();
  }

  get size() {
    return this.links.size;
  }

  getNickname(discordUserId) {
    const normalizedDiscordUserId = normalizeDiscordUserId(discordUserId);
    if (!normalizedDiscordUserId) {
      return null;
    }

    return this.links.get(normalizedDiscordUserId)?.nickname ?? null;
  }

  async setNickname(discordUserId, nickname) {
    const normalizedDiscordUserId = normalizeDiscordUserId(discordUserId);
    if (!normalizedDiscordUserId) {
      const error = new Error('디스코드 유저 아이디가 올바르지 않다냥.');
      error.code = 'INVALID_DISCORD_USER_ID';
      throw error;
    }

    const normalizedNickname = normalizeVArchiveNickname(nickname);
    const now = Date.now();
    const existing = this.links.get(normalizedDiscordUserId);

    this.links.set(normalizedDiscordUserId, {
      nickname: normalizedNickname,
      linkedAtMs: existing?.linkedAtMs ?? now,
      updatedAtMs: now,
    });

    await this.queueSave();
    return this.links.get(normalizedDiscordUserId);
  }

  async load() {
    let raw = '';

    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return;
      }

      throw error;
    }

    const parsed = JSON.parse(raw);
    this.links.clear();

    for (const [discordUserId, entry] of Object.entries(parsed?.links ?? {})) {
      const normalizedDiscordUserId = normalizeDiscordUserId(discordUserId);
      if (!normalizedDiscordUserId) {
        continue;
      }

      try {
        const nickname = normalizeVArchiveNickname(entry?.nickname ?? entry);
        const linkedAtMs = Number(entry?.linkedAtMs);
        const updatedAtMs = Number(entry?.updatedAtMs);

        this.links.set(normalizedDiscordUserId, {
          nickname,
          linkedAtMs: Number.isFinite(linkedAtMs) ? linkedAtMs : Date.now(),
          updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now(),
        });
      } catch {
        // Invalid saved entries are skipped so one bad row does not block startup.
      }
    }
  }

  async save() {
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      links: Object.fromEntries(
        [...this.links.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([discordUserId, entry]) => [
            discordUserId,
            {
              nickname: entry.nickname,
              linkedAtMs: entry.linkedAtMs,
              updatedAtMs: entry.updatedAtMs,
            },
          ])
      ),
    };

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await fs.rename(tmpPath, this.filePath);
  }

  queueSave() {
    this.saveQueue = this.saveQueue
      .catch(() => {})
      .then(() => this.save());

    return this.saveQueue;
  }
}

export function normalizeVArchiveNickname(value) {
  const nickname = extractNicknameFromVArchiveUrl(value) ?? String(value ?? '').trim();

  if (!nickname) {
    const error = new Error('V-ARCHIVE 닉네임을 입력해달라냥.');
    error.code = 'INVALID_NICKNAME';
    throw error;
  }

  if (nickname.length > 40) {
    const error = new Error('닉네임이 너무 길다냥.');
    error.code = 'INVALID_NICKNAME';
    throw error;
  }

  return nickname;
}

export function parseVArchiveButtonToken(value) {
  const trimmed = String(value ?? '').trim().toLowerCase();
  const match = trimmed.match(/^(4|5|6|8)(?:b|버튼|키)?$/i);

  if (!match) {
    return null;
  }

  const button = Number(match[1]);
  return validVArchiveButtons.has(button) ? button : null;
}

export function parseVArchiveTierLookupInput(input, fallbackNickname = null) {
  const trimmed = String(input ?? '').trim();
  const normalizedFallbackNickname = fallbackNickname
    ? normalizeVArchiveNickname(fallbackNickname)
    : null;

  if (!trimmed) {
    return {
      nickname: normalizedFallbackNickname,
      button: null,
      usedFallbackNickname: Boolean(normalizedFallbackNickname),
    };
  }

  const tokens = trimmed.split(/\s+/);
  const lastToken = tokens[tokens.length - 1];
  const button = parseVArchiveButtonToken(lastToken);

  if (button !== null) {
    const nicknameText = trimmed.slice(0, trimmed.length - lastToken.length).trim();
    return {
      nickname: nicknameText
        ? normalizeVArchiveNickname(nicknameText)
        : normalizedFallbackNickname,
      button,
      usedFallbackNickname: !nicknameText && Boolean(normalizedFallbackNickname),
    };
  }

  return {
    nickname: normalizeVArchiveNickname(trimmed),
    button: null,
    usedFallbackNickname: false,
  };
}

function normalizeDiscordUserId(value) {
  const trimmed = String(value ?? '').trim();
  return discordUserIdPattern.test(trimmed) ? trimmed : null;
}

function extractNicknameFromVArchiveUrl(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/^\/archive\/([^/]+)/i);
    if (match) {
      return decodeURIComponent(match[1]).trim();
    }
  } catch {
    // Plain nicknames are expected most of the time.
  }

  return null;
}
