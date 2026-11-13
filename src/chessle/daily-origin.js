import fs from 'node:fs/promises';
import path from 'node:path';
import { getDailyPuzzle, kstDate, validateSequence } from './core.js';

const DEFAULT_ENDPOINT = 'https://d1vwq1uqg5c4bn.cloudfront.net/';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MODES = ['normal', 'expert'];

function validDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value;
}

export function normalizeOriginalDaily(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('Invalid original daily payload');
  if (!validDate(payload.date)) throw Error('Invalid original daily date');
  const id = Number(payload.num ?? payload.chessleNum);
  if (!Number.isSafeInteger(id) || id < 1) throw Error('Invalid original puzzle ID');
  const seq = validateSequence(payload.moves, 10);
  if (!seq.ok) throw Error(`Invalid original opening: ${seq.error}`);
  const names = [payload.name_normal ?? payload.nameNormal, payload.name_expert ?? payload.nameExpert];
  if (names.some(n => typeof n !== 'string' || !n.trim() || n.length > 180)) throw Error('Invalid original opening names');
  return {
    source: 'original', date: payload.date, id,
    moves: seq.moves.map(move => move.san),
    normalName: names[0].trim(), expertName: names[1].trim(),
  };
}

function project(snapshot) {
  if (snapshot.source === 'local') {
    return { date: snapshot.date, source: 'local',
      puzzles: Object.fromEntries(MODES.map(mode => [mode, { ...getDailyPuzzle(snapshot.date, mode), source: 'local' }])) };
  }
  return { date: snapshot.date, source: 'original', originDate: snapshot.date, puzzleId: snapshot.id,
    puzzles: {
      normal: { date: snapshot.date, mode: 'normal', puzzleId: snapshot.id, length: 6, name: snapshot.normalName, eco: '', moves: snapshot.moves.slice(0, 6), source: 'original' },
      expert: { date: snapshot.date, mode: 'expert', puzzleId: snapshot.id, length: 10, name: snapshot.expertName, eco: '', moves: snapshot.moves.slice(0, 10), source: 'original' },
    } };
}

export function createChessleDailyOrigin({
  filePath, fetchImpl = fetch, endpoint = DEFAULT_ENDPOINT,
  now = () => Date.now(), dateKst = () => kstDate(), refreshMs = 60_000,
} = {}) {
  if (!filePath) throw Error('Daily source cache path is required');
  let state = { version: 1, records: {}, fallbacks: {} };
  let loaded = false;
  let active = null;
  let lastCheckedAt = -Infinity;
  let inFlight = null;

  async function load() {
    if (loaded) return;
    try {
      const saved = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (saved.version !== 1 || !saved.records || !saved.fallbacks) throw Error('Invalid daily origin cache format');
      state = saved;
      const remembered = state.activeDate && state.records[state.activeDate]
        ? state.activeDate : Object.keys(state.records).sort().at(-1);
      if (remembered) active = state.records[remembered];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    loaded = true;
  }
  async function persist() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(state), { mode: 0o600 });
      await fs.rename(temp, filePath);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
  async function getFresh() {
    await load();
    const t = now();
    if (active && t - lastCheckedAt < refreshMs) return project(active);
    try {
      const response = await fetchImpl(endpoint, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!response.ok) throw Error(`Original daily HTTP ${response.status}`);
      const raw = await response.text();
      if (raw.length > 20_000) throw Error('Original daily payload too large');
      const daily = normalizeOriginalDaily(JSON.parse(raw));
      // Publisher date is authoritative; ignore stale upstream responses.
      if (!active || daily.date >= active.date) {
        const pinned = state.records[daily.date] || daily;
        if (!state.records[daily.date]) state.records[daily.date] = daily;
        active = pinned;
        if (state.activeDate !== pinned.date) {
          state.activeDate = pinned.date;
          await persist(); // The bot observes this persisted official cursor.
        }
      }
      lastCheckedAt = t;
      return project(active);
    } catch (error) {
      lastCheckedAt = t;
      if (active) return project(active); // Keep the last verified official puzzle.
      throw new Error(`Official Chessle puzzle unavailable: ${error.message}`, { cause: error });
    }
  }
  return {
    load,
    async current({ legacyDates = [] } = {}) {
      if (!inFlight) {
        inFlight = getFresh().finally(() => { inFlight = null; });
      }
      return inFlight;
    },
  };
}
