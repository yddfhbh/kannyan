// src/opening-book.js

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PLAYER = 'bears4347';
const DEFAULT_SPEEDS = 'blitz,rapid,classical';
const DEFAULT_MODES = 'rated';
const DEFAULT_MAX_PLY = 18; // 양쪽 합쳐 9수까지
const DEFAULT_MOVES = 12;
const DEFAULT_TIMEOUT_MS = 3500;
const DEFAULT_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7일
const DEFAULT_PRELOAD_MAX_NODES = 250;
const DEFAULT_PRELOAD_BRANCHES = DEFAULT_MOVES;
const DEFAULT_PRELOAD_DELAY_MS = 60;
const START_POSITION_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const UCI_MOVE_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const disabledEnvPattern = /^(?:0|false|off|no)$/i;

const DEFAULT_DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));
const DEFAULT_CACHE_PATH = path.join(
  process.env.TETRIO_LEAGUE_DATA_DIR
    || process.env.DATA_DIR
    || DEFAULT_DATA_DIR,
  'lichess-player-opening-cache.json',
);
const DEFAULT_MANUAL_BOOK_PATH = path.join(
  process.env.TETRIO_LEAGUE_DATA_DIR
    || process.env.DATA_DIR
    || DEFAULT_DATA_DIR,
  'lichess-player-opening-manual-book.json',
);

const memoryCache = new Map();
const manualBookPositions = new Map();

