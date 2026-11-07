import fs from 'node:fs/promises';
import path from 'node:path';

export function createChessleStore(filePath) { let state = { games: {}, stats: {} }; let writeQueue = Promise.resolve(); async function load() { try { state = JSON.parse(await fs.readFile(filePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; } } async function save() { await fs.mkdir(path.dirname(filePath), { recursive: true }); const temp = `${filePath}.${process.pid}.tmp`; await fs.writeFile(temp, JSON.stringify(state), 'utf8'); await fs.rename(temp, filePath); } function update(fn) { writeQueue = writeQueue.then(async () => { fn(state); await save(); }); return writeQueue; } return { load, state: () => state, update }; }
