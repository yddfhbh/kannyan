import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const STARFORCE_SESSION_STORE_PATH =
  fileURLToPath(new URL('../../data/starforce-sessions.json', import.meta.url));
const STARFORCE_SESSION_STORE_TEMP_PATH =
  fileURLToPath(new URL('../../data/starforce-sessions.tmp.json', import.meta.url));
const STARFORCE_SESSION_STORE_KEYS = Object.freeze([
  'sessionId',
  'ownerUserId',
  'level',
  'equipLevel',
  'maxStar',
  'currentStar',
  'totalMesos',
  'mesoUsed',
  'attemptCount',
  'attempts',
  'destroyCount',
  'destroyed',
  'pendingRecovery',
  'recoveryStar',
  'consecutiveDropCount',
  'chanceTimePending',
  'recentLogs',
  'event',
  'imageAssetPath',
  'status',
  'startedAtMs',
  'updatedAtMs',
  'expiresAtMs',
  'channelId',
  'messageId',
  'statusText',
]);

let loadPromise = null;
let savePromise = Promise.resolve();

export async function ensureStarforceSessionsLoaded(sessionMap) {
  if (!loadPromise) {
    loadPromise = loadStarforceSessions(sessionMap);
  }

  await loadPromise;
}

export function persistStarforceSessions(sessionMap) {
  savePromise = savePromise
    .catch(() => {
      // Keep the save queue alive after a failed write.
    })
    .then(() => saveStarforceSessions(sessionMap));

  return savePromise;
}

async function loadStarforceSessions(sessionMap) {
  await mkdir(fileURLToPath(new URL('../../data/', import.meta.url)), { recursive: true });

  let raw;
  try {
    raw = await readFile(STARFORCE_SESSION_STORE_PATH, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  if (!Array.isArray(parsed)) {
    return;
  }

  for (const entry of parsed) {
    const session = sanitizeStoredSession(entry);
    if (!session?.sessionId) {
      continue;
    }

    sessionMap.set(session.sessionId, session);
  }
}

async function saveStarforceSessions(sessionMap) {
  await mkdir(fileURLToPath(new URL('../../data/', import.meta.url)), { recursive: true });

  const serializedSessions = [];
  for (const session of sessionMap.values()) {
    if (!session || typeof session !== 'object') {
      continue;
    }

    serializedSessions.push(serializeSession(session));
  }

  const payload = JSON.stringify(serializedSessions, null, 2);
  await writeFile(STARFORCE_SESSION_STORE_TEMP_PATH, payload, 'utf8');
  await rename(STARFORCE_SESSION_STORE_TEMP_PATH, STARFORCE_SESSION_STORE_PATH);
}

function serializeSession(session) {
  const serialized = {};

  for (const key of STARFORCE_SESSION_STORE_KEYS) {
    serialized[key] = cloneJsonValue(session[key]);
  }

  return serialized;
}

function sanitizeStoredSession(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const session = {};

  for (const key of STARFORCE_SESSION_STORE_KEYS) {
    session[key] = cloneJsonValue(value[key]);
  }

  session.pendingRecovery = Boolean(session.pendingRecovery);
  session.consecutiveDropCount = Number(session.consecutiveDropCount || 0);
  session.chanceTimePending = Boolean(session.chanceTimePending);
  session.recentLogs = Array.isArray(session.recentLogs) ? session.recentLogs.slice(-8) : [];
  session.event = session.event && typeof session.event === 'object' ? session.event : {};
  session.status = typeof session.status === 'string' ? session.status : 'active';
  session.statusText = typeof session.statusText === 'string' ? session.statusText : '';

  return session;
}

function cloneJsonValue(value) {
  if (value === undefined) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}
