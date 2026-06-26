import { Chess } from 'chess.js';
import { analyzeFenWithStockfish } from './stockfish-lite.js';
import { chooseLichessPlayerOpeningMove } from '../opening-book.js';

const UCI_MOVE_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const disabledEnvPattern = /^(?:0|false|off|no)$/i;

export const defaultKannyaMoveSelectorConfig = {
  useOpeningBook: !disabledEnvPattern.test(
    String(process.env.CHESS_OPENING_ENABLED ?? '').trim()
  ),
  movetimeMs: Math.max(
    100,
    Number(process.env.CHESS_STOCKFISH_MOVETIME_MS) || 2000
  ),
  multiPv: 6,
  maxCandidateLossCp: 200,
  bestMoveRate: 0.70,
  secondThirdRate: 0.20,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function moveToUci(move) {
  if (!move?.from || !move?.to) {
    return '';
  }

  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

function getStockfishCandidateRank(candidate, index) {
  const rank = Number(
    candidate?.rank
    ?? candidate?.multipv
    ?? candidate?.multiPv
    ?? index + 1
  );

  return Number.isFinite(rank) && rank > 0 ? rank : index + 1;
}

function getStockfishCandidateSan(candidate) {
  return String(
    candidate?.san
    ?? candidate?.move?.san
    ?? candidate?.principalVariation?.[0]?.san
    ?? ''
  ).trim();
}

function getStockfishCandidateUci(candidate, chess) {
  const directUci = String(
    candidate?.uci
    ?? candidate?.bestMove
    ?? candidate?.move?.uci
    ?? candidate?.principalVariation?.[0]?.uci
    ?? ''
  ).trim().toLowerCase();

  if (UCI_MOVE_PATTERN.test(directUci)) {
    return directUci;
  }

  const san = getStockfishCandidateSan(candidate);
  if (!san) {
    return '';
  }

  try {
    const testChess = new Chess(chess.fen());
    const move = testChess.move(san);
    return move ? moveToUci(move) : '';
  } catch {
    return '';
  }
}

function getStockfishCandidateCp(candidate) {
  const values = [
    candidate?.cp,
    candidate?.scoreCp,
    candidate?.centipawns,
    candidate?.evaluationCp,
    candidate?.evalCp,
    candidate?.score?.type === 'cp' ? candidate?.score?.value : null,
    candidate?.score?.cp,
    candidate?.score?.centipawns,
  ];

  for (const value of values) {
    if (value === null || value === undefined || value === '') {
      continue;
    }

    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }

  return null;
}

function getStockfishCandidateMate(candidate) {
  const values = [
    candidate?.mate,
    candidate?.mateIn,
    candidate?.score?.type === 'mate' ? candidate?.score?.value : null,
    candidate?.score?.mate,
    candidate?.score?.mateIn,
  ];

  for (const value of values) {
    if (value === null || value === undefined || value === '') {
      continue;
    }

    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }

  return null;
}

function normalizeStockfishCandidates(chess, analysis, legalUcis, multiPv) {
  const rawCandidates = Array.isArray(analysis?.candidates)
    ? analysis.candidates
    : [];

  const normalized = [];
  const seen = new Set();

  for (const [index, candidate] of rawCandidates.entries()) {
    const uci = getStockfishCandidateUci(candidate, chess);

    if (!legalUcis.includes(uci) || seen.has(uci)) {
      continue;
    }

    seen.add(uci);

    normalized.push({
      raw: candidate,
      rank: getStockfishCandidateRank(candidate, index),
      uci,
      san: getStockfishCandidateSan(candidate),
      cp: getStockfishCandidateCp(candidate),
      mate: getStockfishCandidateMate(candidate),
    });
  }

  const bestMoveUci = String(analysis?.bestMove ?? '').trim().toLowerCase();

  if (
    UCI_MOVE_PATTERN.test(bestMoveUci)
    && legalUcis.includes(bestMoveUci)
    && !seen.has(bestMoveUci)
  ) {
    normalized.unshift({
      raw: null,
      rank: 1,
      uci: bestMoveUci,
      san: analysis?.san ?? '',
      cp: null,
      mate: null,
    });
  }

  return normalized
    .sort((a, b) => a.rank - b.rank)
    .slice(0, Math.max(1, Number(multiPv) || defaultKannyaMoveSelectorConfig.multiPv));
}

function getCandidateLossCp(bestCandidate, candidate) {
  if (!bestCandidate || !candidate) {
    return Infinity;
  }

  if (candidate.rank === 1) {
    return 0;
  }

  if (Number.isFinite(candidate.mate) && candidate.mate < 0) {
    return Infinity;
  }

  if (Number.isFinite(bestCandidate.cp) && Number.isFinite(candidate.cp)) {
    return Math.abs(bestCandidate.cp - candidate.cp);
  }

  if (Number.isFinite(candidate.mate)) {
    return candidate.mate < 0 ? Infinity : 0;
  }

  return Infinity;
}

function pickRandomItem(items, randomFn) {
  if (!items.length) {
    return null;
  }

  return items[Math.floor(randomFn() * items.length)];
}

function normalizeRate(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  if (number > 1) {
    return clamp(number / 100, 0, 1);
  }

  return clamp(number, 0, 1);
}

function callLogger(logger, method, ...args) {
  const handler = logger?.[method];
  if (typeof handler === 'function') {
    handler(...args);
  }
}

export async function chooseKannyaMove(chess, options = {}) {
  const legalMoves = chess.moves({ verbose: true });

  if (legalMoves.length === 0) {
    return {
      selectedUci: '',
      selectedSource: 'none',
      selectedRank: null,
      selectedLossCp: null,
      analysis: null,
      stockfishSan: '',
    };
  }

  const randomFn = typeof options.randomFn === 'function' ? options.randomFn : Math.random;
  const logger = options.logger ?? null;
  const legalUcis = legalMoves.map(moveToUci);
  const useOpeningBook = options.useOpeningBook ?? defaultKannyaMoveSelectorConfig.useOpeningBook;
  const multiPv = Math.max(
    1,
    Number(options.multiPv ?? options.multipv ?? defaultKannyaMoveSelectorConfig.multiPv) || defaultKannyaMoveSelectorConfig.multiPv
  );

  if (useOpeningBook) {
    try {
      const openingMove = await chooseLichessPlayerOpeningMove(chess, {
        ...(options.openingBookOptions ?? {}),
      });

      if (openingMove?.uci && legalUcis.includes(openingMove.uci)) {
        const openingName = String(
          openingMove?.opening?.name
          ?? openingMove?.opening
          ?? ''
        ).trim();
        const openingSource = openingMove?.fromManualBook ? 'manual-opening-book' : 'opening-book';

        callLogger(
          logger,
          'log',
          `[CHESS PLAY] selected=${openingMove.san || openingMove.uci} source=${openingSource} player=${openingMove.player} games=${openingMove.games ?? 0}${openingName ? ` opening=${openingName}` : ''}`
        );

        return {
          selectedUci: openingMove.uci,
          selectedSource: openingSource,
          selectedRank: null,
          selectedLossCp: null,
          analysis: null,
          stockfishSan: openingMove.san ?? '',
          openingMove,
        };
      }

      callLogger(
        logger,
        'log',
        `[CHESS PLAY] opening-book miss fen="${chess.fen()}" history="${chess.history().join(' ')}" candidate=${openingMove?.uci ?? 'none'}`
      );
    } catch (error) {
      callLogger(logger, 'warn', '[CHESS PLAY] opening book failed:', error);
    }
  }

  let analysis = null;

  try {
    analysis = await analyzeFenWithStockfish(chess.fen(), {
      movetimeMs: Math.max(
        100,
        Number(options.movetimeMs ?? defaultKannyaMoveSelectorConfig.movetimeMs) || defaultKannyaMoveSelectorConfig.movetimeMs
      ),
      depth: Number.isInteger(options.depth) && options.depth > 0
        ? options.depth
        : null,
      multiPv,
      multipv: multiPv,
    });
  } catch (error) {
    callLogger(logger, 'warn', 'Stockfish chess play analysis failed:', error);
  }

  const candidates = normalizeStockfishCandidates(chess, analysis, legalUcis, multiPv);
  const bestCandidate = candidates.find((candidate) => candidate.rank === 1) ?? candidates[0];

  if (!bestCandidate) {
    return {
      selectedUci: pickRandomItem(legalUcis, randomFn) ?? '',
      selectedSource: 'fallback-random',
      selectedRank: null,
      selectedLossCp: null,
      analysis,
      stockfishSan: analysis?.san ?? '',
    };
  }

  const maxCandidateLossCp = Math.max(
    0,
    Number(options.maxCandidateLossCp ?? defaultKannyaMoveSelectorConfig.maxCandidateLossCp)
      || defaultKannyaMoveSelectorConfig.maxCandidateLossCp
  );
  const safeCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      lossCp: getCandidateLossCp(bestCandidate, candidate),
    }))
    .filter((candidate) =>
      candidate.rank === 1
      || candidate.lossCp <= maxCandidateLossCp
    );

  const bestGroup = safeCandidates.filter((candidate) => candidate.rank === 1);
  const secondThirdGroup = safeCandidates.filter((candidate) =>
    candidate.rank >= 2 && candidate.rank <= 3
  );
  const fourthSixthGroup = safeCandidates.filter((candidate) =>
    candidate.rank >= 4 && candidate.rank <= 6
  );

  const bestMoveRate = normalizeRate(
    options.bestMoveRate ?? defaultKannyaMoveSelectorConfig.bestMoveRate,
    defaultKannyaMoveSelectorConfig.bestMoveRate
  );
  const secondThirdRate = normalizeRate(
    options.secondThirdRate ?? defaultKannyaMoveSelectorConfig.secondThirdRate,
    defaultKannyaMoveSelectorConfig.secondThirdRate
  );
  const roll = randomFn();
  let selected = null;
  let selectedSource = 'stockfish';

  if (roll < bestMoveRate) {
    selected = pickRandomItem(bestGroup, randomFn) ?? bestCandidate;
    selectedSource = 'stockfish';
  } else if (roll < bestMoveRate + secondThirdRate) {
    selected =
      pickRandomItem(secondThirdGroup, randomFn) ??
      pickRandomItem(bestGroup, randomFn) ??
      bestCandidate;

    selectedSource = selected.rank === 1 ? 'stockfish' : 'candidate-2-3';
  } else {
    selected =
      pickRandomItem(fourthSixthGroup, randomFn) ??
      pickRandomItem(secondThirdGroup, randomFn) ??
      pickRandomItem(bestGroup, randomFn) ??
      bestCandidate;

    if (selected.rank >= 4) {
      selectedSource = 'candidate-4-6';
    } else if (selected.rank >= 2) {
      selectedSource = 'candidate-2-3';
    } else {
      selectedSource = 'stockfish';
    }
  }

  callLogger(
    logger,
    'log',
    `[CHESS PLAY] selected=${selected.san || selected.uci} source=${selectedSource} rank=${selected.rank} lossCp=${selected.lossCp ?? 0}`
  );

  return {
    selectedUci: selected.uci,
    selectedSource,
    selectedRank: selected.rank,
    selectedLossCp: selected.lossCp ?? 0,
    analysis,
    stockfishSan: bestCandidate.san || analysis?.san || '',
  };
}
