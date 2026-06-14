import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Chess } from 'chess.js';
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
  /(백선|백\s*(?:의\s*)?(?:차례|턴|수)|백\s*(?:으로|입장|이야|임)|(?:^|\s)백(?=\s|$)|white(?:\s+to\s+move|\s+turn)?)/i;
const blackTurnPattern =
  /(흑선|흑\s*(?:의\s*)?(?:차례|턴|수)|흑\s*(?:으로|입장|이야|임)|(?:^|\s)흑(?=\s|$)|black(?:\s+to\s+move|\s+turn)?)/i;
const explicitChessContextPattern =
  /(체스|체스판|chess(?:board)?|fen|포지션|기보|체크메이트|메이트)/i;

export function parseChessImageAnalysisPrompt(content) {
  const text = String(content ?? '').trim();
  if (!text.startsWith('%')) {
    return null;
  }

  const prompt = text.slice(1).trim();
  if (!solveIntentPattern.test(prompt)) {
    return null;
  }

  const white = whiteTurnPattern.test(prompt);
  const black = blackTurnPattern.test(prompt);

  return {
    turn: white === black ? null : white ? 'w' : 'b',
    explicitChess: explicitChessContextPattern.test(prompt) || white || black,
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

  new Chess(fen);
  return fen;
}

export async function handleChessAnalysisMessage(message, options = {}) {
  const directFenMatch = String(message.content ?? '').trim().match(/^%fen(?:\s+(.+))?$/i);
  if (directFenMatch) {
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
      title: 'FEN 분석',
    });
    return true;
  }

  const prompt = parseChessImageAnalysisPrompt(message.content);
  if (!prompt) {
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

  if (!prompt.turn && prompt.explicitChess) {
    await replyWithoutPing(
      message,
      '백 차례인지 흑 차례인지 같이 적어달라냥. 예: `%백선 풀어봐`'
    );
    return true;
  }

  await message.channel.sendTyping().catch(() => {});

  let temporaryImage = null;
  let fen;

  try {
    temporaryImage = await downloadChessImageAttachment(attachment);
    fen = await (options.imageToFen ?? imageToFen)(
      temporaryImage.filePath,
      prompt.turn ?? 'w'
    );
  } catch (error) {
    if (!prompt.explicitChess) {
      return false;
    }

    console.error('Failed to recognize chess position from image:');
    console.error(error);
    await replyWithoutPing(
      message,
      '이미지에서 체스판을 인식하지 못했다냥. FEN을 직접 `%fen <FEN>` 형식으로 입력해달라냥.'
    );
    return true;
  } finally {
    await temporaryImage?.cleanup();
  }

  if (!prompt.turn) {
    await replyWithoutPing(
      message,
      '체스판은 확인했다냥. 백 차례인지 흑 차례인지만 같이 적어달라냥.'
    );
    return true;
  }

  await analyzeAndReply(message, fen, {
    analyzeFen: options.analyzeFen,
    title: '체스 이미지 분석',
  });
  return true;
}

async function analyzeAndReply(message, fen, options = {}) {
  try {
    await message.channel.sendTyping().catch(() => {});
    const result = await (options.analyzeFen ?? analyzeFenWithStockfish)(fen, {
      movetimeMs: Math.max(
        100,
        Number(process.env.CHESS_STOCKFISH_MOVETIME_MS) || 2000
      ),
    });

    await replyWithoutPing(
      message,
      formatChessAnalysisResult(fen, result, options.title)
    );
  } catch (error) {
    console.error(`Failed to analyze chess FEN ${fen}:`);
    console.error(error);
    await replyWithoutPing(
      message,
      'FEN은 읽었지만 Stockfish 분석에 실패했다냥. 잠시 뒤 다시 시도해달라냥.'
    );
  }
}

export function formatChessAnalysisResult(fen, result, title = '체스 분석') {
  const bestMove = result.bestMove && result.bestMove !== '(none)'
    ? `**${result.san}** (\`${result.bestMove}\`)`
    : '둘 수 있는 수가 없다냥.';
  const lines = [
    `**${title}**`,
    `FEN: \`${fen}\``,
    `최선 수: ${bestMove}`,
  ];

  const score = formatStockfishScore(result.score);
  if (score) {
    lines.push(`평가: \`${score}\` (현재 차례 기준)`);
  }

  if (result.depth) {
    lines.push(`탐색 깊이: \`${result.depth}\``);
  }

  return lines.join('\n');
}

function formatStockfishScore(score) {
  if (!score) {
    return '';
  }

  if (score.type === 'mate') {
    return score.value < 0 ? `-M${Math.abs(score.value)}` : `+M${score.value}`;
  }

  const pawns = score.value / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

async function resolveChessImageAttachment(message) {
  const directAttachment = [...message.attachments.values()]
    .find(isSupportedChessImageAttachment);
  if (directAttachment) {
    return directAttachment;
  }

  if (!message.reference?.messageId) {
    return null;
  }

  try {
    const referencedMessage = await message.fetchReference();
    return [...referencedMessage.attachments.values()]
      .find(isSupportedChessImageAttachment) ?? null;
  } catch (error) {
    console.error(`Failed to fetch referenced chess image ${message.reference.messageId}:`);
    console.error(error);
    return null;
  }
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
