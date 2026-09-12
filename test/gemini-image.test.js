import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bufferToGeminiImagePart,
  detectGeminiImageMimeType,
  inferGeminiImageMimeType,
  isGeminiSupportedImageAttachment,
} from '../src/gemini-image.js';
import { createGeminiChatContents } from '../src/gemini-memory.js';
import { shouldUseReplyImagesForGeminiPrompt } from '../src/gemini-image-routing.js';

test('accepts Discord images when contentType is missing but the filename identifies the MIME type', () => {
  const attachment = { name: 'tetrio-stats.PNG', url: 'https://cdn.test/stats' };

  assert.equal(isGeminiSupportedImageAttachment(attachment), true);
  assert.equal(inferGeminiImageMimeType(attachment), 'image/png');
});

test('prefers the actual response MIME type over a stale Discord contentType', () => {
  const attachment = {
    name: 'stats.bin',
    contentType: 'application/octet-stream',
    url: 'https://cdn.test/stats',
  };

  assert.equal(inferGeminiImageMimeType(attachment, 'image/jpeg; charset=binary'), 'image/jpeg');
  assert.equal(detectGeminiImageMimeType(Buffer.from([255, 216, 255, 0])), 'image/jpeg');
});

test('builds Gemini inline_data with the original bytes encoded as Base64', () => {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const part = bufferToGeminiImagePart(bytes, 'image/png');

  assert.deepEqual(part, {
    inline_data: {
      mime_type: 'image/png',
      data: bytes.toString('base64'),
    },
  });
});

test('keeps text history and image parts in the same current user content', () => {
  const part = bufferToGeminiImagePart(Buffer.from([255, 216, 255]), 'image/jpeg');
  const contents = createGeminiChatContents(
    '[최근 대화 기록]\n[화자=사용자] 통계표를 읽어줘\n[현재 질문]\n수치를 정확히 옮겨줘',
    [part]
  );

  assert.equal(contents.length, 1);
  assert.equal(contents[0].role, 'user');
  assert.match(contents[0].parts[0].text, /최근 대화 기록/);
  assert.deepEqual(contents[0].parts[1], part);
});

test('routes short statistical follow-ups to images attached to the replied message', () => {
  assert.equal(shouldUseReplyImagesForGeminiPrompt('이거 수치 읽어줘'), true);
  assert.equal(shouldUseReplyImagesForGeminiPrompt('테트리오 경기 통계 정리해줘'), true);
});
