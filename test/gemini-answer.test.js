import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  getGeminiEmotionAssetPath,
  normalizeGeminiEmotionLabel,
  parseGeminiAnswerPayload,
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
  assert.equal(path.basename(getGeminiEmotionAssetPath('very_happy')), 'very-happy.png');
  assert.equal(path.basename(getGeminiEmotionAssetPath('happy')), 'happy.png');
  assert.equal(getGeminiEmotionAssetPath('neutral'), null);
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

test('parseGeminiAnswerPayload falls back to the raw text and neutral emotion when json is missing', () => {
  assert.deepEqual(
    parseGeminiAnswerPayload('그냥 일반 문자열 답변이다냥.'),
    {
      answer: '그냥 일반 문자열 답변이다냥.',
      emotion: 'neutral',
    }
  );
});
