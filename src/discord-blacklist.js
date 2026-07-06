import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BLACKLIST_PATH =
  fileURLToPath(new URL('../data/discord-blacklist.json', import.meta.url));
const BLACKLIST_TEMP_PATH =
  fileURLToPath(new URL('../data/discord-blacklist.tmp.json', import.meta.url));
const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));

let loaded = false;
let blacklistEntries = new Map();
let savePromise = Promise.resolve();

export async function ensureDiscordBlacklistLoaded() {
  if (loaded) {
    return;
  }

  await mkdir(DATA_DIR, { recursive: true });

  try {
    const raw = await readFile(BLACKLIST_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const nextMap = new Map();

    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        const sanitized = sanitizeBlacklistEntry(entry);
        if (!sanitized) {
          continue;
        }
        nextMap.set(sanitized.userId, sanitized);
      }
    }

    blacklistEntries = nextMap;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('[BLACKLIST] failed to load blacklist:');
      console.error(error);
    }
    blacklistEntries = new Map();
  }

  loaded = true;
}

export async function isDiscordUserBlacklisted(userId) {
  await ensureDiscordBlacklistLoaded();
  return blacklistEntries.has(String(userId ?? '').trim());
}

export async function addDiscordBlacklistUser(userId, addedByUserId) {
  await ensureDiscordBlacklistLoaded();

  const normalizedUserId = normalizeDiscordUserId(userId);
  if (!normalizedUserId) {
    return { ok: false, reason: 'invalid_user_id' };
  }

  const existing = blacklistEntries.get(normalizedUserId);
  if (existing) {
    return { ok: true, added: false, entry: existing };
  }

  const entry = {
    userId: normalizedUserId,
    addedByUserId: normalizeDiscordUserId(addedByUserId) ?? '',
    addedAt: new Date().toISOString(),
  };

  blacklistEntries.set(normalizedUserId, entry);
  await persistDiscordBlacklist();
  return { ok: true, added: true, entry };
}

export async function removeDiscordBlacklistUser(userId) {
  await ensureDiscordBlacklistLoaded();

  const normalizedUserId = normalizeDiscordUserId(userId);
  if (!normalizedUserId) {
    return { ok: false, reason: 'invalid_user_id' };
  }

  const existing = blacklistEntries.get(normalizedUserId);
  if (!existing) {
    return { ok: true, removed: false, entry: null };
  }

  blacklistEntries.delete(normalizedUserId);
  await persistDiscordBlacklist();
  return { ok: true, removed: true, entry: existing };
}

export async function listDiscordBlacklistUsers() {
  await ensureDiscordBlacklistLoaded();
  return Array.from(blacklistEntries.values())
    .sort((a, b) => String(a.addedAt ?? '').localeCompare(String(b.addedAt ?? '')));
}

async function persistDiscordBlacklist() {
  savePromise = savePromise
    .catch(() => {
      // Keep save queue alive after a failed write.
    })
    .then(async () => {
      const payload = JSON.stringify(Array.from(blacklistEntries.values()), null, 2);
      await writeFile(BLACKLIST_TEMP_PATH, payload, 'utf8');
      await rename(BLACKLIST_TEMP_PATH, BLACKLIST_PATH);
    });

  await savePromise;
}

function sanitizeBlacklistEntry(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const userId = normalizeDiscordUserId(value.userId);
  if (!userId) {
    return null;
  }

  return {
    userId,
    addedByUserId: normalizeDiscordUserId(value.addedByUserId) ?? '',
    addedAt: String(value.addedAt ?? '').trim() || new Date().toISOString(),
  };
}

function normalizeDiscordUserId(value) {
  const normalized = String(value ?? '').trim();
  return /^\d{17,20}$/.test(normalized) ? normalized : null;
}
