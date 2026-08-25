import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPuzzleImageSvg } from '../src/daily-chess-puzzle.js';

function getBoardSquareFill(svg, { row, col }) {
  const boardMatch = svg.match(
    new RegExp(
      `<rect x="${40 + col * 60}" y="${58 + row * 60}" width="60" height="60" fill="([^"]+)"\\/>`
    )
  );
  return boardMatch?.[1] ?? null;
}

test('renderPuzzleImageSvg uses standard chessboard colors when not flipped', async () => {
  const svg = await renderPuzzleImageSvg({
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    title: 'test',
    subtitle: 'test',
    flipped: false,
  });

  assert.equal(getBoardSquareFill(svg, { row: 7, col: 0 }), '#b58863');
  assert.equal(getBoardSquareFill(svg, { row: 7, col: 7 }), '#f0d9b5');
  assert.equal(getBoardSquareFill(svg, { row: 0, col: 0 }), '#f0d9b5');
  assert.equal(getBoardSquareFill(svg, { row: 0, col: 7 }), '#b58863');
});

test('renderPuzzleImageSvg preserves standard chessboard colors when flipped', async () => {
  const svg = await renderPuzzleImageSvg({
    fen: '4k3/8/8/8/8/8/8/4K3 b - - 0 1',
    title: 'test',
    subtitle: 'test',
    flipped: true,
  });

  assert.equal(getBoardSquareFill(svg, { row: 7, col: 0 }), '#b58863');
  assert.equal(getBoardSquareFill(svg, { row: 7, col: 7 }), '#f0d9b5');
  assert.equal(getBoardSquareFill(svg, { row: 0, col: 0 }), '#f0d9b5');
  assert.equal(getBoardSquareFill(svg, { row: 0, col: 7 }), '#b58863');
});
