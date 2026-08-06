import test from 'node:test';
import assert from 'node:assert/strict';
import { extractHttpUrls, extractReadablePageText, fetchWebPageText, isTrustedSourceUrl } from '../src/web-page-content.js';
import { normalizeKannyangSpeech } from '../src/kannyang-speech.js';

test('extractHttpUrls finds unique HTTP URLs', () => {
  assert.equal(extractHttpUrls('봐줘 https://example.com/a https://example.com/a https://example.org').length, 2);
});

test('extractReadablePageText removes navigation and scripts', () => {
  const page = extractReadablePageText('<title>문서</title><nav>메뉴</nav><main><h1>제목</h1><p>중요한 본문</p><script>나쁜 코드</script></main><footer>푸터</footer>');
  assert.equal(page.title, '문서');
  assert.match(page.text, /제목 중요한 본문/);
  assert.doesNotMatch(page.text, /메뉴|나쁜 코드|푸터/);
});

test('fetchWebPageText blocks private destinations', async () => {
  await assert.rejects(
    fetchWebPageText('http://example.test/', { resolveHostnames: async () => ['127.0.0.1'] }),
    /private network/
  );
});

test('no domains are treated as trusted sources by default', () => {
  assert.equal(isTrustedSourceUrl('https://pyhok.com/profile'), false);
  assert.equal(isTrustedSourceUrl('https://www.pyhok.com/profile'), false);
  assert.equal(isTrustedSourceUrl('https://example.com/article'), false);
});

test('normalizeKannyangSpeech avoids unnatural polite-ending plus 냥 forms', () => {
  assert.equal(normalizeKannyangSpeech('파이호크 서버의 주요 멤버 중 한 분이군요냥!'), '파이호크 서버의 주요 멤버 중 한 분이네냥!');
  assert.equal(normalizeKannyangSpeech('그렇네요냥.'), '그렇네냥.');
  assert.equal(normalizeKannyangSpeech('맞습니다냥.'), '맞다냥.');
  assert.equal(
    normalizeKannyangSpeech('이 이모지는 뭔가 불만이 있거나 삐진 듯한 표정을 짓고 있군요냥.'),
    '이 이모지는 뭔가 불만이 있거나 삐진 듯한 표정을 짓고 있네냥.'
  );
  assert.equal(
    normalizeKannyangSpeech('이 이모지는 화나 보이구나냥.'),
    '이 이모지는 화나 보여냥.'
  );
});
