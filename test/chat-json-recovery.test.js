import assert from 'node:assert/strict';
import test from 'node:test';
import { generator } from './helpers/captured-chat-generator.js';

test('일반 채팅은 복구 불가 JSON을 한 번만 재시도하고 원문을 답변이나 메모리에 넘기지 않는다', async () => {
  const malformed = '{"answer":"사용자에게 보이면 안 되는 깨진 JSON","emotion":';
  const { generate, payloads } = generator([malformed, JSON.stringify({ answer: '복구된 답변이다냥.', emotion: 'neutral' })]);

  const result = await generate('테스트 질문');

  assert.equal(result.answer, '복구된 답변이다냥.');
  assert.equal(payloads.length, 2);
  assert.match(payloads[1].system_instruction.parts[0].text, /형식 복구/);
  assert.doesNotMatch(result.answer, /깨진 JSON/);
});

test('일반 채팅은 재시도 뒤에도 JSON이 깨지면 안전한 고정 문구만 반환한다', async () => {
  const malformed = '{"answer":"사용자 원문이 포함된 깨진 응답","emotion":';
  const { generate } = generator([malformed, malformed]);

  const result = await generate('테스트 질문');

  assert.equal(result.answer, '답변 형식을 복구하지 못했다냥. 잠시 뒤 다시 물어봐달라냥.');
  assert.doesNotMatch(result.answer, /사용자 원문/);
  assert.equal(result.usedPermanentMemoryIds.length, 0);
});
