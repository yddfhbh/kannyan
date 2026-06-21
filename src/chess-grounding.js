const chessNotationPattern =
  /(?:\bO-O(?:-O)?[+#]?\b|\b0-0(?:-0)?[+#]?\b|\b[a-h][1-8][a-h][1-8][qrbn]?\b|\b[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBNqrbn])?[+#]?\b|\b[a-h]x[a-h][1-8](?:=[QRBNqrbn])?[+#]?\b|\b[a-h][1-8](?:=[QRBNqrbn])?[+#]?\b)/i;
const chessTopicPattern =
  /(?:체스|체스판|체닷|리체스|기보|포지션|fen|스톡피시|stockfish|오프닝|엔드게임|미들게임|메이트|체크메이트|스테일메이트|전술|캐슬링|앙파상|프로모션|시실리안|나이도프|카로칸|프렌치|루이\s*로페즈|퀸즈?\s*갬빗|슬라브|님조|런던|이탈리안|스카치|그륀펠드|피르크|베노니|알라핀|스베시니코프|dragon|sicilian|najdorf|caro(?:-| )?kann|french\s*defense|ruy\s*lopez|queen'?s\s*gambit|slav|nimzo|london|italian|scotch|gr(?:u|ü)nfeld|pirc|benoni|alapin|sveshnikov|chess(?:\.com|board)?|lichess)/i;

export function looksLikeChessTopicPrompt(text) {
  const value = String(text ?? '')
    .replace(/^%+/, '')
    .trim();

  if (!value) {
    return false;
  }

  return chessTopicPattern.test(value) || chessNotationPattern.test(value);
}

export function shouldForceWebSearchForChessPrompt(text, options = {}) {
  if (!looksLikeChessTopicPrompt(text)) {
    return false;
  }

  return !options.hasStockfishContext
    && !options.detectedChessboard
    && !options.prioritizeChessImageAnalysis;
}

export function shouldRequireStockfishForChessPrompt(text, options = {}) {
  if (options.detectedChessboard) {
    return true;
  }

  return looksLikeChessTopicPrompt(text);
}

export function buildChessGroundedPrompt(prompt, options = {}) {
  const mode = options.mode === 'web' ? 'web' : 'stockfish';

  const rules = mode === 'web'
    ? [
        '아래 웹 검색 결과에 직접 나온 내용만 근거로 답한다.',
        '검색 결과에 없는 수순, 엔진 평가, 오프닝 평가는 추측하지 않는다.',
        '검색 결과만으로 확인되지 않는 내용은 확인할 수 없다고 분명히 말한다.',
      ]
    : [
        '아래 내부 체스 분석 도구 결과만 근거로 답한다.',
        '도구 결과에 없는 수, 평가, 수순, 차례 정보, 전술 목적은 추측하지 않는다.',
        '근거가 부족하면 모른다고 짧게 말한다.',
      ];

  return [
    String(prompt ?? '').trim(),
    '',
    '[체스 답변 근거 규칙]',
    ...rules,
  ].filter(Boolean).join('\n');
}

export function createUngroundedChessReply(options = {}) {
  if (options.needsBoardEvidence) {
    return '이 체스 질문은 Stockfish로 검증할 체스판/FEN을 확보하지 못해서 추측해서 답하진 않겠다냥. 체스판 이미지가 더 잘 보이게 보내주거나 `%fen <FEN>`으로 주면 그 근거만으로 설명하겠다냥.';
  }

  if (options.webSearchAttempted) {
    return '이 체스 질문은 웹 검색으로도 바로 검증할 정보가 부족했고, 지금은 Stockfish를 돌릴 구체적인 포지션/FEN/기보도 없어서 추측해서 답하진 않겠다냥. 기보, FEN, 체스판 이미지처럼 계산 가능한 근거를 주면 그 기준으로 설명하겠다냥.';
  }

  return '이 체스 질문은 확인 가능한 체스판/FEN/기보나 웹 검색 근거가 없어서 추측해서 답하진 않겠다냥. 체스판 이미지, `%fen <FEN>`, 기보, 아니면 `%검색 ...`처럼 보내주면 그 근거만으로만 설명하겠다냥.';
}
