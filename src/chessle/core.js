import { Chess } from 'chess.js';

export const MODES = Object.freeze({ normal: { label: 'Normal', length: 6 }, expert: { label: 'Expert', length: 10 } });
export const MATCHING = Object.freeze({ exact: 'exact', pieceSquare: 'piece-square' });
const OPENINGS = Object.freeze([
  { name: 'Italian Game', eco: 'C50', normal: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'], expert: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4'] },
  { name: 'Ruy Lopez', eco: 'C60', normal: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'], expert: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'] },
  { name: "Queen's Gambit Declined", eco: 'D30', normal: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6'], expert: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O'] },
  { name: 'Sicilian Defense', eco: 'B20', normal: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4'], expert: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'] },
  { name: 'French Defense', eco: 'C00', normal: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6'], expert: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'Bg5', 'Bb4', 'e5', 'h6'] },
  { name: 'Caro-Kann Defense', eco: 'B10', normal: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4'], expert: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6'] },
]);
export function kstDate(date = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(date); }
function daySeed(date) { return [...date].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7); }
export function getDailyPuzzle(date = kstDate(), mode = 'normal') { if (!MODES[mode]) throw new Error('Unsupported mode'); const opening = OPENINGS[daySeed(date + mode) % OPENINGS.length]; return { date, mode, length: MODES[mode].length, name: opening.name, eco: opening.eco, moves: opening[mode] }; }
export function normalizeMove(move) { return { color: move.color, piece: move.piece, from: move.from, to: move.to, san: move.san }; }
export function validateSequence(sans, expectedLength) { if (!Array.isArray(sans) || sans.length !== expectedLength) return { ok: false, error: '수순 길이가 올바르지 않습니다.' }; const chess = new Chess(); const moves = []; try { for (const san of sans) { if (typeof san !== 'string' || san.length > 20) throw new Error('invalid move'); moves.push(normalizeMove(chess.move(san))); } } catch { return { ok: false, error: '합법적이지 않은 SAN 수순입니다.' }; } return { ok: true, moves }; }
function keyFor(move, matching) { return matching === MATCHING.pieceSquare ? `${move.piece}:${move.from}-${move.to}` : move.san; }
export function scoreGuess(guessMoves, answerMoves, matching = MATCHING.exact) { const guess = guessMoves.map((move) => ({ ...move, key: keyFor(move, matching) })); const answer = answerMoves.map((move) => ({ ...move, key: keyFor(move, matching) })); const result = Array(guess.length).fill('gray'); const remaining = new Map(); for (let i = 0; i < answer.length; i += 1) { if (guess[i]?.key === answer[i]?.key) result[i] = 'green'; else remaining.set(answer[i].key, (remaining.get(answer[i].key) ?? 0) + 1); } for (let i = 0; i < guess.length; i += 1) { if (result[i] === 'green') continue; const count = remaining.get(guess[i].key) ?? 0; if (count > 0) { result[i] = 'yellow'; remaining.set(guess[i].key, count - 1); } } return result; }
export function shareText({ date, mode, attempt, rows, puzzleId = null }) { const symbols = { green: '🟩', yellow: '🟨', gray: '⬜' }; return [`Chessle #${puzzleId ?? date}`, `${MODES[mode].label} · ${attempt}/6`, '', ...rows.map((row) => row.map((cell) => symbols[cell] ?? '⬜').join(''))].join('\n'); }
export { OPENINGS };
