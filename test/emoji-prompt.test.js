import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectEmojiOnlyTextDetails,
  extractDiscordCustomEmojiNames,
  extractFirstUnicodeEmoji,
  formatEmojiOnlyTextDetails,
} from '../src/emoji-prompt.js';

test('extractDiscordCustomEmojiNames reads custom emoji names from discord syntax', () => {
  assert.deepEqual(
    extractDiscordCustomEmojiNames('<:kani:123456789012345678> <a:happy_wave:123456789012345679>'),
    ['kani', 'happy_wave']
  );
});

test('extractFirstUnicodeEmoji skips discord custom emoji syntax and finds unicode emoji', () => {
  assert.equal(
    extractFirstUnicodeEmoji('<:kani:123456789012345678> https://example.com/test 😭'),
    '😭'
  );
});

test('collectEmojiOnlyTextDetails gathers custom emoji names for emoji-only text', () => {
  assert.deepEqual(
    collectEmojiOnlyTextDetails(['<:kani:123456789012345678>\n<a:happy_wave:123456789012345679>']),
    {
      matchedTextCount: 1,
      customEmojiNames: ['kani', 'happy_wave'],
      unicodeEmojis: [],
    }
  );
});

test('collectEmojiOnlyTextDetails ignores text that is not emoji-only', () => {
  assert.deepEqual(
    collectEmojiOnlyTextDetails(['hello <:kani:123456789012345678>']),
    {
      matchedTextCount: 0,
      customEmojiNames: [],
      unicodeEmojis: [],
    }
  );
});

test('formatEmojiOnlyTextDetails formats both custom and unicode emoji details', () => {
  assert.equal(
    formatEmojiOnlyTextDetails({
      customEmojiNames: ['kani'],
      unicodeEmojis: ['😊', '😭'],
    }),
    '커스텀 이모지 이름은 "kani"이다. 일반 이모지들은 😊, 😭 이다.'
  );
});
