import { Chess } from 'chess.js';
import { createStockfishExplanationContext } from './chess-explanation.js';
import { validateAnalyzableChessFen } from './chess-fen-validation.js';
import { analyzeFenWithStockfish } from './stockfish-lite.js';

function normalizeBoardFen(boardFen, turn) {
  const normalizedBoard = String(boardFen ?? '').trim().split(/\s+/)[0];
  const normalizedTurn = turn === 'b' ? 'b' : 'w';
  const fen = `${normalizedBoard} ${normalizedTurn} - - 0 1`;
  const chess = new Chess(fen);
  const pieces = chess.board().flat().filter(Boolean);
  const whiteKings = pieces.filter((piece) => piece.type === 'k' && piece.color === 'w').length;
  const blackKings = pieces.filter((piece) => piece.type === 'k' && piece.color === 'b').length;

  if (whiteKings !== 1 || blackKings !== 1) {
    throw new Error('Recognized chessboard must contain exactly one king per side');
  }

  return validateAnalyzableChessFen(fen, normalizedTurn);
}

function formatAnalyzedMove(turn, result) {
  const side = turn === 'b' ? '흑' : '백';
  if (!result?.bestMove || result.bestMove === '(none)' || !result.san) {
    return `${side} 차례: 둘 수 있는 수가 없거나 이미 끝난 포지션`;
  }

  return [
    `${side} 차례 분석:`,
    createStockfishExplanationContext(result, { maxPlies: 6 }),
  ].join('\n');
}

export async function createChessImageAnalysisContext(recognition, options = {}) {
  if (!recognition?.isChessboard || !recognition.boardFen) {
    return options.returnDetails
      ? {
          context: '',
          recognizedTurn: null,
          boardFen: '',
          analyses: [],
        }
      : '';
  }

  const analyzeFen = options.analyzeFen ?? analyzeFenWithStockfish;
  const recognizedTurn = recognition.turn === 'w' || recognition.turn === 'b'
    ? recognition.turn
    : null;
  const turns = recognizedTurn ? [recognizedTurn] : ['w', 'b'];
  const analyses = [];

  for (const turn of turns) {
    try {
      const fen = normalizeBoardFen(recognition.boardFen, turn);
      const result = await analyzeFen(fen, {
        movetimeMs: Math.max(
          100,
          Number(options.movetimeMs ?? process.env.CHESS_STOCKFISH_MOVETIME_MS) || 2000
        ),
      });
      analyses.push({ turn, fen, result });
    } catch (error) {
      if (recognizedTurn) {
        throw error;
      }
    }
  }

  if (analyses.length === 0) {
    return options.returnDetails
      ? {
          context: '',
          recognizedTurn,
          boardFen: recognition.boardFen,
          analyses: [],
        }
      : '';
  }

  const turnInstruction = recognizedTurn
    ? `현재 차례는 ${recognizedTurn === 'w' ? '백' : '흑'}으로 보고 계산했다.`
    : '정지 이미지에서 현재 차례를 확정할 수 없어 백 차례와 흑 차례를 각각 계산했다.';
  const responseInstruction = recognizedTurn
    ? '답변의 체스 수와 전술 설명은 아래 Stockfish 결과에 맞춰라.'
    : '차례를 단정하지 말고, 첫 문장에서 반드시 "백 차례면 ..., 흑 차례면 ..." 형식으로 두 경우의 최선 수를 바로 말한 뒤 아래 결과를 조건부로 설명하라.';

  const context = [
    '[내부 체스 분석 도구 결과]',
    '아래 포지션을 기준으로 계산했다.',
    turnInstruction,
    ...analyses.map(({ turn, result }) => formatAnalyzedMove(turn, result)),
    '',
    '[응답 규칙]',
    responseInstruction,
    '최선 수가 왜 좋은지는 반드시 상대의 최선 대응과 후속 수를 근거로 설명하라.',
    '확인된 수순으로 입증되지 않은 "공격을 막는다", "기물을 정리한다", "주도권을 잡는다" 같은 상투적 표현은 쓰지 마라.',
    '짧은 주 변형만으로 전략적 목적을 확정하기 어렵다면 추측하지 말고 예상 수순 자체를 자연스럽게 설명하라.',
    '답변 첫머리에 사진, 이미지, 체스판 같은 메타 설명을 넣지 말고 바로 수나 상황 설명으로 시작하라.',
    '사용자의 질문과 이미지 전체 맥락에 자연스럽게 답하고, 딱딱한 분석 보고서 형식으로 바꾸지 마라.',
    '내부 FEN, UCI, 평가 수치, 탐색 깊이는 출력하지 마라.',
  ].join('\n');

  if (options.returnDetails) {
    return {
      context,
      recognizedTurn,
      boardFen: recognition.boardFen,
      analyses,
    };
  }

  return context;
}
