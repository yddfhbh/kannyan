import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const validId = (value) => /^\d{17,20}$/.test(String(value ?? ''));
const validNickname = (value) => typeof value === 'string' && /^[a-z0-9_-]{1,16}$/i.test(value);

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
    if (payload?.version !== 1 || !payload.links || typeof payload.links !== 'object' || Array.isArray(payload.links)) {
      throw new Error('Invalid TETR.IO link store');
    }
    const links = new Map();
    for (const [id, nickname] of Object.entries(payload.links)) {
      if (!validId(id) || !validNickname(nickname)) throw new Error('Invalid TETR.IO link entry');
      links.set(id, nickname.toLowerCase());
    }
    this.links = links;
  }

  async getNickname(discordUserId) {
    await this.load();
    return this.links.get(String(discordUserId)) ?? null;
  }

  setNickname(discordUserId, nickname) {
    const id = String(discordUserId ?? '');
    if (!validId(id) || !validNickname(nickname)) return Promise.reject(new Error('Invalid TETR.IO link'));
    const save = this.saveQueue.catch(() => {}).then(async () => {
      await this.load();
      const links = new Map(this.links);
      links.set(id, nickname.toLowerCase());
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmpPath = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(tmpPath, `${JSON.stringify({ version: 1, links: Object.fromEntries(links) }, null, 2)}\n`, { mode: 0o600 });
        await fs.rename(tmpPath, this.filePath);
      } finally {
        await fs.rm(tmpPath, { force: true });
      }
      this.links = links;
      return links.get(id);
    });
    this.saveQueue = save;
    return save;
  }
}
