import fs from 'node:fs';
import readline from 'node:readline';
import { Chess } from 'chess.js';

const outputPath = process.env.LICHESS_PUZZLE_OUTPUT_PATH || 'data/lichess-puzzle-pool.jsonl';

const minRating = Number(process.env.LICHESS_PUZZLE_MIN_RATING) || 2000;
const maxRating = Number(process.env.LICHESS_PUZZLE_MAX_RATING) || 2600;
const maxRatingDeviation = Number(process.env.LICHESS_PUZZLE_MAX_RD) || 120;
const minPopularity = Number(process.env.LICHESS_PUZZLE_MIN_POPULARITY) || 60;
const minPlays = Number(process.env.LICHESS_PUZZLE_MIN_PLAYS) || 30;
const maxCount = Number(process.env.LICHESS_PUZZLE_POOL_SIZE) || 10000;

const minMoveCount = Number(process.env.LICHESS_PUZZLE_MIN_MOVES) || 3;
const maxMoveCount = Number(process.env.LICHESS_PUZZLE_MAX_MOVES) || 9;

await fs.promises.mkdir('data', { recursive: true });

const output = fs.createWriteStream(outputPath, { encoding: 'utf8' });

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

let headerSkipped = false;
let scanned = 0;
let selected = 0;

for await (const line of rl) {
  if (!headerSkipped) {
    headerSkipped = true;
    continue;
  }

  scanned += 1;

  const cols = parseCsvLine(line);
  if (cols.length < 9) {
    continue;
  }

  const [
    puzzleId,
    fen,
    movesText,
    ratingText,
    ratingDeviationText,
    popularityText,
    nbPlaysText,
    themesText,
    gameUrl,
    openingTags = '',
  ] = cols;

  const rating = Number(ratingText);
  const ratingDeviation = Number(ratingDeviationText);
  const popularity = Number(popularityText);
  const nbPlays = Number(nbPlaysText);
  const themes = themesText.split(/\s+/).filter(Boolean);
  const moves = movesText.split(/\s+/).filter(Boolean);

  if (!Number.isFinite(rating) || rating < minRating || rating > maxRating) continue;
  if (!Number.isFinite(ratingDeviation) || ratingDeviation > maxRatingDeviation) continue;
  if (!Number.isFinite(popularity) || popularity < minPopularity) continue;
  if (!Number.isFinite(nbPlays) || nbPlays < minPlays) continue;
  if (moves.length < minMoveCount || moves.length > maxMoveCount) continue;

  // 너무 애매하거나 긴 퍼즐 제외
  if (themes.includes('veryLong')) continue;
  if (themes.includes('mateIn1')) continue;

  if (!isLegalPuzzle(fen, moves)) {
    continue;
  }

  const item = {
    id: puzzleId,
    fen,
    moves,
    rating,
    ratingDeviation,
    popularity,
    nbPlays,
    themes,
    gameUrl,
    openingTags,
  };

  output.write(`${JSON.stringify(item)}\n`);
  selected += 1;

  if (selected % 1000 === 0) {
    console.error(`selected=${selected} scanned=${scanned}`);
  }

  if (selected >= maxCount) {
    break;
  }
}

output.end();

console.error(`done. selected=${selected} scanned=${scanned}`);
console.error(`saved: ${outputPath}`);

function isLegalPuzzle(fen, moves) {
  try {
    const chess = new Chess(fen);

    for (const uci of moves) {
      const move = applyUciMove(chess, uci);
      if (!move) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

function applyUciMove(chess, uci) {
  const match = String(uci).match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/i);
  if (!match) return null;

  try {
    return chess.move({
      from: match[1],
      to: match[2],
      promotion: match[3]?.toLowerCase(),
    });
  } catch {
    return null;
  }
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  result.push(current);
  return result;
}
