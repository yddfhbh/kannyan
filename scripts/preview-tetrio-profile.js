import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTetrioProfileCardSvg } from '../src/tetrio-card.js';
import { renderTetrioSvgToPng } from '../src/tetrio-font.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function run() {
  const username = String(process.argv[2] ?? 'saeki_miria').trim();

  if (!username) {
    throw new Error('Usage: node scripts/preview-tetrio-profile.js <username>');
  }

  const card = await createTetrioProfileCardSvg(username);
  const png = renderTetrioSvgToPng(card.svg, 2);
  const safeName = card.username.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const svgPath = path.resolve(repoRoot, `preview-tetrio-profile-${safeName}.svg`);
  const pngPath = path.resolve(repoRoot, `preview-tetrio-profile-${safeName}.png`);

  await Promise.all([
    fs.writeFile(svgPath, card.svg, 'utf8'),
    fs.writeFile(pngPath, png),
  ]);

  console.log(`saved svg: ${svgPath}`);
  console.log(`saved png: ${pngPath}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
