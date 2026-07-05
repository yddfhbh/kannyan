import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Chess } from 'chess.js';
import {
  getMessageChainAttachments,
  resolveReferencedMessageChain,
} from '../discord-message-context.js';
import { validateAnalyzableChessFen } from './chess-fen-validation.js';
import { imageToFen } from './chess-image-reader.js';
import { analyzeFenWithStockfish } from './stockfish-lite.js';

const supportedImageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const supportedImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const chessImageMaxBytes = Math.max(
  1024,
  Number(process.env.CHESS_IMAGE_MAX_BYTES) || 8 * 1024 * 1024
);
const solveIntentPattern =
  /(풀|분석|해설|정답|해답|답\s*(?:이|은)?\s*(?:뭐|무엇|알려|찾)|봐\s*(?:줘|봐|주라)|최선\s*수|베스트\s*수|best\s*move|좋은\s*수|다음\s*수|어떻게\s*(?:둬|해|해야)|어떡해|뭐\s*둬|뭘\s*둬|무슨\s*수|수\s*(?:찾아|알려|추천)|이길\s*수|메이트|체크메이트|해결)/i;
const whiteTurnPattern =
  /(백선|백\s*(?:의\s*)?(?:차례|턴|수)|백(?:은|는|이|가)|백\s*(?:으로|입장|이야|임)|(?:^|\s)백(?=\s|$)|white(?:\s+to\s+move|\s+turn)?)/i;
const blackTurnPattern =
  /(흑선|흑\s*(?:의\s*)?(?:차례|턴|수)|흑(?:은|는|이|가)|흑\s*(?:으로|입장|이야|임)|(?:^|\s)흑(?=\s|$)|black(?:\s+to\s+move|\s+turn)?)/i;
const explicitChessContextPattern =
  /(체스|체스판|chess(?:board)?|fen|포지션|기보|체크메이트|메이트)/i;
const bareTurnCommandPattern =
  /^(?:백선|흑선|백\s*(?:의\s*)?(?:차례|턴|수)|흑\s*(?:의\s*)?(?:차례|턴|수)|백\s*(?:이야|임)|흑\s*(?:이야|임)|white(?:\s+to\s+move|\s+turn)?|black(?:\s+to\s+move|\s+turn)?)$/i;
  
export function parseChessImageAnalysisPrompt(content) {
  const text = String(content ?? '').trim();
  if (!text.startsWith('%')) {
    return null;
  }

  const prompt = text.slice(1).trim();
  const white = whiteTurnPattern.test(prompt);
  const black = blackTurnPattern.test(prompt);
  const hasSolveIntent = solveIntentPattern.test(prompt);
  const isBareTurnCommand = bareTurnCommandPattern.test(prompt);

  // "%백선", "%흑선" 같은 단독 명령은 체스 이미지 분석으로 처리
  // "%흑선 분석해줘", "%백 차례 최선수"처럼 분석 의도가 있으면 처리
  // "%나랑 체스하자 내가 백이야 e4" 같은 일반 대화는 Gemini로 넘김
  if (!hasSolveIntent && !isBareTurnCommand) {
    return null;
  }

  return {
    turn: white === black ? null : white ? 'w' : 'b',
    explicitChess: explicitChessContextPattern.test(prompt) || isBareTurnCommand || white !== black,
  };
}

function getPromptTurnHint(prompt) {
  const white = whiteTurnPattern.test(prompt);
  const black = blackTurnPattern.test(prompt);
  return white === black ? null : white ? 'w' : 'b';
}

function parseFenExtractionPrompt(content) {
  const directFenMatch = String(content ?? '').trim().match(/^%fen(?:\s+(.+))?$/i);
  if (!directFenMatch) {
    return null;
  }

  const prompt = String(directFenMatch[1] ?? '').trim();
  if (
    !prompt
    || !/(?:추출|뽑(?:아|아서)?|읽(?:어|어줘)?|인식|알려(?:줘)?|보여(?:줘)?|적어(?:줘)?|써줘|extract|read|tell)/i.test(prompt)
  ) {
    return null;
  }

  return {
    prompt,
    turn: getPromptTurnHint(prompt),
  };
}

