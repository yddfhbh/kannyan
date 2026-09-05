import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  getGeminiEmotionAssetPath,
  normalizeGeminiEmotionLabel,
  parseGeminiAnswerPayload,
  shouldAttachGeminiEmotionAsset,
  supportedGeminiEmotionLabels,
} from '../src/gemini-answer.js';

test('supportedGeminiEmotionLabels exposes the allowed output labels', () => {
  assert.deepEqual(
    supportedGeminiEmotionLabels,
    ['curious', 'excited', 'bored', 'very_happy', 'happy', 'sad', 'angry', 'embarrassed', 'surprised', 'confused', 'sleepy', 'neutral']
  );
});

test('normalizeGeminiEmotionLabel maps common aliases into the supported labels', () => {
  assert.equal(normalizeGeminiEmotionLabel('wondering'), 'curious');
  assert.equal(normalizeGeminiEmotionLabel('hyped'), 'excited');
  assert.equal(normalizeGeminiEmotionLabel('grumpy'), 'bored');
  assert.equal(normalizeGeminiEmotionLabel('ecstatic'), 'very_happy');
  assert.equal(normalizeGeminiEmotionLabel('joyful'), 'happy');
  assert.equal(normalizeGeminiEmotionLabel('frustrated'), 'angry');
  assert.equal(normalizeGeminiEmotionLabel('shy'), 'embarrassed');
  assert.equal(normalizeGeminiEmotionLabel('startled'), 'surprised');
  assert.equal(normalizeGeminiEmotionLabel('drowsy'), 'sleepy');
  assert.equal(normalizeGeminiEmotionLabel('something-unknown'), 'neutral');
});

test('getGeminiEmotionAssetPath returns the configured local emotion images', () => {
  assert.equal(path.basename(getGeminiEmotionAssetPath('curious')), 'curious.png');
  assert.equal(path.basename(getGeminiEmotionAssetPath('excited')), 'excited.png');
  assert.equal(path.basename(getGeminiEmotionAssetPath('angry')), 'bored.png');
  assert.equal(path.basename(getGeminiEmotionAssetPath('confused')), 'bored.png');
  assert.equal(path.basename(getGeminiEmotionAssetPath('surprised')), 'bored.png');
  assert.equal(path.basename(getGeminiEmotionAssetPath('very_happy')), 'very-happy.png');
  assert.equal(path.basename(getGeminiEmotionAssetPath('happy')), 'happy.png');
  assert.equal(getGeminiEmotionAssetPath('neutral'), null);
});

test('shouldAttachGeminiEmotionAsset suppresses happy for plain questions and web search replies', () => {
  assert.equal(
    shouldAttachGeminiEmotionAsset('happy', {
      prompt: '파이썬 리스트 정렬 어떻게 해?',
      source: 'chat',
    }),
    false
  );

  assert.equal(
    shouldAttachGeminiEmotionAsset('happy', {
      prompt: '최신 환율 알려줘',
      source: 'web-search',
    }),
    false
  );
});

test('shouldAttachGeminiEmotionAsset still allows happy for clearly celebratory prompts', () => {
  assert.equal(
    shouldAttachGeminiEmotionAsset('happy', {
      prompt: '오늘 합격했어 ㅋㅋ 축하해줘!',
      source: 'chat',
    }),
    true
  );

  assert.equal(
    shouldAttachGeminiEmotionAsset('curious', {
      prompt: '파이썬 리스트 정렬 어떻게 해?',
      source: 'chat',
    }),
    true
  );
});

test('parseGeminiAnswerPayload reads answer and emotion from gemini json output', () => {
  assert.deepEqual(
    parseGeminiAnswerPayload('{"answer":"오늘 정말 행복하다냥!","emotion":"happy"}'),
    {
      answer: '오늘 정말 행복하다냥!',
      emotion: 'happy',
    }
  );
});

test('parseGeminiAnswerPayload tolerates fenced json and normalizes emotion aliases', () => {
  assert.deepEqual(
    parseGeminiAnswerPayload('```json\n{"answer":"조금 신나 보인다냥!","emotion":"hyped"}\n```'),
    {
      answer: '조금 신나 보인다냥!',
      emotion: 'excited',
    }
  );
});

test('parseGeminiAnswerPayload preserves valid newline escapes', () => {
  assert.deepEqual(
    parseGeminiAnswerPayload('{"answer":"첫 줄\\n둘째 줄","emotion":"neutral"}'),
    {
      answer: '첫 줄\n둘째 줄',
      emotion: 'neutral',
    }
  );
});

test('parseGeminiAnswerPayload repairs single-backslash LaTeX commands', () => {
  const rawJson = String.raw`{"answer":"$\sum x \ge y \frac{1}{2} \boxed{x}$","emotion":"happy"}`;

  assert.deepEqual(parseGeminiAnswerPayload(rawJson), {
    answer: String.raw`$\sum x \ge y \frac{1}{2} \boxed{x}$`,
    emotion: 'happy',
  });
});

test('parseGeminiAnswerPayload does not expose an unparseable answer wrapper', () => {
  const malformedWrapper = '```json\n{"answer":"답변","emotion":"neutral",}\n```';

  const result = parseGeminiAnswerPayload(malformedWrapper);

  assert.equal(result.answer, '답변을 읽지 못했다냥.');
  assert.equal(result.emotion, 'neutral');
  assert.equal(result.answer.includes('"answer"'), false);
});

test('parseGeminiAnswerPayload falls back to the raw text and neutral emotion when json is missing', () => {
  assert.deepEqual(
    parseGeminiAnswerPayload('그냥 일반 문자열 답변이다냥.'),
    {
      answer: '그냥 일반 문자열 답변이다냥.',
      emotion: 'neutral',
    }
  );
});
