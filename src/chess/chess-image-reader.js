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
  const normalizedTurn = turn === 'b' ? 'b' : 'w';
  const timeoutMs = Math.max(
    10_000,
    Number(options.timeoutMs ?? process.env.CHESS_IMAGE_TIMEOUT_MS) || 120_000
  );

  const { stdout } = await execFileAsync(
    options.pythonCommand ?? getPythonCommand(),
    [imageToFenScriptPath, imagePath, normalizedTurn],
    {
      cwd: projectRoot,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }
  );

  const fen = String(stdout ?? '').trim().split(/\r?\n/).at(-1)?.trim() ?? '';
  if (!fen) {
    throw new Error('chessimg2pos returned an empty FEN');
  }

  try {
    new Chess(fen);
  } catch (error) {
    throw new Error(`chessimg2pos returned an invalid FEN: ${fen}`, {
      cause: error,
    });
  }

  return fen;
}
