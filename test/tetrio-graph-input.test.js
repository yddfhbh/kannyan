import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidTetrioStatsMetricInput,
  parseTetrioGraphInput,
  parseTetrioRecentGraphInput,
  parseTetrioStatsMetricInput,
} from '../src/tetrio-graph-input.js';

test('parseTetrioGraphInput supports empty sq input like psq', () => {
  assert.deepEqual(parseTetrioGraphInput(''), {
    kind: 'empty',
    targets: null,
  });
});

test('parseTetrioGraphInput supports a single username like %sq hebi_', () => {
  assert.deepEqual(parseTetrioGraphInput('hebi_'), {
    kind: 'targets',
    targets: ['hebi_'],
  });
});

test('parseTetrioGraphInput supports direct metric input like %sq 60 2.0 120', () => {
  assert.deepEqual(parseTetrioGraphInput('60 2.0 120'), {
    kind: 'metric',
    metricInput: { apm: 60, pps: 2, vs: 120 },
    target: null,
  });
});

test('parseTetrioStatsMetricInput supports direct numeric input for %ts', () => {
  assert.deepEqual(parseTetrioStatsMetricInput('98.04 1.51 189.83'), {
    apm: 98.04,
    pps: 1.51,
    vs: 189.83,
  });
});

test('parseTetrioStatsMetricInput supports labeled input', () => {
  assert.deepEqual(parseTetrioStatsMetricInput('apm98.04 pps1.51 vs189.83'), {
    apm: 98.04,
    pps: 1.51,
    vs: 189.83,
  });
});

test('isValidTetrioStatsMetricInput requires positive APM PPS VS', () => {
  assert.equal(isValidTetrioStatsMetricInput({ apm: 60, pps: 2, vs: 120 }), true);
  assert.equal(isValidTetrioStatsMetricInput({ apm: 0, pps: 2, vs: 120 }), false);
});


test('recent graph supports all counts from 1 to 20', () => {
  for (let n = 1; n <= 20; n++) {
    assert.deepEqual(parseTetrioRecentGraphInput(String(n)), {
      kind: 'recent',
      recentCount: n,
      targets: null,
    });
  }
});

test('recent graph rejects mixed count and target input', () => {
  for (const input of [
    'hebi_ 5', '5 hebi_', 'hebi_ 10',
    '20 hebi_', 'hebi_ kannyan 3',
    '5 6', '0 hebi_',
    '<@123456789012345678> 5',
  ]) {
    assert.equal(
      parseTetrioRecentGraphInput(input).kind,
      'recent_mixed'
    );
  }
});

test('recent graph rejects invalid standalone counts', () => {
  for (const input of ['0', '21', '100']) {
    assert.equal(
      parseTetrioRecentGraphInput(input).kind,
      'recent_invalid'
    );
  }
});

test('recent graph preserves existing graph inputs', () => {
  for (const input of [
    '', 'hebi_', 'hebi_ kannyan',
    '60 2.0 120', '5 2 10',
    'apm60 pps2 vs120',
    '101', '12345', 'player5',
    '$avgx', '<@123456789012345678>',
  ]) {
    assert.deepEqual(
      parseTetrioRecentGraphInput(input),
      parseTetrioGraphInput(input)
    );
  }
});

test('original graph parser remains unchanged for sq', () => {
  assert.deepEqual(parseTetrioGraphInput('5'), {
    kind: 'targets',
    targets: ['5'],
  });
});