export function normalizeDirectFen(input) {
  const fields = String(input ?? '').trim().split(/\s+/).filter(Boolean);
  const fen = fields.length === 4
    ? `${fields.join(' ')} 0 1`
    : fields.length === 6
      ? fields.join(' ')
      : '';

  if (!fen) {
    throw new Error('FEN must contain 4 or 6 fields');
  }

  const chess = new Chess(fen);
  const pieces = chess.board().flat().filter(Boolean);
  const whiteKings = pieces.filter((piece) => piece.type === 'k' && piece.color === 'w').length;
  const blackKings = pieces.filter((piece) => piece.type === 'k' && piece.color === 'b').length;

  if (whiteKings !== 1 || blackKings !== 1) {
    throw new Error('FEN must contain exactly one king per side');
  }

  return fen;
}

function forceFenTurn(fen, turn) {
  const normalizedTurn = turn === 'b' ? 'b' : 'w';
  const fields = String(fen ?? '').trim().split(/\s+/).filter(Boolean);

  if (fields.length < 4) {
    throw new Error(`Invalid FEN field count: ${fen}`);
  }

  const output =
    fields.length >= 6
      ? fields.slice(0, 6)
      : [fields[0], fields[1] ?? normalizedTurn, fields[2] ?? '-', fields[3] ?? '-', '0', '1'];

  output[1] = normalizedTurn;

  return output.join(' ');
}

export async function handleChessAnalysisMessage(message, options = {}) {
  const directFenMatch = String(message.content ?? '').trim().match(/^%fen(?:\s+(.+))?$/i);
  if (directFenMatch) {
    const extractionPrompt = parseFenExtractionPrompt(message.content);
    if (extractionPrompt) {
      return handleFenExtractionMessage(message, extractionPrompt, options);
    }

    if (!directFenMatch[1]) {
      await replyWithoutPing(
        message,
        '분석할 FEN도 같이 입력해달라냥. 예: `%fen 8/8/8/8/8/8/4K3/7k w - - 0 1`'
      );
      return true;
    }

    let fen;

    try {
      fen = normalizeDirectFen(directFenMatch[1]);
    } catch (error) {
      await replyWithoutPing(
        message,
        'FEN 형식이 올바르지 않다냥. `%fen <FEN>` 형식으로 다시 입력해달라냥.'
      );
      return true;
    }

    await analyzeAndReply(message, fen, {
      analyzeFen: options.analyzeFen,
      createReply: options.createReply,
    });
    return true;
  }

  const prompt = parseChessImageAnalysisPrompt(message.content);
  if (!prompt) {
    return false;
  }

  if (!prompt.turn) {
    return false;
  }

  const attachment = await resolveChessImageAttachment(message);
  if (!attachment) {
    await replyWithoutPing(
      message,
      '분석할 체스판 이미지를 첨부하거나 이미지 메시지에 답장해달라냥.'
    );
    return true;
  }

  await message.channel.sendTyping().catch(() => {});

  let temporaryImage = null;
  let fen;

  try {
    temporaryImage = await downloadChessImageAttachment(attachment);
    let detectedBoardOrientation = null;

if (typeof options.detectBoardOrientation === 'function') {
  try {
    detectedBoardOrientation = await options.detectBoardOrientation({
      message,
      imagePath: temporaryImage.filePath,
      turn: prompt.turn,
    });
  } catch (error) {
    console.error('Chess board orientation detection failed:');
    console.error(error);
  }
}

const boardOrientation =
  detectedBoardOrientation === 'b'
    ? 'b'
    : detectedBoardOrientation === 'w'
      ? 'w'
      : null;

if (!boardOrientation) {
  throw new Error('Chess board orientation could not be detected');
}

console.log(
  `[CHESS IMAGE] turn=${prompt.turn} boardOrientation=${boardOrientation}`
);

const recognizedFen = await (options.imageToFen ?? imageToFen)(
  temporaryImage.filePath,
  prompt.turn,
  {
    boardOrientation,
  }
);

fen = validateAnalyzableChessFen(forceFenTurn(recognizedFen, prompt.turn), prompt.turn);

  } catch (error) {
    console.error('Primary chess image recognition failed:');
    console.error(error);

    if (options.recognizeFenFallback) {
      try {
        const fallbackFen = await options.recognizeFenFallback({
          message,
          turn: prompt.turn,
        });
        fen = validateAnalyzableChessFen(forceFenTurn(fallbackFen, prompt.turn), prompt.turn);
      } catch (fallbackError) {
        console.error('Gemini chess image recognition fallback failed:');
        console.error(fallbackError);
      }
    }

    if (fen) {
      // Continue to Stockfish with the validated vision fallback FEN.
    } else if (!prompt.explicitChess) {
      return false;
    } else {
      await replyWithoutPing(
        message,
        '이미지에서 체스판을 인식하지 못했다냥. FEN을 직접 `%fen <FEN>` 형식으로 입력해달라냥.'
      );
      return true;
    }
  } finally {
    await temporaryImage?.cleanup();
  }

  await analyzeAndReply(message, fen, {
    analyzeFen: options.analyzeFen,
    createReply: options.createReply,
  });
  return true;
}

