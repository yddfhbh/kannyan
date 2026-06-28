const uciMovePattern = /^[a-h][1-8][a-h][1-8][qrbn]?$/i;
const lowercaseBishopCapturePattern = /^bx[a-h][1-8][+#]?$/;

function stripUserChessMoveText(text) {
  return String(text ?? '')
    .trim()
    .replace(/^%+/, '')
    .trim();
}

export function normalizeUserChessMoveText(text) {
  let move = stripUserChessMoveText(text);

  move = move
    .replace(/^0-0-0$/i, 'O-O-O')
    .replace(/^0-0$/i, 'O-O');

  // UCI 입력: E2E4, e2e4, E7E8Q 같은 건 전부 소문자로
  if (uciMovePattern.test(move)) {
    return move.toLowerCase();
  }

  // 대문자 기물 SAN은 폰 입력보다 먼저 처리한다.
  // Bxf4가 bxf4로 내려가는 문제 방지.
  if (/^[KQRBN]/.test(move)) {
    move = move[0].toUpperCase() + move.slice(1);
    move = move.replace(/=([qrbn])/i, (_, piece) => `=${piece.toUpperCase()}`);
    return move;
  }

  // 폰 전진: E4, b4 같은 건 e4, b4로
  if (/^[a-h][1-8](?:=[qrbn])?[+#]?$/i.test(move)) {
    return move
      .toLowerCase()
      .replace(/=([qrbn])/i, (_, piece) => `=${piece.toUpperCase()}`);
  }

  // 폰 잡기: dxc3, EXD8=Q 같은 건 dxc3, exd8=Q로
  if (/^[a-h]x[a-h][1-8](?:=[qrbn])?[+#]?$/i.test(move)) {
    return move
      .toLowerCase()
      .replace(/=([qrbn])/i, (_, piece) => `=${piece.toUpperCase()}`);
  }

  // 말 수: nf3, bb5, qxd7 같은 건 Nf3, Bb5, Qxd7로
  move = move.replace(/^([nbrqk])(?=[a-h]?[1-8]?x?[a-h][1-8])/i, (match) => {
    return match.toUpperCase();
  });

  // 프로모션 기물은 대문자로: e8=q -> e8=Q
  move = move.replace(/=([qrbn])/i, (_, piece) => `=${piece.toUpperCase()}`);

  return move;
}

export function getUserChessMoveTextCandidates(text) {
  const move = stripUserChessMoveText(text);

  if (!move) {
    return [];
  }

  const candidates = [];
  const seen = new Set();

  const pushCandidate = (candidate) => {
    if (!candidate || seen.has(candidate)) {
      return;
    }

    seen.add(candidate);
    candidates.push(candidate);
  };

  // 소문자 b 캡처는 비숍/폰 SAN이 겹친다.
  // 비숍 표기를 먼저 시도하고, 불가능하면 원래 b폰 캡처로 폴백한다.
  if (lowercaseBishopCapturePattern.test(move)) {
    pushCandidate(normalizeUserChessMoveText(`B${move.slice(1)}`));
  }

  pushCandidate(normalizeUserChessMoveText(move));

  return candidates;
}

export function applyUserChessMove(chess, input) {
  for (const moveText of getUserChessMoveTextCandidates(input)) {
    try {
      if (uciMovePattern.test(moveText)) {
        const move = {
          from: moveText.slice(0, 2).toLowerCase(),
          to: moveText.slice(2, 4).toLowerCase(),
        };

        if (moveText[4]) {
          move.promotion = moveText[4].toLowerCase();
        }

        const applied = chess.move(move);
        if (applied) {
          return applied;
        }
        continue;
      }

      const applied = chess.move(moveText);
      if (applied) {
        return applied;
      }
    } catch {
      // Try the next candidate when SAN is ambiguous, such as bxc3.
    }
  }

  return null;
}
