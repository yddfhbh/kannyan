import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWebSearchIntent } from '../src/web-search.js';
import { resolveChatSourcePlan } from '../src/chat-source-plan.js';
import { runtime } from '../scripts/lib/chat-verification-runtime.js';

const now = new Date('2026-10-25T02:00:00Z');
const message = (content) => ({ content: `%${content}`, author: {id:'test', username:'test'},
  guildId:'g', channelId:'c', client:{user:{username:'깐냥'}}, attachments:new Map(), channel:{send:async()=>{}} });

test('external source directives override a local Gemini plan and execute Discord search', async () => {
  const questions = [
    'Node.js 공식 문서에서 AsyncLocalStorage.run()은 어떻게 사용하는지 간단한 사용 순서와 함께 알려줘',
    '질병관리청 공식 홈페이지 기준으로 예방접종 절차를 설명해줘',
    '제조사 설명에 따르면 이 세탁기의 필터 청소 주기는 어떻게 돼?',
    '공식 API 문서를 참고해서 결제 취소 요청 필드를 알려줘',
    '이 세법 설명의 출처를 확인해서 설명해줘',
    'According to the official documentation, how do I configure the database connection?',
  ];
  for (const question of questions) {
    const intent = classifyWebSearchIntent(question);
    assert.equal(intent.requiresExternal, true, question);
    const resolved = resolveChatSourcePlan({answer:'검증되지 않은 공식 내용',sourcePlan:{mode:'local'}}, question, intent);
    assert.equal(resolved.intent.requiresExternal, true, question);
    assert.equal(resolved.intent.hasLocalAnswer, false, question);
    assert.equal(resolved.result.answer, '', question);
    const r = runtime({plan:{mode:'local'}, localAnswer:'검증되지 않은 공식 내용',
      search:{status:'empty',results:[],context:''}});
    await r.context.handleGeminiFallbackMessage(message(question), {now});
    assert.equal(r.queries.length, 1, question);
    assert.match(r.sent[0], /확인하지 못|결과가 없어/, question);
    assert.doesNotMatch(r.sent[0], /검증되지 않은 공식 내용/, question);
  }
});

test('local work and explicit no-search requests do not execute Discord search', async () => {
  const questions = [
    '공식적인 말투로 바꿔줘: 내일 보자',
    '아래 공식 문서를 번역해줘: "The request is complete."',
    '아래 공식 문서에서 붙인 내용을 요약해줘: 요청이 완료됨',
    '제공한 제조사 설명을 요약해줘: 필터를 닦으세요.',
    '배열을 순회하는 간단한 코딩 예제를 작성해줘',
    '비동기 함수가 뭔지 일반적으로 설명해줘',
    '공식 문서에서 설명한 내용이 궁금하지만 검색하지 말고 네 지식으로 답해줘',
  ];
  for (const question of questions) {
    const intent = classifyWebSearchIntent(question);
    assert.equal(intent.requiresExternal, false, question);
    const resolved = resolveChatSourcePlan({answer:'자체 답변',sourcePlan:{mode:'local'}}, question, intent);
    assert.equal(resolved.intent.requiresExternal, false, question);
    const r = runtime({plan:{mode:'local'},localAnswer:'자체 답변'});
    await r.context.handleGeminiFallbackMessage(message(question), {now});
    assert.equal(r.queries.length, 0, question);
  }
});

test('explicit no-search overrides a Gemini search plan in the Discord handler', async () => {
  const question = '공식 문서에서 설명한 내용이 궁금하지만 검색하지 말고 답해줘';
  const intent = classifyWebSearchIntent(question);
  const result = resolveChatSourcePlan({answer:'',sourcePlan:{mode:'search',query:'official docs',purpose:'검증',externalPrompt:question}},question,intent);
  assert.equal(result.intent.requiresExternal,false);
  const r = runtime({plan:{mode:'search',query:'official docs',purpose:'검증',externalPrompt:question},localAnswer:''});
  await r.context.handleGeminiFallbackMessage(message(question),{now});
  assert.equal(r.queries.length,0);
});
