import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function run(preload, extra = {}, args = []) {
  const env = { ...process.env, DOTENV_CONFIG_PATH: '/dev/null' };
  for (const name of ['GEMINI_API_KEYS', 'GEMMA_API_KEYS', 'GEMINI_API_KEY', 'GEMMA_API_KEY']) delete env[name];
  return spawnSync(process.execPath, [
    ...(preload ? ['--import', `data:text/javascript,${encodeURIComponent(preload)}`] : []),
    'scripts/verify-chat-live.js', ...args,
  ], { cwd: new URL('..', import.meta.url), env: { ...env, ...extra }, encoding: 'utf8', timeout: 15_000 });
}

test('live verifier without credentials makes no requests and reports unverified', () => {
  const result = run(`globalThis.fetch = () => { throw new Error('unexpected-network'); };`);
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'unverified');
  assert.deepEqual(report.questions, ['너 누구고 오늘 부산 날씨는 어때?', '최신 AI 뉴스 검색해서 요약해줘', '푝무위키 파이호크 나이', 'gpt 6 sol vs gpt 6.1 sol']);
  assert.deepEqual(report.counts, { modelRequests: 0, httpRequests: 0 });
});

test('product live verification is separate, includes full suffixes and reports no-key runs as unverified', () => {
  const result = run(`globalThis.fetch = () => { throw new Error('unexpected-network'); };`, {}, ['--product-comparisons']);
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'unverified');
  assert.ok(report.questions.includes('gpt 6 sol vs gpt 6.1 sol'));
  assert.ok(report.questions.includes('llamafile sol vs llamafile luna'));
  assert.equal(report.questions.length, 5);
  assert.deepEqual(report.counts, { modelRequests: 0, httpRequests: 0 });
});

test('live verifier caps real request attempts across all model fallbacks', () => {
  const result = run(`globalThis.fetch = async () => new Response('{}', { status: 404 });`, {
    GEMINI_API_KEY: 'verification-fake-secret',
    GEMINI_MODEL: 'test-model',
    GEMINI_FALLBACK_MODELS: Array.from({ length: 20 }, (_, i) => `test-${i}`).join(','),
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /"modelRequests": 5/);
  assert.doesNotMatch(result.stdout, /verification-fake-secret/);
});

test('live verifier redacts credentials echoed in model answers', () => {
  const result = run(`globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      answer: 'verification-fake-secret', emotion: 'neutral', sourcePlan: { mode: 'local' }
    }) }] } }]
  }));`, { GEMINI_API_KEY: 'verification-fake-secret' });
  assert.equal(result.error, undefined);
  assert.match(result.stdout, /REDACTED/);
  assert.doesNotMatch(result.stdout + result.stderr, /verification-fake-secret/);
});


test('reported model comparison can run alone without consuming the other fixtures budgets', () => {
  const result = run(`globalThis.fetch = () => { throw new Error('unexpected-network'); };`, {}, ['--model-comparison-only']);
  assert.equal(result.status,2,result.stderr);
  const report=JSON.parse(result.stdout);
  assert.deepEqual(report.questions,['gpt 6 sol vs gpt 6.1 sol']);
  assert.equal(report.questionLimits.httpRequests,36);
  assert.equal(report.limits.httpRequests,36);
});

test('model generation errors remain failed even when chat handler emits an error reply',()=>{
  const result=run(`globalThis.fetch=async()=>{throw Object.assign(new TypeError('fetch failed with verification-fake-secret'),{cause:{code:'ENOTFOUND'}});};`,{GEMINI_API_KEY:'verification-fake-secret'},['--model-comparison-only']);
  assert.equal(result.status,1,result.stderr);
  const report=JSON.parse(result.stdout);
  assert.equal(report.status,'failed');
  assert.ok(report.trace.some(event=>event.event==='model-error' && event.category==='network' && event.code==='ENOTFOUND'));
  assert.doesNotMatch(result.stdout+result.stderr,/verification-fake-secret/);
});

test('flight failure probe runs only the original reported question and identifies the dirty worktree',()=>{
  const result=run(`globalThis.fetch=()=>{throw Error('unexpected-network');};`,{},['--flight-time-only']);
  assert.equal(result.status,2,result.stderr);
  const report=JSON.parse(result.stdout);
  assert.deepEqual(report.questions,['naia to pus flight time']);
  assert.match(report.worktreeIdentity.head,/^[a-f0-9]{40}$/);
  assert.match(report.worktreeIdentity.codeSha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(report.counts,{modelRequests:0,httpRequests:0});
});
