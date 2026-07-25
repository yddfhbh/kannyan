import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTetrioAchievementAveragePreviewCard } from '../src/tetrio-achievement-average.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const achievement = {
  art: 1,
  deci: 0,
  desc: 'Greater than the sum of its parts?',
  k: 1,
  n: 'stacker',
  name: 'Stacker',
  object: 'pieces placed',
  rt: 1,
  vt: 1,
};

const ranks = {
  'x+': { averageValue: 687073, completionRate: 1, sampledCount: 84, solvedCount: 84 },
  x: { averageValue: 498539, completionRate: 1, sampledCount: 122, solvedCount: 122 },
  u: { averageValue: 336323, completionRate: 1, sampledCount: 163, solvedCount: 163 },
  ss: { averageValue: 228698, completionRate: 0.6529, sampledCount: 700, solvedCount: 457 },
  's+': { averageValue: 164136, completionRate: 0.6286, sampledCount: 700, solvedCount: 440 },
  s: { averageValue: 130490, completionRate: 0.6029, sampledCount: 700, solvedCount: 422 },
  's-': { averageValue: 106587, completionRate: 0.5857, sampledCount: 700, solvedCount: 410 },
  'a+': { averageValue: 93830, completionRate: 0.5529, sampledCount: 700, solvedCount: 387 },
  a: { averageValue: 75831, completionRate: 0.5957, sampledCount: 700, solvedCount: 417 },
  'a-': { averageValue: 68796, completionRate: 0.5714, sampledCount: 700, solvedCount: 400 },
  'b+': { averageValue: 59212, completionRate: 0.5786, sampledCount: 700, solvedCount: 405 },
  b: { averageValue: 48145, completionRate: 0.5157, sampledCount: 700, solvedCount: 361 },
  'b-': { averageValue: 42540, completionRate: 0.5314, sampledCount: 700, solvedCount: 372 },
  'c+': { averageValue: 36931, completionRate: 0.5357, sampledCount: 700, solvedCount: 375 },
  c: { averageValue: 32231, completionRate: 0.5429, sampledCount: 700, solvedCount: 380 },
  'c-': { averageValue: 25613, completionRate: 0.51, sampledCount: 700, solvedCount: 357 },
  'd+': { averageValue: 24205, completionRate: 0.4914, sampledCount: 700, solvedCount: 344 },
  d: { averageValue: 20241, completionRate: 0.5341, sampledCount: 700, solvedCount: 374 },
};

const snapshot = {
  achievements: {
    '1': {
      ...achievement,
      ranks,
    },
  },
  createdAt: '2026-07-16T15:00:00.000Z',
  dateKey: '2026-07-16',
  failedUsers: 9,
  processedUsers: 11284,
  sampleSize: 700,
  sampledUsers: 11869,
  source: 'preview',
  userPoolCount: 36005,
};

const card = await createTetrioAchievementAveragePreviewCard({
  achievement,
  snapshot,
});

const pngPath = path.resolve(repoRoot, 'preview-tetrio-achievement-average-stacker.png');
const svgPath = path.resolve(repoRoot, 'preview-tetrio-achievement-average-stacker.svg');

await Promise.all([
  fs.writeFile(pngPath, card.image),
  fs.writeFile(svgPath, card.svg, 'utf8'),
]);

console.log(JSON.stringify({
  achievementName: card.achievementName,
  pngPath,
  snapshotDateKey: card.snapshotDateKey,
  svgPath,
}, null, 2));
