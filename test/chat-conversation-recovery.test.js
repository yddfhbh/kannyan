import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from '../scripts/lib/chat-verification-runtime.js';
import { isClearlyLocalChatPrompt } from '../src/web-search.js';
import { chatSourcePlanGuidance, resolveChatSourcePlan } from '../src/chat-source-plan.js';
import { answerChatBySource, resolveChatEvidence } from '../src/chat-search-policy.js';
import { eligibleForGeneralSearch } from '../src/general-search-chat.js';

const message = (text) => ({ content: `%${text}`, author: { id: 'bob', username: 'bob' },
  guildId: 'g', channelId: 'c', client: { user: { username: '깐냥' } },
  attachments: new Map(), channel: { send: async () => {} } });

const dialogue = [
  ['짧은 화제', '도자기'], ['짧은 화제 변형', '도자기 얘기'],
  ['긴 화제', '옛날에 읽었던 해양 탐험 이야기가 생각났어'],
  ['긴 화제 변형', '어릴 때 보던 천문학 책 얘기를 해보자'],
  ['불완전한 문장', '그 영화 말인데'], ['불완전한 문장 변형', '지난번에 봤던 그 그림'],
  ['이름 회상', '그 배우 이름이 생각 안 나'], ['이름 회상 변형', '아까 그 소설 쓴 분 누구더라'],
  ['후속 발화', '그 사람은 왜 그랬을까?'], ['후속 발화 변형', '그다음은?'],
  ['일반 지식', '침식은 어떻게 일어나?'], ['일반 지식 변형', '빛의 굴절을 쉽게 설명해줘'],
  ['의견', '이 결말에 대해 어떻게 생각해?'], ['의견 변형', '주말에 할 만한 취미 추천해줘'],
  ['불확실한 대상', '파란 표지의 그 책을 찾고 있어'],
  ['불확실한 대상 변형', '이름이 흐릿한 앱이 하나 있어'],
];

test('dialogue matrix uses history and has no search or refusal in OFF and ON', async () => {
  const history = [{ role: 'user', authorId: 'bob', text: '어제 읽은 책과 영화 이야기를 했어.' }];
  const metrics = { turns: 0, unnecessarySearches: 0, answerableRefusals: 0, contextLost: 0 };
  for (const mode of ['off', 'on']) for (const [category, prompt] of dialogue) {
    const r = runtime({ history, plan: { mode: 'local' }, localAnswer: '문맥을 이어서 답한다냥.',
      search: { status: 'failed', failed: true, results: [] } });
    r.context.generalSearchMode = () => mode;
    r.context.eligibleForGeneralSearch = eligibleForGeneralSearch;
    await r.context.handleGeminiFallbackMessage(message(prompt));
    metrics.turns++;
    metrics.unnecessarySearches += Number(r.queries.length > 0);
    metrics.answerableRefusals += Number(!r.sent[0] || /확인하지 못|다시 질문/.test(r.sent[0]));
    metrics.contextLost += Number(r.generated[0]?.opts?.history !== history);
    assert.match(r.sent[0], /문맥을 이어서 답한다냥/, `${mode}: ${category}: ${prompt}`);
  }
  assert.deepEqual(metrics, { turns: 32, unnecessarySearches: 0, answerableRefusals: 0, contextLost: 0 });
});

test('ambiguous language reaches the contextual source planner', async () => {
  for (const prompt of ['도자기', '그 배우 이름이 생각 안 나', '침식은 어떻게 일어나?', '그 영화 말인데']) {
    assert.equal(isClearlyLocalChatPrompt(prompt), false, prompt);
    const r = runtime({ history: [{ role: 'user', text: '영화와 책 이야기' }], plan: { mode: 'local' } });
    await r.context.handleGeminiFallbackMessage(message(prompt));
    assert.equal(r.generated[0].opts.planSearch, true, prompt);
    assert.equal(r.generated[0].opts.history.length, 1, prompt);
  }
  assert.match(chatSourcePlanGuidance, /검색 필요성과 답변 가능성을 별도로 판단/);
});

