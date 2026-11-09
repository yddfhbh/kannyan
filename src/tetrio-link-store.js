import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const validId = (value) => /^\d{17,20}$/.test(String(value ?? ''));
const validNickname = (value) => typeof value === 'string' && /^[a-z0-9_-]{1,16}$/i.test(value);
const validTetrioId = (value) => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);

function normalizeEntry(entry) {
  if (typeof entry === 'string') {
    if (!validNickname(entry)) throw new Error('Invalid TETR.IO link entry');
    return { username: entry.toLowerCase(), id: null };
  }
  if (!entry || typeof entry !== 'object' || !validNickname(entry.username)) {
    throw new Error('Invalid TETR.IO link entry');
  }
  if (entry.id !== null && entry.id !== undefined && !validTetrioId(entry.id)) {
    throw new Error('Invalid TETR.IO link entry');
  }
  return { username: entry.username.toLowerCase(), id: entry.id?.toLowerCase() ?? null };
}

// One store per bot process. Mutations commit to memory only after the atomic write succeeds.
export class TetrioLinkStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.links = new Map();
    this.saveQueue = Promise.resolve();
    this.loadPromise = null;
  }

  load() {
    this.loadPromise ??= this.read();
    return this.loadPromise;
  }

  async read() {
    let raw;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    const payload = JSON.parse(raw);
    if (![1, 2].includes(payload?.version) || !payload.links || typeof payload.links !== 'object' || Array.isArray(payload.links)) {
      throw new Error('Invalid TETR.IO link store');
    }
    const links = new Map();
    for (const [id, entry] of Object.entries(payload.links)) {
      if (!validId(id)) throw new Error('Invalid TETR.IO link entry');
      links.set(id, normalizeEntry(entry));
    }
    this.links = links;
  }

  async getNickname(discordUserId) {
    await this.load();
    return this.links.get(String(discordUserId))?.username ?? null;
  }

  async getLink(discordUserId) {
    await this.load();
    const entry = this.links.get(String(discordUserId));
    return entry ? { ...entry } : null;
  }

  setNickname(discordUserId, nickname) {
    const id = String(discordUserId ?? '');
    if (!validId(id) || !validNickname(nickname)) return Promise.reject(new Error('Invalid TETR.IO link'));
    const save = this.saveQueue.catch(() => {}).then(async () => {
      await this.load();
      for (const [otherId, other] of this.links) {
        if (otherId !== id && other.username === nickname.toLowerCase()) {
          const error = new Error('TETR.IO username is already linked');
          error.code = 'TETRIO_LINK_DUPLICATE';
          throw error;
        }
      }
      const links = new Map(this.links);
      links.set(id, { username: nickname.toLowerCase(), id: null });
      await this.writeLinks(links);
      this.links = links;
      return links.get(id).username;
    });
    this.saveQueue = save;
    return save;
  }

  setAccount(discordUserId, account) {
    const id = String(discordUserId ?? '');
    const entry = normalizeEntry(account);
    if (!validId(id)) return Promise.reject(new Error('Invalid TETR.IO link'));
    const save = this.saveQueue.catch(() => {}).then(async () => {
      await this.load();
      for (const [otherId, other] of this.links) {
        if (otherId !== id && entry.id && other.id === entry.id) {
          const error = new Error('TETR.IO account is already linked');
          error.code = 'TETRIO_LINK_DUPLICATE';
          throw error;
        }
        if (otherId !== id && other.username === entry.username && (!entry.id || !other.id)) {
          const error = new Error('TETR.IO username is already linked');
          error.code = 'TETRIO_LINK_DUPLICATE';
          throw error;
        }
      }
      const links = new Map(this.links);
      links.set(id, entry);
      await this.writeLinks(links);
      this.links = links;
      return { ...entry };
    });
    this.saveQueue = save;
    return save;
  }

  deleteLink(discordUserId) {
    const id = String(discordUserId ?? '');
    if (!validId(id)) return Promise.reject(new Error('Invalid TETR.IO link'));
    const save = this.saveQueue.catch(() => {}).then(async () => {
      await this.load();
      const before = this.links.get(id);
      if (!before) return null;
      const links = new Map(this.links);
      links.delete(id);
      await this.writeLinks(links);
      this.links = links;
      return { ...before };
    });
    this.saveQueue = save;
    return save;
  }

  async writeLinks(links) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmpPath, `${JSON.stringify({ version: 2, links: Object.fromEntries(links) }, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(tmpPath, this.filePath);
    } finally {
      await fs.rm(tmpPath, { force: true });
    }
  }
}
