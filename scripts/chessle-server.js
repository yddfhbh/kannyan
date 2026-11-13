import 'dotenv/config';
import http from 'node:http';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChessleStore } from '../src/chessle/store.js';
import { MATCHING, MODES, scoreGuess, shareText, validateSequence } from '../src/chessle/core.js';
import { createDiscordAuth, DiscordAuthError } from '../src/chessle/discord-auth.js';
import { createChessleDailyOrigin } from '../src/chessle/daily-origin.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.CHESSLE_PORT || 8787);
const dataFile = process.env.CHESSLE_DATA_FILE || path.join(process.env.CHESSLE_DATA_DIR || path.join(root, 'data'), 'chessle.json');
const store = createChessleStore(dataFile);
const discordAuth = createDiscordAuth({ clientId: process.env.CLIENT_ID, clientSecret: process.env.DISCORD_CLIENT_SECRET || process.env.CLIENT_SECRET });
// Use only original Chessle publication dates and puzzles.
const dailyOrigin = createChessleDailyOrigin({
  filePath: process.env.CHESSLE_ORIGIN_CACHE_FILE || path.join(path.dirname(dataFile), 'daily-origin-cache.json'),
});
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function send(response, status, body, type = 'application/json; charset=utf-8') { response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); response.end(type.startsWith('application/json') ? JSON.stringify(body) : body); }
function jsonBody(request) { return new Promise((resolve, reject) => { let raw = ''; request.on('data', (chunk) => { raw += chunk; if (raw.length > 20_000) reject(new Error('body too large')); }); request.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('invalid JSON')); } }); request.on('error', reject); }); }
function bearer(request) { return request.headers.authorization?.match(/^Bearer\s+([\w.-]+)$/i)?.[1] || null; }
function userId(request) { const token = bearer(request); if (process.env.CHESSLE_DEV_MODE === 'true' && token && process.env.CHESSLE_DEV_BEARER && token === process.env.CHESSLE_DEV_BEARER) return { id: 'dev-user' }; if (process.env.CHESSLE_DEV_MODE === 'true') return { id: String(request.headers['x-discord-user-id'] || 'dev-user').slice(0, 64) }; return discordAuth.identify(token); }
function gameKey(user, date, mode, puzzleId) { return `${user}:${date}:${mode}:original:${puzzleId}`; }
function gameFor(user, date, mode, puzzleId) { const key = gameKey(user, date, mode, puzzleId); return store.state().games[key] || { rows: [], matching: null, finished: false }; }
function rowResult(row) { return Array.isArray(row) ? row : row?.result || []; }
function publicRow(row) { return Array.isArray(row) ? { moves: [], result: row } : { moves: row?.moves || [], result: row?.result || [] }; }
function answerSan(puzzle) { return validateSequence(puzzle.moves, puzzle.length).moves.map(move => move.san); }
function publicGame(game, puzzle, date, mode) {
  return { date, mode, source: 'original', puzzleId: puzzle.puzzleId, length: puzzle.length, attempts: game.rows.length, rows: game.rows.map(publicRow), matching: game.matching, finished: game.finished,
    opening: game.finished ? (game.opening || puzzle.name) : undefined, answer: game.finished ? (game.answer || answerSan(puzzle)) : undefined,
    share: game.rows.length ? shareText({ date, mode, attempt: game.rows.length, rows: game.rows.map(rowResult) }) : undefined };
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/config') return send(response, 200, { clientId: process.env.CLIENT_ID || null, authRequired: process.env.CHESSLE_DEV_MODE !== 'true' });
  if (request.method === 'POST' && url.pathname === '/api/auth/exchange') { try { const body = await jsonBody(request); const result = await discordAuth.exchangeCode(body.code); return send(response, 200, { access_token: result.accessToken, session_token: result.sessionToken, expires_at: result.expiresAt, user: result.user }); } catch (error) { if (error instanceof DiscordAuthError) return send(response, error.status, { error: error.message, code: error.code }); throw error; } }
  if (request.method === 'POST' && url.pathname === '/api/auth/refresh') { try { const result = await discordAuth.refresh(bearer(request)); return send(response, 200, { access_token: result.accessToken, session_token: result.sessionToken, expires_at: result.expiresAt, user: result.user }); } catch (error) { if (error instanceof DiscordAuthError) return send(response, error.status, { error: error.message, code: error.code }); throw error; } }
  let user; try { user = userId(request); } catch (error) { if (error instanceof DiscordAuthError) return send(response, error.status, { error: error.message, code: error.code }); throw error; }
  const dailyView = await dailyOrigin.current();
  const date = dailyView.date;
  const puzzleId = dailyView.puzzleId;
  if (request.method === 'GET' && url.pathname === '/api/puzzle') {
    const mode = url.searchParams.get('mode') || 'normal';
    if (!MODES[mode]) return send(response, 400, { error: '지원하지 않는 모드입니다.' });
    const puzzle = dailyView.puzzles[mode]; const game = gameFor(user.id, date, mode, puzzleId);
    return send(response, 200, publicGame(game, puzzle, date, mode));
  }
  if (request.method === 'POST' && url.pathname === '/api/start') {
    const body = await jsonBody(request);
    if ((body.puzzleDate && body.puzzleDate !== date) || (body.puzzleId != null && Number(body.puzzleId) !== puzzleId)) return send(response, 409, { error: '공식 체슬 문제가 갱신되었습니다. 게임을 다시 열어주세요.' });
    const mode = body.mode;
    if (!MODES[mode]) return send(response, 400, { error: '지원하지 않는 모드입니다.' });
    const instanceId = typeof body.instanceId === 'string' && /^[\w-]{8,240}$/.test(body.instanceId) ? body.instanceId : null;
    if (!instanceId) return send(response, 400, { error: 'Discord Activity 세션 정보가 필요합니다.' });
    // Stable per session, player, mode and day: reloads cannot endlessly bump the board.
    const startId = 'start:' + createHash('sha256')
      .update(`${user.id}:${date}:${mode}:${puzzleId}:${instanceId}`).digest('hex');
    const recorded = await store.update((state) => {
      const game = state.games[gameKey(user.id, date, mode, puzzleId)];
      if (game?.finished) return false;
      state.liveEvents ||= [];
      if (!state.liveEvents.some(event => event.id === startId)) {
        state.liveEvents.push({
          id: startId, type: 'start', userId: String(user.id), instanceId,
          date, mode, puzzleId, createdAt: Date.now(),
        });
        if (state.liveEvents.length > 10000) state.liveEvents.splice(0, state.liveEvents.length - 10000);
      }
      return true;
    });
    return send(response, 200, { ok: true, recorded });
  }
  if (request.method !== 'POST' || url.pathname !== '/api/guess') return send(response, 404, { error: 'Not found' });
  const body = await jsonBody(request);
  if ((body.puzzleDate && body.puzzleDate !== date) || (body.puzzleId != null && Number(body.puzzleId) !== puzzleId)) return send(response, 409, { error: '공식 체슬 문제가 갱신되었습니다. 게임을 다시 열어주세요.' });
  const mode = body.mode || url.searchParams.get('mode') || 'normal';
  if (!MODES[mode]) return send(response, 400, { error: '지원하지 않는 모드입니다.' });
  const matching = body.matching; const moves = body.moves; if (!Object.values(MATCHING).includes(matching)) return send(response, 400, { error: '판정 방식이 올바르지 않습니다.' });
  const puzzle = dailyView.puzzles[mode];
  const validated = validateSequence(moves, puzzle.length); if (!validated.ok) return send(response, 400, { error: validated.error });
  const answer = validateSequence(puzzle.moves, puzzle.length).moves;
  const submissionId = typeof body.submissionId === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(body.submissionId) ? body.submissionId : null;
  // This is untrusted client metadata. The bot verifies the Activity instance
  // with Discord's authenticated API before publishing or counting streaks.
  const instanceId = typeof body.instanceId === 'string' && /^[\w-]{8,240}$/.test(body.instanceId) ? body.instanceId : null;
  const saved = await store.update((state) => {
    const key = gameKey(user.id, date, mode, puzzleId);
    const game = state.games[key] || { rows: [], matching: null, finished: false };
    const duplicate = submissionId && game.rows.find(row => row?.submissionId === submissionId);
    if (duplicate) return { game, row: duplicate, duplicate: true };
    if (game.finished || game.rows.length >= 6) return { error: '오늘 이 모드의 게임은 이미 종료되었습니다.' };
    if (game.matching && game.matching !== matching) return { error: '첫 제출에서 선택한 판정 방식은 변경할 수 없습니다.' };
    const result = scoreGuess(validated.moves, answer, matching);
    const solved = result.every((cell) => cell === 'green');
    const finished = solved || game.rows.length + 1 >= 6;
    const row = { moves: validated.moves.map((move) => move.san), result, ...(submissionId ? { submissionId } : {}) };
    const next = { ...game, rows: [...game.rows, row], matching: game.matching || matching, finished, solved, opening: finished ? puzzle.name : undefined, answer: finished ? answerSan(puzzle) : undefined };
    state.games[key] = next;
    if (instanceId) {
      state.liveEvents ||= [];
      // A complete persisted snapshot prevents the Discord view from losing
      // earlier rows when events are delayed, retried, or processed out of order.
      state.liveEvents.push({ id: `${user.id}:${date}:${mode}:${puzzleId}:${submissionId || next.rows.length}`, userId: String(user.id), instanceId, date, mode, puzzleId,
        attempt: next.rows.length, result, rows: next.rows.map(rowResult), solved, finished, createdAt: Date.now() });
      if (state.liveEvents.length > 10000) state.liveEvents.splice(0, state.liveEvents.length - 10000);
    }
    return { game: next, row };
  });
  if (saved.error) return send(response, 409, { error: saved.error });
  const payload = publicGame(saved.game, puzzle, date, mode);
  return send(response, 200, { ...payload, row: publicRow(saved.row), result: rowResult(saved.row), solved: saved.game.solved, duplicate: saved.duplicate || undefined });
}

