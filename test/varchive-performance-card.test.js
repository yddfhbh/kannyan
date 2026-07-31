import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBoardPageEntry } from '../src/varchive-performance-card.js';

test('parseBoardPageEntry preserves maxcombo color markers from board HTML', () => {
  const html = `
    <div id="4-805-MX" class="bg-gray-100 dark:bg-zinc-700 relative rounded-sm overflow-hidden jarket-shadow">
      <div class="text-center text-base font-bold h-6 flex items-center justify-center bg-[color:var(--maxcombo)] text-white outline-text-3">99.85</div>
    </div>
  `;

  assert.deepEqual(
    parseBoardPageEntry(html, 4, '805', 'MX'),
    {
      scoreText: '99.85',
      scoreKind: 'maxcombo',
    },
  );
});

test('parseBoardPageEntry preserves clear color markers from board HTML', () => {
  const html = `
    <div id="4-198-HD" class="bg-gray-100 dark:bg-zinc-700 relative rounded-sm overflow-hidden jarket-shadow">
      <div class="text-center text-base font-bold h-6 flex items-center justify-center bg-[color:var(--clear)] text-black dark:text-black">98.42</div>
    </div>
  `;

  assert.deepEqual(
    parseBoardPageEntry(html, 4, '198', 'HD'),
    {
      scoreText: '98.42',
      scoreKind: 'clear',
    },
  );
});
