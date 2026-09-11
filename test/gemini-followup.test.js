import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { isLikelyContextDependentPrompt } from '../src/gemini-followup.js';
import {
  createGeminiChatContents,
  createGeminiSessionKey,
  GeminiMemoryStore,
} from '../src/gemini-memory.js';

test('treats very short follow-up fragments as context dependent', () => {
  assert.equal(isLikelyContextDependentPrompt('야'), true);
  assert.equal(isLikelyContextDependentPrompt('동'), true);
  assert.equal(isLikelyContextDependentPrompt('왜?'), true);
  assert.equal(isLikelyContextDependentPrompt('그럼'), true);
});

test('keeps ordinary longer prompts out of follow-up heuristic', () => {
  assert.equal(isLikelyContextDependentPrompt('오늘 서울 날씨 알려줘'), false);
  assert.equal(isLikelyContextDependentPrompt('고양이 그림 그려줘'), false);
});

test('persists a conversation and makes the previous turn available to a follow-up', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-memory-'));
  const filePath = path.join(tempDir, 'memory.json');
  const message = { guildId: 'guild-1', channelId: 'channel-1', author: { id: 'user-1' } };
  const sessionKey = createGeminiSessionKey(message);

  try {
    const firstStore = new GeminiMemoryStore(filePath);
    await firstStore.ensureLoaded();
    firstStore.append(sessionKey, { role: 'user', text: '내 고양이 이름은 나비야', authorName: 'user' });
    firstStore.append(sessionKey, { role: 'model', text: '나비구나! 기억할게.', authorName: 'bot' });
    await firstStore.save();

    const nextStore = new GeminiMemoryStore(filePath);
    await nextStore.ensureLoaded();
    const history = nextStore.getHistory(sessionKey);
    assert.equal(history.length, 2);
    assert.match(history[0].text, /고양이 이름은 나비/);

    const contextualPrompt = `[최근 대화 기록]\n${history.map((entry) => entry.text).join('\n')}\n\n[현재 질문]\n그럼 이름이 뭐야?`;
    const contents = createGeminiChatContents(contextualPrompt);
    assert.match(contents[0].parts[0].text, /나비/);
    assert.match(contents[0].parts[0].text, /그럼 이름이 뭐야/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('does not mix guild channels, threads, or DM users', () => {
  const guildChannel = createGeminiSessionKey({ guildId: 'g1', channelId: 'c1' });
  const otherChannel = createGeminiSessionKey({ guildId: 'g1', channelId: 'c2' });
  const thread = createGeminiSessionKey({ guildId: 'g1', channelId: 't1', threadId: 't1' });
  const dmA = createGeminiSessionKey({ channelId: 'dm1', author: { id: 'u1' } });
  const dmB = createGeminiSessionKey({ channelId: 'dm1', author: { id: 'u2' } });

  assert.notEqual(guildChannel, otherChannel);
  assert.notEqual(guildChannel, thread);
  assert.notEqual(dmA, dmB);
});

test('can read the previous guild-channel key format after the session key upgrade', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-memory-'));
  const filePath = path.join(tempDir, 'memory.json');

  try {
    await fs.writeFile(filePath, JSON.stringify({
      version: 1,
      sessions: {
        'g1:c1': [{ role: 'user', text: '이전 기록', timestamp: Date.now() }],
      },
    }));
    const store = new GeminiMemoryStore(filePath);
    await store.ensureLoaded();
    assert.equal(
      store.getHistory(createGeminiSessionKey({ guildId: 'g1', channelId: 'c1' }))[0].text,
      '이전 기록'
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('preserves entries appended before an initial load finishes', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-memory-'));
  const filePath = path.join(tempDir, 'memory.json');
  const sessionKey = createGeminiSessionKey({ guildId: 'g1', channelId: 'c1' });

  try {
    await fs.writeFile(filePath, JSON.stringify({
      version: 1,
      sessions: {
        [sessionKey]: [{ role: 'user', text: '디스크 기록', timestamp: Date.now() }],
      },
    }));

    const store = new GeminiMemoryStore(filePath);
    store.append(sessionKey, { role: 'model', text: '로드 중 추가된 기록' });
    await store.save();

    const persisted = JSON.parse(await fs.readFile(filePath, 'utf8'));
    assert.deepEqual(
      persisted.sessions[sessionKey].map((entry) => entry.text),
      ['디스크 기록', '로드 중 추가된 기록']
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