async function handleFenExtractionMessage(message, prompt, options = {}) {
  const attachment = await resolveChessImageAttachment(message);
  if (!attachment) {
    await replyWithoutPing(
      message,
      'FEN을 추출할 체스판 이미지를 첨부하거나 그 이미지를 답글로 지정해달라냥.'
    );
    return true;
  }

  await message.channel.sendTyping().catch(() => {});

  let temporaryImage = null;

  try {
    temporaryImage = await downloadChessImageAttachment(attachment);
    const fen = await extractFenFromImage(message, temporaryImage.filePath, prompt, options);

    if (typeof options.onFenExtracted === 'function') {
      try {
        await options.onFenExtracted({
          message,
          fen,
          boardFen: String(fen).trim().split(/\s+/)[0] ?? '',
        });
      } catch (error) {
        console.error('Failed to remember extracted chess FEN:');
        console.error(error);
      }
    }

    await replyWithoutPing(message, `추출한 FEN은 \`${fen}\` 이다냥.`);
  } catch (error) {
    console.error('Chess FEN extraction failed:');
    console.error(error);
    await replyWithoutPing(
      message,
      '이미지에서 FEN을 추출하지 못했다냥. 체스판이 더 잘 보이게 다시 보내주거나 `%fen <FEN>`으로 직접 입력해달라냥.'
    );
  } finally {
    await temporaryImage?.cleanup();
  }

  return true;
}

async function extractFenFromImage(message, imagePath, prompt, options = {}) {
  if (typeof options.extractFenFromImage === 'function') {
    return normalizeDirectFen(
      await options.extractFenFromImage({
        message,
        imagePath,
        turn: prompt.turn,
      })
    );
  }

  if (!prompt.turn) {
    throw new Error('FEN extraction needs a side-to-move hint or custom extractor');
  }

  let detectedBoardOrientation = null;

  if (typeof options.detectBoardOrientation === 'function') {
    try {
      detectedBoardOrientation = await options.detectBoardOrientation({
        message,
        imagePath,
        turn: prompt.turn,
      });
    } catch (error) {
      console.error('Chess board orientation detection failed during FEN extraction:');
      console.error(error);
    }
  }

  const boardOrientation =
    detectedBoardOrientation === 'b'
      ? 'b'
      : detectedBoardOrientation === 'w'
        ? 'w'
        : null;

  if (!boardOrientation) {
    throw new Error('Chess board orientation could not be detected');
  }

  const recognizedFen = await (options.imageToFen ?? imageToFen)(imagePath, prompt.turn, {
    boardOrientation,
  });

  return normalizeDirectFen(recognizedFen);
}

