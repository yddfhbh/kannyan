import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildImageGenerationPrompt,
  inferImageGenerationPromptFromContext,
  parseImageGenerationRequestContent,
  shouldClarifyImageGenerationPrompt,
} from '../src/image-generation-request.js';

test('parses simple percent draw commands', () => {
  assert.deepEqual(
    parseImageGenerationRequestContent('%고양이 우주비행사를 그려줘'),
    { prompt: '고양이 우주비행사를' }
  );
});

test('parses bare draw commands as empty prompts', () => {
  assert.deepEqual(
    parseImageGenerationRequestContent('%그려줘'),
    { prompt: '' }
  );
});

test('ignores non-image percent commands', () => {
  assert.equal(
    parseImageGenerationRequestContent('%안녕'),
    null
  );
});

test('asks for clarification only when the prompt is vague and no context exists', () => {
  assert.equal(
    shouldClarifyImageGenerationPrompt('그거', {
      replyContext: '',
      history: [],
    }),
    true
  );

  assert.equal(
    shouldClarifyImageGenerationPrompt('그거', {
      replyContext: '바나나 우유를 마시는 고양이',
      history: [],
    }),
    false
  );

  assert.equal(
    shouldClarifyImageGenerationPrompt('', {
      replyContext: '',
      history: [{ text: '유명한 정치인 5명' }],
    }),
    false
  );
});

test('infers image prompts from recent user history when the latest command is just draw it', () => {
  const inferred = inferImageGenerationPromptFromContext('', {
    replyContext: '',
    history: [
      { role: 'user', authorName: '탁', text: '유명한 5명 ㅋㅋ' },
      { role: 'model', authorName: '깐냥', text: '어떤 스타일로 그릴지 알려달라냥.' },
      { role: 'user', authorName: '탁', text: '그냥 바로 그려 물어보지말고' },
    ],
  });

  assert.equal(inferred, '유명한 5명 ㅋㅋ');
});

test('prefers explicit reply context over history when inferring a prompt', () => {
  const inferred = inferImageGenerationPromptFromContext('그려줘', {
    replyContext: '네온 간판 아래에서 우산을 든 검은 고양이',
    history: [
      { role: 'user', authorName: '탁', text: '유명한 5명' },
    ],
  });

  assert.equal(inferred, '네온 간판 아래에서 우산을 든 검은 고양이');
});

test('builds an image prompt that carries reply context and recent conversation', () => {
  const prompt = buildImageGenerationPrompt('그거 그려줘', {
    replyContext: '바나나 우유를 마시는 작은 고양이',
    history: [
      { authorName: 'user', text: '방금 그 고양이 이야기 기억하지?' },
      { authorName: 'bot', text: '응, 작은 고양이 이야기였다냥.' },
    ],
  });

  assert.match(prompt, /Latest request: 그거 그려줘/);
  assert.match(prompt, /Reply context: 바나나 우유를 마시는 작은 고양이/);
  assert.match(prompt, /Recent conversation:/);
  assert.match(prompt, /do not replace it with an unrelated landscape or street scene/i);
});
