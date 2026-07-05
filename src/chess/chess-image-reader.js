import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const chessImageScriptPath = fileURLToPath(
  new URL('../../scripts/chess-image-to-fen.py', import.meta.url)
);

function getPythonInvocation() {
  const configuredCommand = process.env.CHESS_IMAGE_PYTHON?.trim();

  if (configuredCommand) {
    return {
      command: configuredCommand,
      argsPrefix: [],
    };
  }

  if (process.platform === 'win32') {
    return {
      command: 'py',
      argsPrefix: ['-3'],
    };
  }

  return {
    command: 'python3',
    argsPrefix: [],
  };
}

function compressFenRow(row) {
  const output = [];
  let empty = 0;

  for (const ch of row) {
    if (ch === '1' || ch === '.') {
      empty += 1;
      continue;
    }

    if (empty > 0) {
      output.push(String(empty));
      empty = 0;
    }

    output.push(ch);
  }

  if (empty > 0) {
    output.push(String(empty));
  }

  return output.join('');
}

function expandFenRow(row) {
  let output = '';

  for (const ch of String(row)) {
    if (/^[1-8]$/.test(ch)) {
      output += '1'.repeat(Number(ch));
    } else {
      output += ch;
    }
  }

  if (output.length !== 8) {
    throw new Error(`Invalid FEN row width: ${row}`);
  }

  return output;
}

function normalizeBoardFen(input) {
  const boardFen = String(input ?? '').trim().split(/\s+/)[0];

  if (!boardFen) {
    throw new Error('Empty board FEN');
  }

  const rows = boardFen.split('/');

  if (rows.length !== 8) {
    throw new Error(`Invalid board FEN row count: ${boardFen}`);
  }

  return rows.map((row) => compressFenRow(expandFenRow(row))).join('/');
}

function parseRecognizerOutput(stdout) {
  const text = String(stdout ?? '').trim();

  if (!text) {
    throw new Error('Chess image recognizer returned empty output');
  }

  try {
    const parsed = JSON.parse(text);
    return normalizeBoardFen(
      parsed?.fen ??
      parsed?.boardFen ??
      parsed?.board ??
      parsed?.result?.fen
    );
  } catch {
    return normalizeBoardFen(text);
  }
}

export async function imageToFen(imagePath, options = {}) {
  const boardOrientation = options.boardOrientation === 'b' ? 'b' : 'w';
  const turn = options.turn === 'b' ? 'b' : 'w';
  const timeoutMs =
    Number(options.timeoutMs ?? process.env.CHESS_IMAGE_TIMEOUT_MS) || 120_000;

  const { command, argsPrefix } = getPythonInvocation();

  const { stdout } = await execFileAsync(
    command,
    [
      ...argsPrefix,
      chessImageScriptPath,
      imagePath,
      boardOrientation,
    ],
    {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    }
  );

  const boardFen = parseRecognizerOutput(stdout);

  return `${boardFen} ${turn} - - 0 1`;
}