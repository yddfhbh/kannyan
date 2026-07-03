import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const STARFORCE_SAVE_STORE_PATH =
  fileURLToPath(new URL('../../data/starforce-saves.json', import.meta.url));
const STARFORCE_SAVE_STORE_TEMP_PATH =
  fileURLToPath(new URL('../../data/starforce-saves.tmp.json', import.meta.url));

let loaded = false;
let saveSlots = new Map();
let savePromise = Promise.resolve();

export async function ensureStarforceSaveSlotsLoaded() {
  if (loaded) {
    return;
  }

  await mkdir(fileURLToPath(new URL('../../data/', import.meta.url)), { recursive: true });

  try {
    const raw = await readFile(STARFORCE_SAVE_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const nextMap = new Map();

    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        const sanitized = sanitizeSaveSlotEntry(entry);
        if (!sanitized) {
          continue;
        }
        nextMap.set(sanitized.ownerUserId, sanitized);
      }
    }

    saveSlots = nextMap;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('[STARFORCE] failed to load save slots:');
      console.error(error);
    }
    saveSlots = new Map();
  }

  loaded = true;
}

export async function getStarforceSaveSlot(ownerUserId) {
  await ensureStarforceSaveSlotsLoaded();
  return saveSlots.get(String(ownerUserId)) ?? null;
}

export async function setStarforceSaveSlot(entry) {
  await ensureStarforceSaveSlotsLoaded();

  const sanitized = sanitizeSaveSlotEntry(entry);
  if (!sanitized) {
    return null;
  }

  saveSlots.set(sanitized.ownerUserId, sanitized);
  await persistStarforceSaveSlots();
  return sanitized;
}

async function persistStarforceSaveSlots() {
  savePromise = savePromise
    .catch(() => {
      // Keep save queue alive after a failed write.
    })
    .then(async () => {
      const payload = JSON.stringify(Array.from(saveSlots.values()), null, 2);
      await writeFile(STARFORCE_SAVE_STORE_TEMP_PATH, payload, 'utf8');
      await rename(STARFORCE_SAVE_STORE_TEMP_PATH, STARFORCE_SAVE_STORE_PATH);
    });

  await savePromise;
}

function sanitizeSaveSlotEntry(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const ownerUserId = String(value.ownerUserId ?? '').trim();
  const level = Number(value.level);
  const equipLevel = Number(value.equipLevel ?? value.level);
  const maxStar = Number(value.maxStar);
  const currentStar = Number(value.currentStar);
  const totalMesos = Number(value.totalMesos ?? value.mesoUsed ?? 0);
  const mesoUsed = Number(value.mesoUsed ?? value.totalMesos ?? 0);
  const attemptCount = Number(value.attemptCount ?? value.attempts ?? 0);
  const attempts = Number(value.attempts ?? value.attemptCount ?? 0);
  const destroyCount = Number(value.destroyCount ?? value.destroyed ?? 0);
  const destroyed = Number(value.destroyed ?? value.destroyCount ?? 0);
  const recoveryStar = Number(value.recoveryStar ?? 12);
  const consecutiveDropCount = Number(value.consecutiveDropCount ?? 0);
  const chanceTimePending = Boolean(value.chanceTimePending);
  const imageAssetPath = String(value.imageAssetPath ?? '').trim();
  const savedAtMs = Number(value.savedAtMs ?? Date.now());
  const event = value.event && typeof value.event === 'object'
    ? {
      name: String(value.event.name ?? '없음'),
      discount30: Boolean(value.event.discount30),
      fiveTenFifteen: Boolean(value.event.fiveTenFifteen),
      destroyReduction: Boolean(value.event.destroyReduction),
      safeguard: Boolean(value.event.safeguard),
      starCatch: Boolean(value.event.starCatch),
    }
    : null;

  if (!ownerUserId || !Number.isFinite(level) || !Number.isFinite(currentStar)) {
    return null;
  }

  return {
    ownerUserId,
    level,
    equipLevel: Number.isFinite(equipLevel) ? equipLevel : level,
    maxStar: Number.isFinite(maxStar) ? maxStar : 25,
    currentStar,
    totalMesos: Number.isFinite(totalMesos) ? totalMesos : 0,
    mesoUsed: Number.isFinite(mesoUsed) ? mesoUsed : 0,
    attemptCount: Number.isFinite(attemptCount) ? attemptCount : 0,
    attempts: Number.isFinite(attempts) ? attempts : 0,
    destroyCount: Number.isFinite(destroyCount) ? destroyCount : 0,
    destroyed: Number.isFinite(destroyed) ? destroyed : 0,
    recoveryStar: Number.isFinite(recoveryStar) ? recoveryStar : 12,
    consecutiveDropCount: Number.isFinite(consecutiveDropCount) ? consecutiveDropCount : 0,
    chanceTimePending,
    imageAssetPath,
    savedAtMs: Number.isFinite(savedAtMs) ? savedAtMs : Date.now(),
    event,
  };
}
