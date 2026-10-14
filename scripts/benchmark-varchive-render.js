import os from 'node:os';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { renderSvgToPng } from '../src/svg-renderer.js';
import { createVArchiveLevelPerformanceLookup } from '../src/varchive-level-performance.js';
import { getVArchiveRenderDiagnostics, renderVArchiveLevelPerformanceCardSvg } from '../src/varchive-level-performance-card.js';
import { TimedWorkerHarness } from './benchmark-resvg-worker.js';

const args = new Map(process.argv.slice(2).map((value, index, values) => value.startsWith('--') ? [value.slice(2), values[index + 1]] : null).filter(Boolean));
const nickname = args.get('nickname') ?? process.env.VARCHIVE_BENCHMARK_NICKNAME;
const floorName = args.get('floor') ?? '14.1';
const level = args.get('level');
const button = Number(args.get('button') ?? 4);
const warmRuns = Math.max(3, Number(args.get('warm-runs') ?? 4));

if (!nickname) {
  console.error('실제 V-ARCHIVE lookup을 위해 --nickname <닉네임> 또는 VARCHIVE_BENCHMARK_NICKNAME이 필요합니다.');
  process.exitCode = 2;
} else {
  const lookupStart = performance.now();
  const lookup = await createVArchiveLevelPerformanceLookup(nickname, level ? 'ALL' : null, level ? Number(level) : null, button, level ? {} : { floorName });
  const benchmarkLookup = { ...lookup, entries: lookup.entries.slice(0, 40) };
  const jackets = await fetchJackets(benchmarkLookup.entries);
  console.log(JSON.stringify({ host: { cpus: os.cpus().length, availableParallelism: os.availableParallelism?.() }, lookupMs: round(performance.now() - lookupStart), nickname: lookup.nickname, selector: level ? `ALL${level}` : floorName, button, actualLookupEntries: lookup.entries.length, benchmarkEntries: benchmarkLookup.entries.length }, null, 2));

  const svg = renderVArchiveLevelPerformanceCardSvg({ lookup: benchmarkLookup, jacketDataUrls: jackets, generatedAt: '2026-01-01T00:00:00.000Z' });
  const noJacketSvg = renderVArchiveLevelPerformanceCardSvg({ lookup: benchmarkLookup, jacketDataUrls: {}, generatedAt: '2026-01-01T00:00:00.000Z' });
  await reportSingle('sync', svg, warmRuns, (value, options) => renderSvgToPng(value, options));
  const worker = new TimedWorkerHarness(1);
  try { await reportSingle('worker', svg, warmRuns, (value, options) => worker.render(value, options)); } finally { await worker.close(); }

  console.log('\n조건별 render benchmark (동일 lookup 결과 재사용)');
  console.table(await benchmarkConditions(benchmarkLookup, jackets, noJacketSvg, warmRuns));
  console.log('\n실제 카드 diagnostics');
  console.log(JSON.stringify(getVArchiveRenderDiagnostics(svg, benchmarkLookup, jackets, renderSvgToPng(svg)), null, 2));
  console.log(`sync sha256=${createHash('sha256').update(renderSvgToPng(svg)).digest('hex')}`);
}

async function fetchJackets(entries) {
  const pairs = await Promise.all([...new Map(entries.map((entry) => [entry.titleId, entry.jacketUrl])).entries()].map(async ([titleId, url]) => [titleId, await fetchDataUrl(url)]));
  return Object.fromEntries(pairs);
}

async function fetchDataUrl(url) {
  const response = await fetch(url, { headers: { accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' } });
  if (!response.ok) throw new Error(`jacket fetch failed ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:${response.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg'};base64,${bytes.toString('base64')}`;
}

async function reportSingle(renderer, svg, warmCount, render) {
  const cold = await timed(svg, render, { scale: 1 });
  const warm = [];
  for (let index = 0; index < warmCount; index += 1) warm.push(await timed(svg, render, { scale: 1 }));
  console.log(JSON.stringify({ renderer, cold, warm: summarize(warm), memory: process.memoryUsage() }, null, 2));
}

async function benchmarkConditions(lookup, jackets, noJacketSvg, warmCount) {
  const rows = [];
  for (const count of [10, 20, 40]) {
    const smallLookup = { ...lookup, entries: lookup.entries.slice(0, count) };
    for (const [label, data] of [['jacket', jackets], ['no-jacket', {}]]) {
      const value = label === 'jacket' ? renderVArchiveLevelPerformanceCardSvg({ lookup: smallLookup, jacketDataUrls: data, generatedAt: '2026-01-01T00:00:00.000Z' }) : renderVArchiveLevelPerformanceCardSvg({ lookup: smallLookup, jacketDataUrls: data, generatedAt: '2026-01-01T00:00:00.000Z' });
      rows.push(await conditionRow(`${count} entries/${label}/scale1`, value, warmCount, 1));
    }
  }
  for (const scale of [0.5, 1, 2]) rows.push(await conditionRow(`40 entries/jacket/scale${scale}`, renderVArchiveLevelPerformanceCardSvg({ lookup, jacketDataUrls: jackets, generatedAt: '2026-01-01T00:00:00.000Z' }), warmCount, scale));
  const normal = renderVArchiveLevelPerformanceCardSvg({ lookup, jacketDataUrls: jackets, generatedAt: '2026-01-01T00:00:00.000Z' });
  rows.push(await conditionRow('40 entries/jacket/no-text', normal.replace(/<text\b[^>]*>[\s\S]*?<\/text>/gi, ''), warmCount, 1));
  rows.push(await conditionRow('40 entries/jacket/normal-text', normal, warmCount, 1));
  return rows;
}

async function conditionRow(condition, svg, warmCount, scale) {
  const cold = await timed(svg, (value, options) => renderSvgToPng(value, options), { scale });
  const warm = [];
  for (let index = 0; index < warmCount; index += 1) warm.push(await timed(svg, (value, options) => renderSvgToPng(value, options), { scale }));
  const dimensions = getVArchiveRenderDiagnostics(svg, { entries: [] }, {}).svg;
  const summary = summarize(warm);
  return { condition, svg: `${dimensions.width}x${dimensions.height}/${dimensions.bytes}B`, coldMs: cold.ms, warmMedianMs: summary.medianMs, warmMinMs: summary.minMs, warmMaxMs: summary.maxMs, png: `${cold.png.width}x${cold.png.height}/${cold.png.bytes}B`, rss: cold.memory.rss, heapUsed: cold.memory.heapUsed, external: cold.memory.external, arrayBuffers: cold.memory.arrayBuffers };
}

async function timed(svg, render, options) {
  const started = performance.now();
  const output = await render(svg, options);
  const png = Buffer.isBuffer(output) ? pngDimensions(output) : output.png;
  return { ...(!Buffer.isBuffer(output) ? output : {}), ms: round(performance.now() - started), png, memory: process.memoryUsage() };
}

function summarize(results) { const values = results.map((result) => result.ms).sort((a, b) => a - b); return { count: values.length, minMs: values[0], medianMs: values[Math.floor(values.length / 2)], maxMs: values.at(-1), samplesMs: values }; }
function pngDimensions(png) { return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), bytes: png.length }; }
function round(value) { return Math.round(value * 100) / 100; }
