import fs from 'node:fs/promises';
import path from 'node:path';
import { createVArchiveGradeCard } from '../src/varchive-grade-card.js';

const floorName = String(process.argv[2] ?? '').trim();
const button = String(process.argv[3] ?? '').trim();

if (!floorName || !button) {
  console.error('Usage: node scripts/preview-varchive-grade.js <floorName> <button>');
  process.exit(1);
}

const card = await createVArchiveGradeCard(floorName, button);
const extension = card.imageFormat === 'jpeg' ? 'jpg' : 'png';
const outputPath = path.resolve(`preview-varchive-grade-${card.button}b-${card.floorName}.${extension}`);

await fs.writeFile(outputPath, card.image);

console.log(`Saved ${card.entryCount} patterns to ${outputPath}`);