async function analyzeAndReply(message, fen, options = {}) {
  try {
    await message.channel.sendTyping().catch(() => {});
    const result = await (options.analyzeFen ?? analyzeFenWithStockfish)(fen, {
  movetimeMs: Math.max(
    100,
    Number(process.env.CHESS_STOCKFISH_MOVETIME_MS) || 2000
  ),
  multiPv: Math.max(
    1,
    Math.min(5, Number(process.env.CHESS_STOCKFISH_MULTIPV) || 3)
  ),
});

    let responseText = '';
    if (options.createReply) {
      try {
        responseText = await options.createReply({
          message,
          fen,
          result,
        });
      } catch (error) {
        console.error('Failed to generate natural chess analysis reply:');
        console.error(error);
      }
    }

    await replyWithoutPing(message, responseText || formatChessAnalysisResult(fen, result));
  } catch (error) {
    console.error(`Failed to analyze chess FEN ${fen}:`);
    console.error(error);
    await replyWithoutPing(
      message,
      'FEN은 읽었지만 Stockfish 분석에 실패했다냥. 잠시 뒤 다시 시도해달라냥.'
    );
  }
}

export function formatChessAnalysisResult(_fen, result) {
  if (!result.bestMove || result.bestMove === '(none)') {
    return '이미 끝난 포지션이라 둘 수 있는 수가 없다냥.';
  }

  if (result.san?.includes('#')) {
    return `최선 수는 **${result.san}**다냥! 바로 체크메이트다냥.`;
  }

  return `최선 수는 **${result.san}**다냥.`;
}

async function resolveChessImageAttachment(message) {
  const referencedMessages = await resolveReferencedMessageChain(message, {
    onError(error, sourceMessage) {
      console.error(
        `Failed to fetch referenced chess image ${sourceMessage.reference?.messageId}:`
      );
      console.error(error);
    },
  });

  return getMessageChainAttachments(message, referencedMessages)
    .find(isSupportedChessImageAttachment) ?? null;
}

function isSupportedChessImageAttachment(attachment) {
  const contentType = String(attachment.contentType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const extension = path.extname(String(attachment.name ?? '')).toLowerCase();

  if (!supportedImageMimeTypes.has(contentType) && !supportedImageExtensions.has(extension)) {
    return false;
  }

  return Boolean(attachment.url)
    && Number(attachment.size ?? 0) <= chessImageMaxBytes;
}

async function downloadChessImageAttachment(attachment) {
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`Discord attachment fetch failed with ${response.status}`);
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  if (imageBuffer.length > chessImageMaxBytes) {
    throw new Error(`Chess image is too large: ${imageBuffer.length} bytes`);
  }

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-chess-'));
  const extension = getAttachmentExtension(attachment);
  const filePath = path.join(temporaryDirectory, `position${extension}`);

  try {
    await fs.writeFile(filePath, imageBuffer);
  } catch (error) {
    await fs.rmdir(temporaryDirectory).catch(() => {});
    throw error;
  }

  return {
    filePath,
    async cleanup() {
      await fs.unlink(filePath).catch(() => {});
      await fs.rmdir(temporaryDirectory).catch(() => {});
    },
  };
}

function getAttachmentExtension(attachment) {
  const extension = path.extname(String(attachment.name ?? '')).toLowerCase();
  if (supportedImageExtensions.has(extension)) {
    return extension;
  }

  const contentType = String(attachment.contentType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  return contentType === 'image/png'
    ? '.png'
    : contentType === 'image/webp'
      ? '.webp'
      : '.jpg';
}

function replyWithoutPing(message, content) {
  return message.reply({
    content,
    allowedMentions: { parse: [], repliedUser: false },
  });
}
