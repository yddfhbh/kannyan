import fs from 'node:fs/promises';
import path from 'node:path';

export function createGeminiSessionKey(message = {}) {
  const guildId = String(message.guildId ?? '').trim();
  const channelId = String(message.channelId ?? '').trim();
  const threadId = String(
    message.threadId
      ?? (message.channel?.isThread?.() ? message.channelId : '')
      ?? ''
  ).trim();

  if (!channelId) {
    throw new TypeError('Gemini session channelId is required.');
  }

  if (guildId) {
    return `guild:${guildId}:channel:${channelId}:thread:${threadId || 'root'}`;
  }

  const userId = String(message.author?.id ?? message.userId ?? '').trim();
  return `dm:${userId || 'unknown-user'}:channel:${channelId}:thread:${threadId || 'root'}`;
}

export function createGeminiChatContents(contextualPrompt, imageParts = []) {
  return [{
    role: 'user',
    parts: [
      { text: String(contextualPrompt ?? '') },
      ...(Array.isArray(imageParts) ? imageParts : []),
    ],
  }];
}

export class GeminiMemoryStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.retentionMs = Number(options.retentionMs) || 45 * 24 * 60 * 60 * 1000;
    this.maxMessagesPerSession = Number(options.maxMessagesPerSession) || 50;
    this.maxEntryLength = Number(options.maxEntryLength) || 4000;
    this.sessions = new Map();
    this.loaded = false;
    this.loadPromise = null;
    this.saveQueue = Promise.resolve();
  }

  async ensureLoaded() {
    if (this.loaded) return;
    this.loadPromise ??= this.load();
    await this.loadPromise;
  }

  getHistory(sessionKey) {
    this.prune();
    const entries = this.sessions.get(sessionKey)
      ?? this.sessions.get(getLegacySessionKey(sessionKey))
      ?? [];
    return [...entries].slice(-this.maxMessagesPerSession);
  }

  append(sessionKey, entry) {
    const entries = this.sessions.get(sessionKey) ?? [];
    entries.push({
      role: entry.role === 'model' ? 'model' : 'user',
      authorName: String(entry.authorName ?? 'Unknown').slice(0, 80),
      text: truncateMemoryText(entry.text, this.maxEntryLength),
      timestamp: Number(entry.timestamp) || Date.now(),
    });
    this.sessions.set(sessionKey, entries.slice(-this.maxMessagesPerSession));
  }

  delete(sessionKey) {
    const deleted = this.sessions.delete(sessionKey);
    return this.sessions.delete(getLegacySessionKey(sessionKey)) || deleted;
  }

  async save() {
    // Callers normally load the store before mutating it, but keeping this
    // invariant here prevents an early save from racing with the first load.
    await this.ensureLoaded();
    this.prune();
    this.saveQueue = this.saveQueue.catch(() => {}).then(async () => {
      const payload = {
        version: 1,
        savedAt: new Date().toISOString(),
        retentionDays: this.retentionMs / (24 * 60 * 60 * 1000),
        sessions: Object.fromEntries(this.sessions.entries()),
      };
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    });
    return this.saveQueue;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const sessions = parsed?.sessions && typeof parsed.sessions === 'object'
        ? parsed.sessions
        : {};
      const entriesAddedWhileLoading = this.sessions;
      const loadedSessions = new Map();
      for (const [sessionKey, entries] of Object.entries(sessions)) {
        if (!Array.isArray(entries)) continue;
        const normalized = entries
          .filter((entry) => entry && typeof entry.text === 'string')
          .map((entry) => ({
            role: entry.role === 'model' ? 'model' : 'user',
            authorName: String(entry.authorName ?? 'Unknown').slice(0, 80),
            text: truncateMemoryText(entry.text, this.maxEntryLength),
            timestamp: Number(entry.timestamp) || Date.now(),
          }));
        if (normalized.length > 0) loadedSessions.set(sessionKey, normalized);
      }

      this.sessions = loadedSessions;
      // `append()` is synchronous, so preserve entries added while the file
      // was being read instead of letting the load overwrite them.
      for (const [sessionKey, entries] of entriesAddedWhileLoading.entries()) {
        const currentEntries = this.sessions.get(sessionKey) ?? [];
        this.sessions.set(
          sessionKey,
          [...currentEntries, ...entries].slice(-this.maxMessagesPerSession)
        );
      }
      this.prune();
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Failed to load Gemini memory:');
        console.error(error);
      }
    } finally {
      this.loaded = true;
    }
  }

  prune(now = Date.now()) {
    const cutoff = now - this.retentionMs;
    for (const [sessionKey, entries] of this.sessions.entries()) {
      const filtered = entries
        .filter((entry) => Number(entry.timestamp) >= cutoff)
        .slice(-this.maxMessagesPerSession);
      if (filtered.length > 0) this.sessions.set(sessionKey, filtered);
      else this.sessions.delete(sessionKey);
    }
  }
}

function truncateMemoryText(value, maxLength) {
  const text = String(value ?? '').trim();
  return text.length <= maxLength
    ? text
    : `${text.slice(0, Math.max(0, maxLength - 20)).trim()}... [생략됨]`;
}

function getLegacySessionKey(sessionKey) {
  const guildMatch = /^guild:([^:]+):channel:([^:]+):thread:root$/.exec(sessionKey);
  if (guildMatch) return `${guildMatch[1]}:${guildMatch[2]}`;

  const dmMatch = /^dm:unknown-user:channel:([^:]+):thread:root$/.exec(sessionKey);
  return dmMatch ? `dm:${dmMatch[1]}` : '';
}
