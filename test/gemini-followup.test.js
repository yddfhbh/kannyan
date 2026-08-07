import test from 'node:test';
import assert from 'node:assert/strict';

import { isLikelyContextDependentPrompt } from '../src/gemini-followup.js';

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
