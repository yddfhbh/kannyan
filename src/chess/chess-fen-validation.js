import { Chess } from 'chess.js';

export function validateAnalyzableChessFen(fen, expectedTurn = null) {
  const normalizedFen = String(fen ?? '').trim();
  const chess = new Chess(normalizedFen);

  if (expectedTurn && chess.turn() !== expectedTurn) {
    throw new Error(`Recognized turn mismatch: expected=${expectedTurn}, actual=${chess.turn()}`);
  }

  if (chess.isGameOver()) {
    throw new Error('Recognized image position is already terminal');
  }

  return normalizedFen;
}
