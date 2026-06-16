import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Chess } from 'chess.js';

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const imageToFenScriptPath = fileURLToPath(
  new URL('../../scripts/chess-image-to-fen.py', import.meta.url)
);

function getPythonCommand() {
  const configuredCommand = process.env.CHESS_IMAGE_PYTHON?.trim();
  if (configuredCommand) {
    return configuredCommand;
  }

  const venvCommand = process.platform === 'win32'
    ? path.join(projectRoot, '.venv-chess', 'Scripts', 'python.exe')
    : path.join(projectRoot, '.venv-chess', 'bin', 'python3');

  if (existsSync(venvCommand)) {
    return venvCommand;
  }

  return process.platform === 'win32' ? 'python' : 'python3';
}

export async function imageToFen(imagePath, turn = 'w', options = {}) {
  // turn은 "누구 차례인지" 용도로만 남겨둠.
  // chess-image-to-fen.py에 넘기는 값은 보드 방향이므로 따로 둔다.
  const normalizedTurn = turn === 'b' ? 'b' : 'w';

  // 기본은 백 기준 보드로 읽기.
  // %흑선이어도 여기는 black으로 바꾸면 안 됨.
  const boardOrientation = options.boardOrientation === 'b' ? 'b' : 'w';

  const timeoutMs = Math.max(
    10_000,
    Number(options.timeoutMs ?? process.env.CHESS_IMAGE_TIMEOUT_MS) || 120_000
  );

  const { stdout } = await execFileAsync(
    options.pythonCommand ?? getPythonCommand(),
    [imageToFenScriptPath, imagePath, boardOrientation],
    {
      cwd: projectRoot,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }
  );

  const rawFen = String(stdout ?? '').trim().split(/\r?\n/).at(-1)?.trim() ?? '';
  if (!rawFen) {
    throw new Error('chessimg2pos returned an empty FEN');
  }

  const boardFen = rawFen.split(/\s+/)[0];
  const fen = `${boardFen} ${normalizedTurn} - - 0 1`;

  try {
    new Chess(fen);
  } catch (error) {
    throw new Error(`chessimg2pos returned an invalid FEN: ${fen}`, {
      cause: error,
    });
  }

  return fen;
}