import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVArchiveSongCard } from '../src/varchive-song-card.js';
import { searchVArchiveSong } from '../src/varchive-song.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(__dirname, '../preview-varchive-song.png');
const query = process.argv.slice(2).join(' ').trim() || 'DIE IN';

const result = await searchVArchiveSong(query);
if (result.status !== 'single') {
  throw new Error(`Expected a single match for preview query "${query}", got ${result.status}.`);
}

const card = await createVArchiveSongCard(result.song);
await fs.writeFile(outputPath, card.image);

console.log(`saved: ${outputPath}`);
