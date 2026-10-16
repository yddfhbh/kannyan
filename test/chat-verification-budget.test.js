import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerificationBudget, classifyVerificationError } from '../scripts/lib/chat-verification-budget.js';

test('question request exhaustion resets while total budget remains bounded',()=>{
  const budget=createVerificationBudget({modelRequests:4,httpRequests:6,durationMs:10000},{modelRequests:2,httpRequests:3,durationMs:10000});
  for(let i=0;i<2;i++) {
    budget.begin();
    budget.consume(true);budget.consume(true);budget.consume(false);
    assert.throws(()=>budget.consume(false),{code:i===0?'VERIFY_QUESTION_HTTP_LIMIT':'VERIFY_TOTAL_HTTP_LIMIT'});
    assert.deepEqual(budget.questionCounts,{modelRequests:2,httpRequests:3});
  }
  assert.deepEqual(budget.counts,{modelRequests:4,httpRequests:6});
});

test('model cap and duration cap report distinct scopes and cancel in-flight work',()=>{
  const budget=createVerificationBudget({modelRequests:4,httpRequests:6,durationMs:10000},{modelRequests:1,httpRequests:3,durationMs:10000});
  budget.begin();budget.consume(true);
  assert.throws(()=>budget.consume(true),{code:'VERIFY_QUESTION_MODEL_LIMIT'});
  assert.equal(budget.signal.aborted,true);
  budget.begin();
  assert.throws(()=>budget.expire(),{code:'VERIFY_QUESTION_TIME_LIMIT'});
  assert.equal(budget.failures[0].category,'time-limit');
});

test('safe errors distinguish network, timeout, provider HTTP and unknown validator failures',()=>{
  const cases=[
    [Object.assign(Error('secret'),{cause:{code:'ENOTFOUND'}}),{category:'network',code:'ENOTFOUND'}],
    [Object.assign(Error('secret'),{name:'AbortError'}),{category:'timeout'}],
    [Object.assign(Error('secret'),{status:429,details:'secret'}),{category:'api',status:429}],
    [Error('secret'),{category:'validator',code:'UNCLASSIFIED_ERROR'}],
  ];
  for(const [error,expected] of cases) assert.deepEqual(classifyVerificationError(error),expected);
});

test('remaining retrieval budget accounts for question and total limits without consuming requests',()=>{
  const b=createVerificationBudget({modelRequests:6,httpRequests:10,durationMs:10000},{modelRequests:4,httpRequests:8,durationMs:9000});
  b.begin(); b.consume(true); b.consume(false);
  assert.equal(b.remaining().modelRequests,3);
  assert.equal(b.remaining().httpRequests,6);
  assert.ok(b.remaining().durationMs>0 && b.remaining().durationMs<=9000);
  assert.deepEqual(b.counts,{modelRequests:1,httpRequests:2});
  b.begin();
  assert.equal(b.remaining().modelRequests,4);
  assert.equal(b.remaining().httpRequests,8);
});
