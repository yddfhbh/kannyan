import fs from 'node:fs/promises';
import sharp from 'sharp';

const pieceDir = new URL('../assets/chess-pieces/cburnett/', import.meta.url);

const pieces = [
  'wK', 'wQ', 'wR', 'wB', 'wN', 'wP',
  'bK', 'bQ', 'bR', 'bB', 'bN', 'bP',
];

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function parseSvgForInline(svg) {
  const cleaned = String(svg)
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .trim();

  const viewBoxMatch = cleaned.match(/viewBox=["']([^"']+)["']/i);
  const widthMatch = cleaned.match(/width=["']([^"']+)["']/i);
  const heightMatch = cleaned.match(/height=["']([^"']+)["']/i);

  const viewBox =
    viewBoxMatch?.[1] ??
    (widthMatch && heightMatch ? `0 0 ${widthMatch[1]} ${heightMatch[1]}` : '0 0 64 64');

  const inner = cleaned
    .replace(/^<svg\b[^>]*>/i, '')
    .replace(/<\/svg>\s*$/i, '')
    .trim();

  return { viewBox, inner };
}

async function inlinePiece(pieceName, x, y, size) {
  const raw = await fs.readFile(new URL(`${pieceName}.svg`, pieceDir), 'utf8');
  const parsed = parseSvgForInline(raw);

  return `
<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${escapeXml(parsed.viewBox)}" preserveAspectRatio="xMidYMid meet">
  ${parsed.inner}
</svg>`;
}

let body = '';

const cell = 90;
const size = 70;
const padding = 10;

for (let i = 0; i < pieces.length; i += 1) {
  const col = i % 6;
  const row = Math.floor(i / 6);
  const x = col * cell;
  const y = row * cell;

  body += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${row === 0 ? '#f0d9b5' : '#b58863'}"/>`;
  body += await inlinePiece(pieces[i], x + padding, y + padding, size);
  body += `<text x="${x + cell / 2}" y="${y + cell - 6}" text-anchor="middle" font-size="12" font-family="Arial" fill="#222">${pieces[i]}</text>`;
}

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${cell * 6}" height="${cell * 2}" viewBox="0 0 ${cell * 6} ${cell * 2}">
  ${body}
</svg>`;

await sharp(Buffer.from(svg)).png().toFile('preview-chess-pieces.png');

console.log('saved: preview-chess-pieces.png');