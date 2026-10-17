import { formatChatDisplayAnswer } from '../src/chat-display.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { normalizeKannyangSpeech, transformKannyangProse } from '../src/kannyang-speech.js';
import { normalizeDiscordMarkdown } from '../src/discord-markdown.js';
import { parseGeminiAnswerPayload } from '../src/gemini-answer.js';
import { getChatClock } from '../src/chat-clock.js';
import { selectGeminiContextSections } from '../src/gemini-context.js';
import { chatSourcePlanGuidance } from '../src/chat-source-plan.js';
import { chatSourceGuidance } from '../src/chat-search-policy.js';
import { classifyPromptControlResponse } from '../src/gemini-prompt-guard.js';
import * as styleGuidance from '../src/gemini-style-guidance.js';
import { declaration, runtime, source } from '../scripts/lib/chat-verification-runtime.js';

const literals = [
  '```js\n  const text = "맞습니다냥. 알려줄게냥냥.";\n  // 있구나냥\n```',
  '~~~text\n있구나냥\n~~~',
  '`있구나냥`', '``입니다냥 ` 있구나냥``',
  'https://example.test/있구나냥?q=알려줄게냥냥',
  '[있구나냥](https://example.test/입니다냥)',
  '출처: 있구나냥 https://example.test/입니다냥',
  '**출처**: 맞습니다냥.',
  '[1] 맞습니다냥. https://example.test',
  '> 응냥, 맞습니다냥.',
  '“응냥, 있구나냥. 알려줄게냥냥.”',
  '‘입니다냥’', '"맞습니다냥"', "'있구나냥'",
];

test('speech cleanup preserves natural endings and does not require 냥 on every sentence', () => {
  const natural = '나는 깐냥이다냥. 여기에 있다냥. 알려줄게냥! 편하게 물어봐도 된다냥.\n짧은 제목\n편하게 물어봐.';
  assert.equal(normalizeKannyangSpeech(natural), natural);
  assert.equal(normalizeKannyangSpeech('맞습니다냥. 있구나냥. 알려줄게냥냥! 있다냥 냥.'),
    '맞다냥. 있네냥. 알려줄게냥! 있다냥.');
  assert.equal(normalizeKannyangSpeech(normalizeKannyangSpeech(natural)), natural);
});

test('speech cleanup protects code, URLs, citations and original quotes including unfinished fences', () => {
  for (const literal of [...literals, '```text\n응냥, 있구나냥', '>>> 있구나냥\n응냥, 맞습니다냥.']) {
    assert.equal(normalizeKannyangSpeech(literal), literal);
    assert.equal(normalizeKannyangSpeech(`맞습니다냥.\n${literal}`), `맞다냥.\n${literal}`);
  }
  const collision = '\u0000KANNYANG_0\u0000 `입니다냥` 맞습니다냥.';
  assert.equal(normalizeKannyangSpeech(collision), '\u0000KANNYANG_0\u0000 `입니다냥` 맞다냥.');
});

// Run the production handler, generator, system prompt, sanitizer and formatting.
// Only the model transport and Discord transport are replaced with fixed fixtures.
async function responsePath(rawAnswer) {
  const r = runtime();
  const payloads = [];
  Object.assign(r.context, styleGuidance, {
    normalizeKannyangSpeech, transformKannyangProse, normalizeDiscordMarkdown,
    parseGeminiAnswerPayload, getChatClock, selectGeminiContextSections,
    chatSourceGuidance, chatSourcePlanGuidance, classifyPromptControlResponse,
    Date, geminiMemoryMaxContextLength: 32000, geminiMaxOutputTokens: 4096,
    percentCommandAliases: { chat: ['대화'] }, customEmojis: {},
    geminiModels: ['primary', 'fallback'], geminiVisionModels: ['vision'],
    supportedGeminiEmotionLabels: ['neutral'], logGeminiTiming: () => {},
    createGeminiChatContents: (text) => [{ role: 'user', parts: [{ text }] }],
    fetchGeminiGenerateContent: async (payload, options) => {
      payloads.push({ payload, options, rawAnswer });
      return { text: JSON.stringify({ answer: rawAnswer, emotion: 'neutral', sourcePlan: {
        mode: 'local', query: '', purpose: '', externalPrompt: '', localPrompt: '', additionalExternalPrompt: '',
      } }) };
    },
    extractGeminiResponseText: (response) => response.text,
    extractPermanentMemoryUsage: (text) => ({ cleanText: text, usedIds: [] }),
    inferPermanentMemoryUsage: () => [],
  });
  vm.runInContext(source.slice(source.indexOf('const geminiSystemInstruction ='), source.indexOf('const defaultRatingDeviation =')), r.context);
  for (const name of ['sanitizeGeminiAnswer', 'stripLeakedAnalysisLines', 'isLeakedAnalysisLine',
    'extractQuotedFinalAnswer', 'applyCustomEmojiAliases', 'generateGeminiAnswer']) {
    vm.runInContext(declaration(name), r.context);
  }
  await r.context.handleGeminiFallbackMessage({ content: '%안녕', author: { id: 'test', username: 'test' },
    guildId: 'g', channelId: 'c', client: { user: { username: '깐냥' } }, attachments: new Map(), channel: { send: async () => {} } });
  assert.equal(payloads.length, 1, 'no additional style correction model call');
  assert.equal(r.sent.length, 1);
  assert.deepEqual(Array.from(payloads[0].options.models), ['primary', 'fallback']);
  return { final: r.sent[0], request: payloads[0] };
}

test('actual model-to-Discord path preserves natural speech, cleans malformed legacy endings and protects literals', async () => {
  const raw = ['나는 깐냥이다냥. 여기에 있다냥. 알려줄게냥!',
    '맞습니다냥. 있구나냥. 알려줄게냥냥!', ...literals].join('\n');
  const { final, request } = await responsePath(raw);
  assert.ok(final.startsWith('나는 깐냥이다냥. 여기에 있다냥. 알려줄게냥!\n맞다냥. 있네냥. 알려줄게냥!'));
  for (const literal of literals) {
    const displayed = formatChatDisplayAnswer(literal);
    if (!/https?:/.test(literal)) assert.ok(final.includes(displayed), literal);
  }
  assert.doesNotMatch(final,/https?:\/\//);
  // Display formatting runs after speech normalization and removes link markup.
  assert.ok(final.includes("있구나냥"));
  const system = request.payload.system_instruction.parts[0].text;
  for (const rule of ['깐냥', 'CODEX', '현대 한국어', '하오체', '~다오냥', '~하오냥', '문장 전체',
    '모든 문장에 무조건', '물어봐도 된다냥', '출처 표기와 직접 인용 원문']) assert.ok(system.includes(rule), rule);
});

test('reported archaic ending originates before cleanup; preferred model wording reaches Discord unchanged', async () => {
  const reported = '궁금한 점이 있으면 언제든 편하게 물어봐 다오냥.';
  assert.equal((await responsePath(reported)).final, reported);
  // This is a supplied model fixture, not a claim of live model compliance.
  const preferred = '궁금한 게 있으면 편하게 물어봐도 된다냥.';
  assert.equal((await responsePath(preferred)).final, preferred);
});
