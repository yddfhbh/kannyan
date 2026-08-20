import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';

import {
  buildCouncilStatusMarker,
  buildCouncilStatusMessageContent,
  createCouncilStatusBoard,
  defaultCouncilStatusChannelId,
  isCouncilStatusChannelMessage,
  normalizeCouncilAgentKey,
} from '../src/council-status-board.js';

test('Council status channel uses the configured AI Council 8A channel', () => {
  assert.equal(defaultCouncilStatusChannelId, '1539799743398420521');
  assert.equal(
    isCouncilStatusChannelMessage({ channelId: '1539799743398420521' }),
    true
  );
  assert.equal(
    isCouncilStatusChannelMessage({ channelId: '123' }),
    false
  );
});

test('Council agent identity recognizes kanna, isharong, and gangji', () => {
  assert.equal(normalizeCouncilAgentKey('Kanna Bot'), 'kanna');
  assert.equal(normalizeCouncilAgentKey('이샤롱'), 'isharong');
  assert.equal(normalizeCouncilAgentKey('gangji-agent'), 'gangji');
  assert.equal(normalizeCouncilAgentKey('unknown'), '');
});

test('Council status content includes required public fields without secrets', () => {
  const content = buildCouncilStatusMessageContent({
    agentKey: 'kanna',
    displayName: 'Kanna token=do-not-expose',
    online: true,
    model: 'council-model api_key=do-not-expose',
    role: 'Council 조정 및 최종 응답 secret=do-not-expose',
    lastAiOutcome: 'success',
    lastResponseAt: new Date('2026-08-20T01:23:45.000Z'),
    latencyMs: 123.6,
  });

  assert.match(content, /Discord 표시 이름: Kanna \[redacted\]/u);
  assert.match(content, /상태: Online/u);
  assert.match(content, /모델: council-model \[redacted\]/u);
  assert.match(content, /역할: Council 조정 및 최종 응답 \[redacted\]/u);
  assert.match(content, /마지막 AI 결과: 성공/u);
  assert.match(content, /마지막 응답 시각:/u);
  assert.match(content, /Latency: 124ms/u);
  assert.doesNotMatch(content, /do-not-expose/u);
});

test('Council status board reuses and edits its existing fixed message', async () => {
  const edits = [];
  const existingMessage = {
    id: 'existing-status-message',
    author: { id: 'bot-user' },
    content: buildCouncilStatusMarker('kanna'),
    async edit(payload) {
      edits.push(payload);
      return this;
    },
  };
  const messages = new Collection([[existingMessage.id, existingMessage]]);
  let sendCount = 0;
  const channel = {
    guild: { members: { me: { displayName: 'Kanna' } } },
    isTextBased: () => true,
    messages: {
      async fetch() {
        return messages;
      },
    },
    async send() {
      sendCount += 1;
      throw new Error('A duplicate status message must not be created.');
    },
  };
  existingMessage.channel = channel;
  const client = {
    isReady: () => true,
    user: { id: 'bot-user', username: 'kanna' },
    ws: { ping: 42 },
    channels: {
      async fetch(channelId) {
        assert.equal(channelId, defaultCouncilStatusChannelId);
        return channel;
      },
    },
  };
  const board = createCouncilStatusBoard({
    client,
    agentKey: 'kanna',
    agentModel: 'council-model',
  });

  assert.equal(await board.start(), true);
  assert.equal(sendCount, 0);
  assert.equal(edits.length, 1);
  assert.match(edits[0].content, /상태: Online/u);
  assert.match(edits[0].content, /모델: council-model/u);

  await board.recordAiResult({
    ok: true,
    at: new Date('2026-08-20T01:23:45.000Z'),
    latencyMs: 87,
  });
  assert.equal(edits.length, 2);
  assert.match(edits[1].content, /마지막 AI 결과: 성공/u);
  assert.match(edits[1].content, /마지막 응답 시각:/u);
  assert.match(edits[1].content, /Latency: 87ms/u);

  await board.stop();
  assert.equal(edits.length, 3);
  assert.match(edits[2].content, /상태: Offline/u);
});
