const chessMovePattern =
  /(?:O-O-O|O-O|0-0-0|0-0|[a-h][1-8][a-h][1-8][qrbn]?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBNqrbn])?[+#]?|[a-h]x[a-h][1-8](?:=[QRBNqrbn])?[+#]?|[a-h][1-8](?:=[QRBNqrbn])?[+#]?)/gi;
const whiteTurnPattern =
  /(백선|백\s*(?:차례|턴|수)|백(?:은|는|이|가)|백\s*(?:으로|입장|이야|임)|(?:^|\s)백(?=\s|$)|white(?:\s+to\s+move|\s+turn)?)/i;
const blackTurnPattern =
  /(흑선|흑\s*(?:차례|턴|수)|흑(?:은|는|이|가)|흑\s*(?:으로|입장|이야|임)|(?:^|\s)흑(?=\s|$)|black(?:\s+to\s+move|\s+turn)?)/i;
const hypotheticalLinePattern =
  /(하면|두면|뒀을때|뒀을 때|오면|이후|다음|그다음|그 다음|뒤에|then|after)/i;

export function looksLikeChessMoveInput(text) {
  const value = String(text ?? '').trim();

  return /^(?:[a-h][1-8][a-h][1-8][qrbn]?|O-O(?:-O)?[+#]?|0-0(?:-0)?[+#]?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?|[a-h][1-8](?:=[QRBN])?[+#]?)$/i.test(value);
}

export function extractMentionedChessMoves(text) {
  const value = String(text ?? '')
    .trim()
    .replace(/^%+/, '')
    .trim();

  if (!value) {
    return [];
  }

  if (looksLikeChessMoveInput(value)) {
    return [value];
  }

  return [...value.matchAll(chessMovePattern)]
    .map((match) => match[0])
    .filter((candidate) => looksLikeChessMoveInput(candidate));
}

export function extractMentionedChessMove(text) {
  return extractMentionedChessMoves(text).at(-1) ?? '';
}

export function extractChessTurnHint(text) {
  const value = String(text ?? '').trim();
  const whiteMatch = value.match(whiteTurnPattern);
  const blackMatch = value.match(blackTurnPattern);

  if (whiteMatch && !blackMatch) {
    return 'w';
  }

  if (blackMatch && !whiteMatch) {
    return 'b';
  }

  if (whiteMatch && blackMatch) {
    return (whiteMatch.index ?? Number.MAX_SAFE_INTEGER) <= (blackMatch.index ?? Number.MAX_SAFE_INTEGER)
      ? 'w'
      : 'b';
  }

  return '';
}

export function looksLikeChessMoveSequenceQuestion(text) {
  const moves = extractMentionedChessMoves(text);
  if (moves.length >= 2) {
    return true;
  }

  return moves.length === 1 && hypotheticalLinePattern.test(String(text ?? ''));
}
