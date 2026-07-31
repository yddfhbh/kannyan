import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidTetrioStatsMetricInput,
  parseTetrioGraphInput,
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
