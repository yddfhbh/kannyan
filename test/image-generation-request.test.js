import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildImageGenerationPrompt,
  parseImageGenerationRequestContent,
  shouldClarifyImageGenerationPrompt,
} from '../src/image-generation-request.js';

test('parses simple percent draw commands without trailing polite suffix', () => {
  assert.deepEqual(
    parseImageGenerationRequestContent('%노을진 바다 그려'),
    { prompt: '노을진 바다' }
  );
});

test('parses existing polite image generation commands', () => {
  assert.deepEqual(
    parseImageGenerationRequestContent('%비 오는 부산의 네온 골목을 그려줘'),
    { prompt: '비 오는 부산의 네온 골목을' }
  );
});

test('ignores non-image percent commands', () => {
  assert.equal(
    parseImageGenerationRequestContent('%안녕'),
    null
  );
});

test('keeps empty prompt handling for bare draw commands', () => {
  assert.deepEqual(
    parseImageGenerationRequestContent('%그려'),
    { prompt: '' }
  );
});

test('parses loose trailing draw requests with dangling punctuation', () => {
  assert.deepEqual(
    parseImageGenerationRequestContent('%탁 그려주-'),
    { prompt: '탁' }
  );
});

test('asks for clarification only when the prompt is too vague without context', () => {
  assert.equal(
    shouldClarifyImageGenerationPrompt('그거', {
      replyContext: '',
      history: [],
    }),
    true
  );

  assert.equal(
    shouldClarifyImageGenerationPrompt('그거', {
      replyContext: '바나나 들고 있는 고양이',
      history: [],
    }),
    false
  );
});

test('builds an image prompt that carries reply context and recent conversation', () => {
  const prompt = buildImageGenerationPrompt('그거 그려줘', {
    replyContext: '바나나 우유를 마시는 작은 흰 고양이',
    history: [
      { authorName: 'user', text: '방금 고양이 얘기하던 거 기억하지?' },
      { authorName: 'bot', text: '응, 작은 흰 고양이 이야기였다냥.' },
    ],
  });

  assert.match(prompt, /Latest request: 그거 그려줘/);
  assert.match(prompt, /Reply context: 바나나 우유를 마시는 작은 흰 고양이/);
  assert.match(prompt, /Recent conversation:/);
  assert.match(prompt, /do not replace it with an unrelated landscape or street scene/i);
});
