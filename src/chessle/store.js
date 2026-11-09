import fs from 'node:fs/promises';
import path from 'node:path';

export function createChessleStore(filePath) {
  let state = { games: {}, stats: {} };
  let writeQueue = Promise.resolve();
  async function load() { try { state = JSON.parse(await fs.readFile(filePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  async function save() { await fs.mkdir(path.dirname(filePath), { recursive: true }); const temp = `${filePath}.${process.pid}.tmp`; await fs.writeFile(temp, JSON.stringify(state), 'utf8'); await fs.rename(temp, filePath); }
  // Keep every read-modify-write operation in one queue.  Returning the
  // callback result lets request handlers build their response from exactly
  // the version that was persisted, rather than an earlier in-memory snapshot.
  function update(fn) {
    const operation = writeQueue.then(async () => {
      const result = await fn(state);
      await save();
      return result;
    });
    // A rejected write must not permanently poison later requests.
    writeQueue = operation.catch(() => {});
    return operation;
  }
  return { load, state: () => state, update };
}