let cacheLoaded = false;
let loadedCachePath = '';
let cacheDirty = false;
let cacheSaveQueue = Promise.resolve();
let warmupPromise = null;
let manualBookLoaded = false;
let loadedManualBookPath = '';
let manualBookMeta = null;
let manualBookLastModifiedMs = -1;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function moveToUci(move) {
  if (!move?.from || !move?.to) return '';
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

function getTurnColor(chess) {
  return chess.turn() === 'w' ? 'white' : 'black';
}

function getUciHistoryFromChess(chess) {
  if (!chess || typeof chess.history !== 'function') return [];

  try {
    const verboseHistory = chess.history({ verbose: true });

    if (!Array.isArray(verboseHistory)) return [];

    return verboseHistory
      .map((move) => {
        if (!move || typeof move === 'string') return '';
        return moveToUci(move);
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getLegalMovesByUci(chess) {
  const legalMoves = chess.moves({ verbose: true });
  const map = new Map();

  for (const move of legalMoves) {
    const uci = moveToUci(move);
    if (uci) {
      map.set(uci, move);
    }
  }

  return map;
}

function getMoveTotal(move) {
  return Number(move.white ?? 0) + Number(move.draws ?? 0) + Number(move.black ?? 0);
}

function getPlayerScoreRate(move, color) {
  const total = getMoveTotal(move);
  if (total <= 0) return 0.5;

  const wins = color === 'white'
    ? Number(move.white ?? 0)
    : Number(move.black ?? 0);

  const draws = Number(move.draws ?? 0);

  return (wins + 0.5 * draws) / total;
}

function weightedPick(entries) {
  const totalWeight = entries.reduce((sum, entry) => {
    return sum + Math.max(0, Number(entry.weight ?? 0));
  }, 0);

  if (totalWeight <= 0) return entries[0] ?? null;

  let roll = Math.random() * totalWeight;

  for (const entry of entries) {
    roll -= Math.max(0, Number(entry.weight ?? 0));
    if (roll <= 0) return entry;
  }

  return entries.at(-1) ?? null;
}

function toPositiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function toNonNegativeInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function isOpeningBookEnabled(options = {}) {
  if (options.enabled !== undefined) {
    return Boolean(options.enabled);
  }

  return !disabledEnvPattern.test(String(process.env.CHESS_OPENING_ENABLED ?? '').trim());
}

function resolveCachePath(options = {}) {
  return path.resolve(options.cachePath || process.env.CHESS_OPENING_CACHE_PATH || DEFAULT_CACHE_PATH);
}

function resolveManualBookPath(options = {}) {
  return path.resolve(
    options.manualBookPath
    || process.env.CHESS_OPENING_MANUAL_BOOK_PATH
    || DEFAULT_MANUAL_BOOK_PATH
  );
}

function getCacheKey(params) {
  return JSON.stringify({
    player: params.player,
    color: params.color,
    play: params.play,
    fen: params.fen,
    speeds: params.speeds,
    modes: params.modes,
    moves: params.moves,
    since: params.since,
    until: params.until,
  });
}

function getOpeningBookConfig(options = {}) {
  return {
    player: options.player || process.env.CHESS_OPENING_PLAYER || DEFAULT_PLAYER,
    speeds: options.speeds || process.env.CHESS_OPENING_SPEEDS || DEFAULT_SPEEDS,
    modes: options.modes || process.env.CHESS_OPENING_MODES || DEFAULT_MODES,
    maxPly: toPositiveInt(
      options.maxPly ?? process.env.CHESS_OPENING_MAX_PLY,
      DEFAULT_MAX_PLY
    ),
    minGames: toPositiveInt(
      options.minGames ?? process.env.CHESS_OPENING_MIN_GAMES,
      2
    ),
    moves: toPositiveInt(
      options.moves ?? process.env.CHESS_OPENING_MOVES,
      DEFAULT_MOVES
    ),
    style: options.style || process.env.CHESS_OPENING_STYLE || 'mimic',
    timeoutMs: toPositiveInt(
      options.timeoutMs ?? process.env.CHESS_OPENING_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS
    ),
    cacheTtlMs: toPositiveInt(
      options.cacheTtlMs ?? process.env.CHESS_OPENING_CACHE_TTL_MS,
      DEFAULT_CACHE_TTL_MS
    ),
    cachePath: resolveCachePath(options),
    manualBookPath: resolveManualBookPath(options),
    since: options.since || process.env.CHESS_OPENING_SINCE || null,
    until: options.until || process.env.CHESS_OPENING_UNTIL || null,
  };
}

async function loadCache(cachePath) {
  const resolvedPath = path.resolve(cachePath);

  if (cacheLoaded && loadedCachePath === resolvedPath) {
    return;
  }

  if (cacheLoaded && loadedCachePath !== resolvedPath) {
    memoryCache.clear();
    cacheDirty = false;
  }

  cacheLoaded = true;
  loadedCachePath = resolvedPath;

  try {
    const raw = await fs.readFile(resolvedPath, 'utf8');
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === 'object') {
      for (const [key, value] of Object.entries(parsed)) {
        memoryCache.set(key, value);
      }
    }
  } catch {
    // 캐시 파일 없으면 무시
  }
}

async function saveCache(cachePath) {
  if (!cacheDirty) return;

  const resolvedPath = path.resolve(cachePath);

  try {
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

    const obj = Object.fromEntries(memoryCache.entries());

    await fs.writeFile(resolvedPath, JSON.stringify(obj, null, 2), 'utf8');
    cacheDirty = false;
  } catch (error) {
    console.warn('[Lichess opening book] failed to save cache:', error);
  }
}

function normalizeManualBookMove(move) {
  if (!move || typeof move !== 'object') return null;

  const uci = String(move.uci ?? '').trim();
  if (!UCI_MOVE_PATTERN.test(uci)) {
    return null;
  }

  return {
    uci,
    san: typeof move.san === 'string' ? move.san : '',
    white: Number(move.white ?? 0),
    draws: Number(move.draws ?? 0),
    black: Number(move.black ?? 0),
    ...(move.opening && typeof move.opening === 'object'
      ? { opening: move.opening }
      : {}),
  };
}

function normalizeManualBookOpening(opening) {
  if (!opening || typeof opening !== 'object') {
    return null;
  }

  const eco = typeof opening.eco === 'string' ? opening.eco : '';
  const name = typeof opening.name === 'string' ? opening.name : '';

  if (!eco && !name) {
    return null;
  }

  return {
    ...(eco ? { eco } : {}),
    ...(name ? { name } : {}),
  };
}

async function loadManualBook(manualBookPath) {
  const resolvedPath = path.resolve(manualBookPath);
  let stats = null;

  try {
    stats = await fs.stat(resolvedPath);
  } catch {
    stats = null;
  }

  if (
    manualBookLoaded
    && loadedManualBookPath === resolvedPath
    && stats
    && Number(stats.mtimeMs) === manualBookLastModifiedMs
    && manualBookPositions.size > 0
  ) {
    return;
  }

  if (manualBookLoaded && loadedManualBookPath !== resolvedPath) {
    manualBookPositions.clear();
    manualBookMeta = null;
  }

  manualBookLoaded = true;
  loadedManualBookPath = resolvedPath;
  manualBookLastModifiedMs = Number(stats?.mtimeMs ?? -1);

  if (!stats) {
    manualBookPositions.clear();
    manualBookMeta = null;
    return;
  }

  try {
    const raw = await fs.readFile(resolvedPath, 'utf8');
    const parsed = JSON.parse(raw);
    const positions = parsed?.positions;

    manualBookPositions.clear();
    manualBookMeta = parsed?.meta && typeof parsed.meta === 'object'
      ? parsed.meta
      : null;

    if (!positions || typeof positions !== 'object') {
      return;
    }

    for (const [lineKey, value] of Object.entries(positions)) {
      if (!value || typeof value !== 'object' || !Array.isArray(value.moves)) {
        continue;
      }

      const moves = value.moves
        .map(normalizeManualBookMove)
        .filter(Boolean);

      if (!moves.length) {
        continue;
      }

      manualBookPositions.set(lineKey, {
        opening: normalizeManualBookOpening(value.opening),
        moves,
      });
    }
  } catch {
    manualBookPositions.clear();
    manualBookMeta = null;
  }
}

function queueSaveCache(cachePath) {
  cacheSaveQueue = cacheSaveQueue
    .catch(() => {})
    .then(() => saveCache(cachePath));

  return cacheSaveQueue;
}

function buildExplorerUrl(params) {
  const url = new URL('https://explorer.lichess.ovh/player');

  url.searchParams.set('player', params.player);
  url.searchParams.set('color', params.color);
  url.searchParams.set('variant', 'chess');
  url.searchParams.set('speeds', params.speeds);
  url.searchParams.set('modes', params.modes);
  url.searchParams.set('moves', String(params.moves ?? DEFAULT_MOVES));

  // 지원 안 되는 서버에서는 무시될 수 있지만, 응답 크기 줄이는 용도
  url.searchParams.set('recentGames', '0');

  if (params.since) url.searchParams.set('since', params.since);
  if (params.until) url.searchParams.set('until', params.until);

  if (params.play) {
    url.searchParams.set('play', params.play);
  } else if (params.fen) {
    url.searchParams.set('fen', params.fen);
  }

  return url;
}

function parseNdjsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

async function readOpeningExplorerNdjson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let latest = null;

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/x-ndjson',
        'user-agent': 'kannyan-discord-bot/1.0',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Lichess explorer HTTP ${response.status}`);
    }

    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const parsed = parseNdjsonLine(line);
          if (parsed?.moves) {
            latest = parsed;
          }
        }
      }

      if (buffer.trim()) {
        const parsed = parseNdjsonLine(buffer);
        if (parsed?.moves) {
          latest = parsed;
        }
      }

      return latest;
    }

    const text = await response.text();
    for (const line of text.split('\n')) {
      const parsed = parseNdjsonLine(line);
      if (parsed?.moves) {
        latest = parsed;
      }
    }

    return latest;
  } catch (error) {
    if (latest) return latest;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getCachedPosition(cacheKey) {
  const cached = memoryCache.get(cacheKey);
  return cached && typeof cached === 'object' ? cached : null;
}

function setCachedPosition(cacheKey, data, savedAtMs = Date.now()) {
  memoryCache.set(cacheKey, {
    savedAtMs,
    data,
  });
  cacheDirty = true;
}

function buildCachedResponse(cached, extra = {}) {
  return {
    ...cached.data,
    fromCache: true,
    ...extra,
  };
}

async function getManualBookPosition(params) {
  const manualBookPath = resolveManualBookPath(params);
  await loadManualBook(manualBookPath);

  const lineKey = params.play || '';
  const position = manualBookPositions.get(lineKey);

  if (!position?.moves?.length) {
    return null;
  }

  return {
    opening: position.opening,
    moves: position.moves.map((move) => ({ ...move })),
    fromManualBook: true,
  };
}

async function getPlayerOpeningPosition(params) {
  const {
    cachePath = DEFAULT_CACHE_PATH,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    allowNetwork = true,
    forceRefresh = false,
    persist = true,
  } = params;

  await loadCache(cachePath);

  const cacheKey = getCacheKey(params);
  const cached = getCachedPosition(cacheKey);
  const now = Date.now();
  const isFresh = cached && now - Number(cached.savedAtMs ?? 0) <= cacheTtlMs;

  if (cached && (!allowNetwork || (isFresh && !forceRefresh))) {
    return buildCachedResponse(cached, {
      stale: !isFresh,
    });
  }

  if (!allowNetwork) {
    return null;
  }

  const url = buildExplorerUrl(params);

  try {
    const data = await readOpeningExplorerNdjson(url, timeoutMs);

    if (!data?.moves) {
      return cached ? buildCachedResponse(cached, { stale: !isFresh }) : null;
    }

    setCachedPosition(cacheKey, data, now);

    if (persist) {
      void queueSaveCache(cachePath);
    }

    return {
      ...data,
      fromCache: false,
    };
  } catch (error) {
    if (cached) {
      return buildCachedResponse(cached, {
        stale: !isFresh,
        staleBecauseFetchFailed: true,
      });
    }

    throw error;
  }
}

function getLineKeyFromHistory(uciHistory) {
  return uciHistory.join(',');
}

function getTurnColorFromHistory(uciHistory) {
  return uciHistory.length % 2 === 0 ? 'white' : 'black';
}

export async function loadLichessPlayerOpeningBookCache(options = {}) {
  const { cachePath, manualBookPath } = getOpeningBookConfig(options);
  await loadCache(cachePath);
  await loadManualBook(manualBookPath);

  return {
    enabled: isOpeningBookEnabled(options),
    cacheEntries: memoryCache.size,
    cachePath,
    manualBookEntries: manualBookPositions.size,
    manualBookPath,
    manualBookPlayer: manualBookMeta?.player ?? null,
  };
}

export function isLichessPlayerOpeningBookWarmupRunning() {
  return warmupPromise !== null;
}

export async function warmLichessPlayerOpeningBook(options = {}) {
  const enabled = isOpeningBookEnabled(options);

  if (!enabled) {
    return {
      enabled: false,
      started: false,
      positionsVisited: 0,
      networkFetches: 0,
      cacheFallbacks: 0,
      failures: 0,
      truncated: false,
    };
  }

  if (warmupPromise) {
    return warmupPromise;
  }

  const config = getOpeningBookConfig(options);
  await loadManualBook(config.manualBookPath);

  if (manualBookPositions.size > 0) {
    return {
      enabled: true,
      started: false,
      manualBook: true,
      manualBookPath: config.manualBookPath,
      manualBookPositions: manualBookPositions.size,
      positionsVisited: 0,
      networkFetches: 0,
      cacheFallbacks: 0,
      failures: 0,
      truncated: false,
    };
  }

  const preloadMaxNodes = toPositiveInt(
    options.preloadMaxNodes ?? process.env.CHESS_OPENING_PRELOAD_MAX_NODES,
    DEFAULT_PRELOAD_MAX_NODES
  );
  const preloadBranches = toPositiveInt(
    options.preloadBranches ?? process.env.CHESS_OPENING_PRELOAD_BRANCHES,
    DEFAULT_PRELOAD_BRANCHES
  );
  const preloadDelayMs = toNonNegativeInt(
    options.preloadDelayMs ?? process.env.CHESS_OPENING_PRELOAD_DELAY_MS,
    DEFAULT_PRELOAD_DELAY_MS
  );
  const forceRefresh = options.forceRefresh ?? true;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  warmupPromise = (async () => {
    await loadCache(config.cachePath);

    const seen = new Set(['']);
    const queue = [{ uciHistory: [] }];
    const summary = {
      enabled: true,
      started: true,
      player: config.player,
      maxPly: config.maxPly,
      preloadMaxNodes,
      preloadBranches,
      preloadDelayMs,
      positionsVisited: 0,
      networkFetches: 0,
      cacheFallbacks: 0,
      failures: 0,
      truncated: false,
      lastLineKey: '',
      cacheEntries: memoryCache.size,
    };

    while (queue.length && summary.positionsVisited < preloadMaxNodes) {
      const { uciHistory } = queue.shift();

      if (uciHistory.length >= config.maxPly) {
        continue;
      }

      const lineKey = getLineKeyFromHistory(uciHistory);
      const color = getTurnColorFromHistory(uciHistory);

      try {
        const data = await getPlayerOpeningPosition({
          ...config,
          color,
          play: lineKey,
          fen: lineKey ? null : START_POSITION_FEN,
          allowNetwork: true,
          forceRefresh,
          persist: false,
        });

        summary.positionsVisited += 1;
        summary.lastLineKey = lineKey;

        if (data?.fromCache) {
          summary.cacheFallbacks += 1;
        } else if (data?.moves) {
          summary.networkFetches += 1;
        }

        const branchMoves = Array.isArray(data?.moves)
          ? data.moves
              .filter((move) => UCI_MOVE_PATTERN.test(String(move?.uci ?? '').trim()))
              .sort((left, right) => getMoveTotal(right) - getMoveTotal(left))
              .slice(0, preloadBranches)
          : [];

        if (uciHistory.length + 1 < config.maxPly) {
          for (const move of branchMoves) {
            const nextHistory = [...uciHistory, move.uci];
            const nextLineKey = getLineKeyFromHistory(nextHistory);

            if (seen.has(nextLineKey)) {
              continue;
            }

            seen.add(nextLineKey);
            queue.push({ uciHistory: nextHistory });
          }
        }

        if (onProgress) {
          onProgress({
            visited: summary.positionsVisited,
            maxNodes: preloadMaxNodes,
            lineKey,
            color,
            moveCount: branchMoves.length,
            fromCache: Boolean(data?.fromCache),
          });
        }
      } catch (error) {
        summary.positionsVisited += 1;
        summary.failures += 1;
        summary.lastLineKey = lineKey;
        console.warn(
          `[Lichess opening book] preload failed at ${lineKey || '<start>'}:`,
          error?.message ?? error,
        );
      }

      if (preloadDelayMs > 0 && queue.length && summary.positionsVisited < preloadMaxNodes) {
        await sleep(preloadDelayMs);
      }
    }

    summary.truncated = queue.length > 0;
    summary.cacheEntries = memoryCache.size;

    await queueSaveCache(config.cachePath);

    return summary;
  })().finally(() => {
    warmupPromise = null;
  });

  return warmupPromise;
}

/**
 * chess: chess.js Chess 인스턴스
 *
 * 반환 예:
 * {
 *   uci: 'e2e4',
 *   san: 'e4',
 *   from: 'e2',
 *   to: 'e4',
 *   promotion: undefined,
 *   source: 'lichess-player-opening-book',
 *   player: 'bears4347',
 *   color: 'white',
 *   games: 123,
 *   scoreRate: 0.55,
 * }
 */
export async function chooseLichessPlayerOpeningMove(chess, options = {}) {
  if (!chess || !isOpeningBookEnabled(options)) return null;

  const config = getOpeningBookConfig(options);
  const allowNetwork = options.allowNetwork ?? false;

  const uciHistory = Array.isArray(options.uciHistory)
    ? options.uciHistory.filter(Boolean)
    : getUciHistoryFromChess(chess);

  if (uciHistory.length >= config.maxPly) {
    return null;
  }

  const color = options.color || getTurnColor(chess);
  const play = uciHistory.join(',');

  const legalMovesByUci = getLegalMovesByUci(chess);

  if (!legalMovesByUci.size) {
    return null;
  }

  let data = null;

  try {
    data = await getManualBookPosition({
      ...config,
      color,
      play,
    });

    if (!data) {
      data = await getPlayerOpeningPosition({
        ...config,
        color,
        play,
        fen: play ? null : chess.fen(),
        allowNetwork,
      });
    }
  } catch (error) {
    console.warn('[Lichess opening book] fetch failed:', error?.message ?? error);
    return null;
  }

  if (!data?.moves?.length) {
    return null;
  }

  const rawCandidates = data.moves
    .map((move) => {
      const legal = legalMovesByUci.get(move.uci);
      if (!legal) return null;

      const games = getMoveTotal(move);
      const scoreRate = getPlayerScoreRate(move, color);

      return {
        move,
        legal,
        games,
        scoreRate,
      };
    })
    .filter(Boolean);

  if (!rawCandidates.length) {
    return null;
  }

  let candidates = rawCandidates.filter((entry) => entry.games >= config.minGames);

  if (!candidates.length) {
    candidates = rawCandidates;
  }

  const weightedCandidates = candidates.map((entry) => {
    let weight;

    if (config.style === 'stronger') {
      weight = entry.games * (0.65 + entry.scoreRate);
    } else {
      weight = entry.games;
    }

    return {
      ...entry,
      weight,
    };
  });

  const picked = weightedPick(weightedCandidates);

  if (!picked) {
    return null;
  }

  return {
    uci: picked.move.uci,
    san: picked.legal.san || picked.move.san,
    from: picked.legal.from,
    to: picked.legal.to,
    promotion: picked.legal.promotion,
    source: 'lichess-player-opening-book',
    player: config.player,
    color,
    games: picked.games,
    scoreRate: picked.scoreRate,
    opening: picked.move.opening ?? data.opening ?? null,
    fromCache: Boolean(data.fromCache),
    fromManualBook: Boolean(data.fromManualBook),
    lineKey: play || chess.fen(),
  };
}
