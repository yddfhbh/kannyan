import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRankCards, renderTetrioRankCutSvg } from '../src/tetrio-rankcut.js';
import { renderSvgToPng } from '../src/svg-renderer.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const previewDirectory = path.join(repoRoot, 'tmp', 'tetrio-rankcut-preview');
const svgPath = path.join(previewDirectory, 'tetrio-rankcut-preview.svg');
const pngPath = path.join(previewDirectory, 'tetrio-rankcut-preview.png');
const fontPath = path.join(repoRoot, 'assets', 'fonts', 'hun2.ttf');

const sampleRanks = [
  ['x+', 72], ['x', 280], ['u', 1363], ['ss', 2051], ['s+', 2026], ['s', 2048], ['s-', 2378],
  ['a+', 2705], ['a', 2709], ['a-', 2708], ['b+', 2714], ['b', 2784], ['b-', 3200], ['c+', 3800],
  ['c', 4100], ['c-', 4300], ['d+', 3000], ['d', 1800],
].reduce((data, [rank, count], index) => {
  data[rank] = { tr: 24115 - index * 1020, count, apm: 30 - index * 0.7, pps: 2.5 - index * 0.04, vs: 1.2 - index * 0.01 };
  return data;
}, { total: 50000 });

await mkdir(previewDirectory, { recursive: true });
const cards = buildRankCards(sampleRanks);
const fontDataUri = `data:font/ttf;base64,${(await readFile(fontPath)).toString('base64')}`;
const svg = renderTetrioRankCutSvg(cards, {}, fontDataUri, new Date('2026-10-03T00:00:00Z'));
await writeFile(svgPath, svg);
const png = await renderSvgToPng(svg, { defaultFontFamily: 'HUN', fontFiles: [fontPath] });
await writeFile(pngPath, png);
console.log(pngPath);
