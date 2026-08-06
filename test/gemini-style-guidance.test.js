import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGeminiCurrentUserPromptSection,
  geminiStyleRequestHandlingSystemInstructionLines,
} from '../src/gemini-style-guidance.js';

test('style guidance keeps Kannyang persona while adding Discord formatting rules', () => {
  const section = geminiStyleRequestHandlingSystemInstructionLines.join('\n');

  assert.match(section, /\[사용자 문체·형식 요청 처리 규칙\]/);
  assert.match(section, /깐냥의 이름, 성격, 고양이 캐릭터성/);
  assert.match(section, /일반 답변에는 최소한 도입, 본문, 마무리 중 한 곳 이상/);
  assert.match(section, /\[디스코드 마크다운 규칙\]/);
  assert.match(section, /목록과 번호 항목은 항상 새 줄에서 시작/);
  assert.match(section, /소개 문장과 첫 목록 항목을 반드시 줄바꿈으로 분리/);
});

test('current user prompt section reinforces list-friendly Discord formatting for summaries', () => {
  const prompt = '파이호크 생애를 시기별로 정리해줘';
  const section = buildGeminiCurrentUserPromptSection(prompt);

  assert.match(section, /\[현재 사용자 질문 적용 지침\]/);
  assert.match(section, /깐냥의 기본 정체성과 자연스러운 냥체를 유지한 상태로 결합/);
  assert.match(section, /정리, 비교, 요약을 원하면 디스코드에서 읽기 쉽게 줄바꿈과 목록을 적극 활용/);
  assert.match(section, /환율, 주가, 코인 가격처럼 시점이 중요한 가격 정보는 사용자가 날짜를 따로 지정하지 않았다면 최신 기준으로 해석/);
  assert.match(section, /기준 시점이나 검색 시점을 함께 밝혀 혼동을 줄인다/);
  assert.match(section, /\[현재 사용자 질문\]\n파이호크 생애를 시기별로 정리해줘/);
});
