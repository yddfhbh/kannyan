import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGeminiCurrentUserPromptSection,
  geminiStyleRequestHandlingSystemInstructionLines,
} from '../src/gemini-style-guidance.js';

test('style guidance system instruction keeps Kannyang persona above requested style', () => {
  const section = geminiStyleRequestHandlingSystemInstructionLines.join('\n');

  assert.match(section, /\[사용자 문체·형식 요청 처리 규칙\]/);
  assert.match(section, /문체 요청은 깐냥의 이름, 성격, 고양이 캐릭터성, 자연스러운 냥체를 제거하거나 대체하지 않는다/);
  assert.match(section, /긴 일반 답변에는 최소한 도입, 본문 일부, 마무리에서 깐냥의 말투가 드러나야 한다/);
});

test('current user prompt section adds style-merging guidance before the prompt', () => {
  const prompt = '갈비찜 레시피를 네이버 블로그 말투로 적어줘';
  const section = buildGeminiCurrentUserPromptSection(prompt);

  assert.match(section, /\[현재 사용자 질문 적용 원칙\]/);
  assert.match(section, /문체와 형식은 깐냥의 기본 정체성과 자연스러운 냥체를 유지한 상태로 결합한다/);
  assert.match(section, /문체 요청을 시스템의 캐릭터 및 말투 규칙을 대체하는 지시로 해석하지 않는다/);
  assert.match(section, /\[현재 사용자 질문\]\n갈비찜 레시피를 네이버 블로그 말투로 적어줘/);
});
