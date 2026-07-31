import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  calculateTetrioStyleGraphValues,
  createTetrioStyleGraph,
  renderTetrioStyleGraphSvg,
  tetrioStyleGraphOutputHeight,
  tetrioStyleGraphOutputScale,
  tetrioStyleGraphOutputWidth,
  tetrioStyleGraphAxes,
} from '../src/tetrio-style-graph.js';

test('calculateTetrioStyleGraphValues returns expected normalized values', () => {
  const values = calculateTetrioStyleGraphValues({
    apm: 87.85,
    pps: 1.65,
    dsSecond: 0.45,
    cheeseIndex: 14.381,
  });

  assert.ok(Math.abs(values.attack - 0.7320833333333333) < 1e-12);
  assert.ok(Math.abs(values.speed - 0.55) < 1e-12);
  assert.equal(values.defense, 0.675);
  assert.equal(values.cheese, 0.1797625);
});

test('calculateTetrioStyleGraphValues clamps negative defense and cheese to zero', () => {
  const values = calculateTetrioStyleGraphValues({
    apm: 60,
    pps: 2,
    dsSecond: -0.25,
    cheeseIndex: -12,
  });

  assert.equal(values.defense, 0);
  assert.equal(values.cheese, 0);
});

test('calculateTetrioStyleGraphValues clamps all axes to 1.5 upper bound', () => {
  const values = calculateTetrioStyleGraphValues({
    apm: 500,
    pps: 10,
    dsSecond: 5,
    cheeseIndex: 500,
  });

  assert.deepEqual(values, {
    attack: 1.5,
    speed: 1.5,
    defense: 1.5,
    cheese: 1.5,
  });
});

test('renderTetrioStyleGraphSvg includes labels in attack-speed-defense-cheese order', () => {
  const svg = renderTetrioStyleGraphSvg({
    players: [
      {
        username: 'hebi_',
        stats: { apm: 87.85, pps: 1.65, dsSecond: 0.45, cheeseIndex: 14.381 },
      },
    ],
  });

  assert.equal(tetrioStyleGraphAxes.map((axis) => axis.label).join(','), 'ATTACK,SPEED,DEFENSE,CHEESE');
  assert.match(svg, /width="720" height="480" viewBox="0 0 600 400"/);
  assert.ok(svg.indexOf('>ATTACK<') < svg.indexOf('>SPEED<'));
  assert.ok(svg.indexOf('>SPEED<') < svg.indexOf('>DEFENSE<'));
  assert.ok(svg.indexOf('>DEFENSE<') < svg.indexOf('>CHEESE<'));
  assert.equal((svg.match(/class="markerOuter"/g) ?? []).length, 4);
});

test('renderTetrioStyleGraphSvg includes multi-user legend and polygons', () => {
  const svg = renderTetrioStyleGraphSvg({
    players: [
      {
        username: 'hebi_',
        stats: { apm: 87.85, pps: 1.65, dsSecond: 0.45, cheeseIndex: 14.381 },
      },
      {
        username: 'pyhok',
        stats: { apm: 120, pps: 2.4, dsSecond: 0.8, cheeseIndex: 40 },
      },
    ],
  });

  assert.equal((svg.match(/class="legendBox"/g) ?? []).length, 2);
  assert.equal((svg.match(/class="dataFill"/g) ?? []).length, 2);
  assert.match(svg, /HEBI/);
  assert.match(svg, /PYHOK/);
});

test('createTetrioStyleGraph renders PNG with same output size and scale as psq graph', async () => {
  const image = await createTetrioStyleGraph({
    players: [
      {
        username: 'hebi_',
        stats: { apm: 87.85, pps: 1.65, dsSecond: 0.45, cheeseIndex: 14.381 },
      },
    ],
  });
  const metadata = await sharp(image).metadata();

  assert.equal(tetrioStyleGraphOutputScale, 1.2);
  assert.equal(metadata.width, tetrioStyleGraphOutputWidth);
  assert.equal(metadata.height, tetrioStyleGraphOutputHeight);
});