test('missing evidence cannot become an unsupported external claim', async () => {
  const prompt = '공식 사이트의 오늘 운영 시간을 확인해줘';
  for (const mode of ['off', 'on']) {
    const r = runtime({ plan: { mode: 'search', query: '공식 사이트 운영 시간',
      purpose: '현재 운영 시간', externalPrompt: prompt, localPrompt: '' },
      localAnswer: '', search: { status: 'failed', failed: true, results: [] } });
    r.context.generalSearchMode = () => mode;
    r.context.eligibleForGeneralSearch = eligibleForGeneralSearch;
    r.context.isNewsRequest = () => false;
    r.context.runGeneralSearchChat = async () => ({ action: 'legacy' });
    r.context.suppressUnverifiedGeneralSearchData = (data) => ({ ...data, results: [], context: '', failed: true, status: 'insufficient-evidence' });
    r.context.randomUUID = () => 'test-trace';
    r.context.generalSearchBudgetSnapshot = () => null;
    await r.context.handleGeminiFallbackMessage(message(prompt));
    assert.equal(r.queries.length, 1, mode);
    assert.match(r.sent[0], /확인하지 못|근거/, mode);
    assert.doesNotMatch(r.sent[0], /운영 시간은 \d/, mode);
  }
});

test('failed lookup preserves an independent knowledge answer and history', async () => {
  const prompt = '침식을 설명하고 오늘 날씨도 알려줘';
  const plan = resolveChatSourcePlan({ answer: '', sourcePlan: { mode: 'search', query: '오늘 날씨',
    purpose: '현재 날씨 확인', externalPrompt: '오늘 날씨', localPrompt: '침식을 설명해줘' } }, prompt);
  const decision = resolveChatEvidence(plan.intent, { webSearchData: { status: 'failed', failed: true, results: [] } });
  const history = [{ role: 'user', text: '지형 이야기 중이었어' }];
  const calls = [];
  const answer = await answerChatBySource(prompt, { searchIntent: plan.intent, evidenceDecision: decision,
    plannedAnswer: plan.result, history }, async (question, options) => {
    calls.push({ question, options });
    return { answer: '침식은 물이나 바람이 지표를 깎는 과정이다냥.' };
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].question, '침식을 설명해줘');
  assert.equal(calls[0].options.history, history);
  assert.match(answer.answer, /침식은 물이나/);
  assert.match(answer.answer, /요청한 사실을 확인하지 못/);
  assert.doesNotMatch(answer.answer, /오늘 날씨는 맑/);
});

test('native path skips legacy sourcePlan and search execution', async () => {
  const history = [{ role: 'user', text: '아까 깐냥 이야기를 했어' }];
  const r = runtime({ history, plan: { mode: 'search', query: '잘못된 기존 계획' } });
  r.context.process.env.GEMINI_NATIVE_TOOLS_ENABLED = 'true';
  r.context.process.env.GEMINI_NATIVE_TOOLS_TEST_CHANNEL_ID = '123456789012345678';
  await r.context.handleGeminiFallbackMessage({ ...message('푝무위키에서 깐냥 찾아줘'), channelId: '123456789012345678' });
  assert.equal(r.native.length, 1);
  assert.equal(r.native[0].opts.history, history);
  assert.equal(r.generated.length, 0);
  assert.equal(r.queries.length, 0);
  assert.match(r.sent[0], /도구 판단 완료다냥/);
});

test('outside the configured channel the legacy source planner remains active', async () => {
  const r = runtime({ plan: { mode: 'local' } });
  r.context.process.env.GEMINI_NATIVE_TOOLS_ENABLED = 'true';
  r.context.process.env.GEMINI_NATIVE_TOOLS_TEST_CHANNEL_ID = '123456789012345678';
  await r.context.handleGeminiFallbackMessage({ ...message('안녕'), channelId: '123456789012345679' });
  assert.equal(r.native.length, 0);
  assert.equal(r.generated.length, 1);
  assert.match(r.sent[0], /자체 문맥으로 답했다냥/);
});

test('native timeout can recover through legacy chat', async () => {
  const r = runtime({ plan: { mode: 'local' } });
  r.context.process.env.GEMINI_NATIVE_TOOLS_ENABLED = 'true';
  r.context.process.env.GEMINI_NATIVE_TOOLS_ALL_CHANNELS = 'true';
  r.context.generateNativeToolAnswer = async () => {
    throw Object.assign(new Error('timeout'), {
      code: 'GEMINI_STAGE_TIMEOUT',
    });
  };
  await r.context.handleGeminiFallbackMessage({
    ...message('안녕'), channelId: '123456789012345679',
  });
  assert.equal(r.generated.length, 1);
  assert.match(r.sent[0], /자체 문맥으로 답했다냥/);
});
