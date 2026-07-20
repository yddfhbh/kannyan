import fs from 'node:fs/promises';
import path from 'node:path';
import { searchVArchiveSong } from '../src/varchive-song.js';
import { createVArchivePerformanceCard } from '../src/varchive-performance-card.js';

const nickname = process.argv[2]?.trim() || 'kannyan0713';
const query = process.argv.slice(3).join(' ').trim() || 'pppp';
const result = await searchVArchiveSong(query);

if (result.status !== 'single') {
  throw new Error(`Expected a single match for "${query}", got ${result.status}.`);
}

const card = await createVArchivePerformanceCard(nickname, result.song);
const outputPath = path.resolve(`preview-varchive-performance-${nickname}-${String(card.songName ?? 'song').replace(/[<>:"/\\|?*]+/g, '_')}.png`);

await fs.writeFile(outputPath, card.image);

console.log(JSON.stringify({
  nickname,
  query,
  songName: card.songName,
  titleId: card.titleId,
  outputPath,
}, null, 2));
