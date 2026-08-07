import test from 'node:test';
import assert from 'node:assert/strict';

import { parseImageGenerationRequestContent } from '../src/image-generation-request.js';

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
