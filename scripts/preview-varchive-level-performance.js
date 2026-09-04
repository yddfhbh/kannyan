import fs from 'node:fs/promises';
import path from 'node:path';

import { createVArchiveLevelPerformanceCard } from '../src/varchive-level-performance-card.js';

const [levelToken, buttonToken, nickname] = process.argv.slice(2);

if (!levelToken || !buttonToken || !nickname) {
  console.error('Usage: node scripts/preview-varchive-level-performance.js <difficultyLevel> <button> <nickname>');
  process.exit(1);
}

const match = String(levelToken).trim().match(/^(nm|hd|mx|sc)(\d+)$/i);
if (!match) {
  console.error('difficultyLevel must look like sc14, mx13, hd12, or nm10');
  process.exit(1);
}

const difficulty = match[1].toUpperCase();
const level = Number.parseInt(match[2], 10);
const button = Number.parseInt(String(buttonToken).trim(), 10);

const card = await createVArchiveLevelPerformanceCard(nickname, difficulty, level, button);
const outputPath = path.resolve(
  `preview-varchive-level-performance-${difficulty.toLowerCase()}${level}-${button}B-${String(nickname).replace(/[<>:"/\\|?*]+/g, '_')}.png`,
);

await fs.writeFile(outputPath, card.image);
console.log(outputPath);
