import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChessleStore } from '../src/chessle/store.js';
import { getDailyPuzzle, kstDate, MATCHING, MODES, scoreGuess, shareText, validateSequence } from '../src/chessle/core.js';
import { createDiscordAuth, DiscordAuthError } from '../src/chessle/discord-auth.js';
import { createChessleDailyOrigin } from '../src/chessle/daily-origin.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.CHESSLE_PORT || 8787);
const dataFile = process.env.CHESSLE_DATA_FILE || path.join(process.env.CHESSLE_DATA_DIR || path.join(root, 'data'), 'chessle.json');
const store = createChessleStore(dataFile);
const discordAuth = createDiscordAuth({ clientId: process.env.CLIENT_ID, clientSecret: process.env.DISCORD_CLIENT_SECRET || process.env.CLIENT_SECRET });
const attempts = new Map();
const dailyOrigin = process.env.CHESSLE_ORIGIN_ENABLED === 'true'
  ? createChessleDailyOrigin({ filePath: process.env.CHESSLE_ORIGIN_CACHE_FILE || path.join(path.dirname(dataFile), 'daily-origin-cache.json') })
  : { async load() {}, async current() { const date = kstDate(); return { date, source: 'local', puzzles: { normal: getDailyPuzzle(date, 'normal'), expert: getDailyPuzzle(date, 'expert') } }; } };
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function send(response, status, body, type = 'application/json; charset=utf-8') { response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); response.end(type.startsWith('application/json') ? JSON.stringify(body) : body); }
function jsonBody(request) { return new Promise((resolve, reject) => { let raw = ''; request.on('data', (chunk) => { raw += chunk; if (raw.length > 20_000) reject(new Error('body too large')); }); request.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('invalid JSON')); } }); request.on('error', reject); }); }
function bearer(request) { return request.headers.authorization?.match(/^Bearer\s+([\w.-]+)$/i)?.[1] || null; }
function userId(request) { const token = bearer(request); if (process.env.CHESSLE_DEV_MODE === 'true' && token && process.env.CHESSLE_DEV_BEARER && token === process.env.CHESSLE_DEV_BEARER) return { id: 'dev-user' }; if (process.env.CHESSLE_DEV_MODE === 'true') return { id: String(request.headers['x-discord-user-id'] || 'dev-user').slice(0, 64) }; return discordAuth.identify(token); }
function gameKey(user, date, mode) { return `${user}:${date}:${mode}`; }
function gameFor(user, date, mode) { const key = gameKey(user, date, mode); return store.state().games[key] || { rows: [], matching: null, finished: false }; }
function rowResult(row) { return Array.isArray(row) ? row : row?.result || []; }
function publicRow(row) { return Array.isArray(row) ? { moves: [], result: row } : { moves: row?.moves || [], result: row?.result || [] }; }

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/config') return send(response, 200, { clientId: process.env.CLIENT_ID || null, authRequired: process.env.CHESSLE_DEV_MODE !== 'true' });
  if (request.method === 'POST' && url.pathname === '/api/auth/exchange') { try { const body = await jsonBody(request); const result = await discordAuth.exchangeCode(body.code); return send(response, 200, { access_token: result.accessToken, session_token: result.sessionToken, expires_at: result.expiresAt, user: result.user }); } catch (error) { if (error instanceof DiscordAuthError) return send(response, error.status, { error: error.message, code: error.code }); throw error; } }
  if (request.method === 'POST' && url.pathname === '/api/auth/refresh') { try { const result = await discordAuth.refresh(bearer(request)); return send(response, 200, { access_token: result.accessToken, session_token: result.sessionToken, expires_at: result.expiresAt, user: result.user }); } catch (error) { if (error instanceof DiscordAuthError) return send(response, error.status, { error: error.message, code: error.code }); throw error; } }
  let user; try { user = userId(request); } catch (error) { if (error instanceof DiscordAuthError) return send(response, error.status, { error: error.message, code: error.code }); throw error; }
  const dailyView = await dailyOrigin.current({ legacyDates: Object.keys(store.state().games).map(key => key.split(':').at(-2)) });
  const date = dailyView.date;
  if (request.method === 'GET' && url.pathname === '/api/puzzle') {
    const mode = url.searchParams.get('mode') || 'normal';
    if (!MODES[mode]) return send(response, 400, { error: '지원하지 않는 모드입니다.' });
    const puzzle = dailyView.puzzles[mode]; const game = gameFor(user.id, date, mode);
    return send(response, 200, { date, mode, length: puzzle.length, attempts: game.rows.length, rows: game.rows.map(publicRow), matching: game.matching, finished: game.finished, opening: game.finished ? game.opening : undefined, share: game.rows.length ? shareText({ date, mode, attempt: game.rows.length, rows: game.rows.map(rowResult) }) : undefined });
  }
  if (request.method !== 'POST' || url.pathname !== '/api/guess') return send(response, 404, { error: 'Not found' });
  const body = await jsonBody(request);
  if (body.puzzleDate && body.puzzleDate !== date) return send(response, 409, { error: '오늘의 문제가 갱신되었습니다. 게임을 다시 열어주세요.' });
  const mode = body.mode || url.searchParams.get('mode') || 'normal';
  if (!MODES[mode]) return send(response, 400, { error: '지원하지 않는 모드입니다.' });
  const matching = body.matching; const moves = body.moves; if (!Object.values(MATCHING).includes(matching)) return send(response, 400, { error: '판정 방식이 올바르지 않습니다.' });
  const puzzle = dailyView.puzzles[mode]; const game = gameFor(user.id, date, mode); if (game.finished || game.rows.length >= 6) return send(response, 409, { error: '오늘 이 모드의 게임은 이미 종료되었습니다.' });
  if (game.matching && game.matching !== matching) return send(response, 409, { error: '첫 제출에서 선택한 판정 방식은 변경할 수 없습니다.' });
  const now = Date.now(); const last = attempts.get(user.id) || 0; if (now - last < 350) return send(response, 429, { error: '잠시 후 다시 시도하세요.' }); attempts.set(user.id, now);
  const validated = validateSequence(moves, puzzle.length); if (!validated.ok) return send(response, 400, { error: validated.error });
  const answer = validateSequence(puzzle.moves, puzzle.length).moves; const result = scoreGuess(validated.moves, answer, matching); const solved = result.every((cell) => cell === 'green'); const finished = solved || game.rows.length + 1 >= 6;
  const row = { moves: validated.moves.map((move) => move.san), result };
  const next = { rows: [...game.rows, row], matching: game.matching || matching, finished, solved, opening: finished ? puzzle.name : undefined };
  // This is untrusted client metadata. The bot verifies the Activity instance
  // with Discord's authenticated API before publishing or counting streaks.
  const instanceId = typeof body.instanceId === 'string' && /^[\w-]{8,240}$/.test(body.instanceId) ? body.instanceId : null;
  const liveEvent = instanceId ? {
    id: `${user.id}:${date}:${mode}:${next.rows.length}`,
    userId: String(user.id), instanceId, date: kstDate(), mode,
    attempt: next.rows.length, result, solved, finished, createdAt: Date.now(),
  } : null;
  await store.update((state) => {
    state.games[gameKey(user.id, date, mode)] = next;
    if (liveEvent) {
      state.liveEvents ||= [];
      state.liveEvents.push(liveEvent);
      if (state.liveEvents.length > 10000) state.liveEvents.splice(0, state.liveEvents.length - 10000);
    }
  });
  return send(response, 200, { row, result, matching: next.matching, solved, finished, opening: finished ? puzzle.name : undefined, share: shareText({ date, mode, attempt: next.rows.length, rows: next.rows.map(rowResult) }) });
}

async function serve(request, response) { const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`); try { if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url); const base = url.pathname === '/vendor/chess.js' ? path.join(root, 'node_modules', 'chess.js', 'dist', 'esm', 'chess.js') : url.pathname.startsWith('/assets/chess-pieces/') ? path.join(root, url.pathname) : path.join(root, 'activity', `.${url.pathname === '/' ? '/index.html' : url.pathname}`); const file = path.resolve(base); const allowed = [path.resolve(root, 'activity'), path.resolve(root, 'assets/chess-pieces'), path.resolve(root, 'node_modules/chess.js/dist/esm')].some((prefix) => file === prefix || file.startsWith(`${prefix}${path.sep}`)); if (!allowed) return send(response, 403, { error: 'Forbidden' }); const body = await fs.readFile(file); response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }); response.end(body); } catch (error) { if (error.code === 'ENOENT') return send(response, 404, { error: 'Not found' }); console.error('[CHESSLE]', error); send(response, 500, { error: 'Internal server error' }); } }

await store.load(); await dailyOrigin.load(); http.createServer((request, response) => void serve(request, response)).listen(port, '127.0.0.1', () => console.log(`Chessle Activity listening on ${port}`));