async function serve(request, response) { const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`); try { if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url); const base = url.pathname === '/vendor/chess.js' ? path.join(root, 'node_modules', 'chess.js', 'dist', 'esm', 'chess.js') : url.pathname.startsWith('/assets/chess-pieces/') ? path.join(root, url.pathname) : path.join(root, 'activity', `.${url.pathname === '/' ? '/index.html' : url.pathname}`); const file = path.resolve(base); const allowed = [path.resolve(root, 'activity'), path.resolve(root, 'assets/chess-pieces'), path.resolve(root, 'node_modules/chess.js/dist/esm')].some((prefix) => file === prefix || file.startsWith(`${prefix}${path.sep}`)); if (!allowed) return send(response, 403, { error: 'Forbidden' }); const body = await fs.readFile(file); response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }); response.end(body); } catch (error) { if (error.code === 'ENOENT') return send(response, 404, { error: 'Not found' }); console.error('[CHESSLE]', error); const unavailable = /^Official Chessle puzzle unavailable:/.test(error.message); send(response, unavailable ? 503 : 500, { error: unavailable ? '공식 체슬 문제를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.' : 'Internal server error' }); } }

await store.load();
await dailyOrigin.load();
http.createServer((request, response) => void serve(request, response)).listen(
  port, '127.0.0.1', () => console.log(`Chessle Activity listening on ${port}`)
);
// Poll even without a visitor, so reset notices arrive soon after official publication.
let previousOriginalError = '';
async function pollOriginalDaily() {
  try {
    await dailyOrigin.current();
    previousOriginalError = '';
  } catch (error) {
    if (error.message !== previousOriginalError) {
      console.error('[CHESSLE ORIGINAL]', error.message);
      previousOriginalError = error.message;
    }
  }
}
void pollOriginalDaily();
const pollTimer = setInterval(() => void pollOriginalDaily(), 60_000);
pollTimer.unref?.();
