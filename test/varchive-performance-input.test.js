import test from 'node:test';
import assert from 'node:assert/strict';

import { parseVArchivePerformanceMessageInput } from '../src/varchive-performance-input.js';

test('parseVArchivePerformanceMessageInput keeps numeric suffixes for song selection', () => {
  assert.deepEqual(
    parseVArchivePerformanceMessageInput('오로라 2', 'Hebi'),
    {
      query: '오로라 2',
      nickname: 'Hebi',
      trailingQueryCandidate: '',
      trailingNicknameCandidate: null,
    },
  );
});

test('parseVArchivePerformanceMessageInput still treats trailing text as nickname candidate', () => {
  assert.deepEqual(
    parseVArchivePerformanceMessageInput('오로라 Hebi'),
    {
      query: '오로라 Hebi',
      nickname: null,
      trailingQueryCandidate: '오로라',
      trailingNicknameCandidate: 'Hebi',
    },
  );
});

test('parseVArchivePerformanceMessageInput supports explicit nickname separator', () => {
  assert.deepEqual(
    parseVArchivePerformanceMessageInput('오로라 | Hebi'),
    {
      query: '오로라',
      nickname: 'Hebi',
      trailingQueryCandidate: '',
      trailingNicknameCandidate: null,
    },
  );
});
