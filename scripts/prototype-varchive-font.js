import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Resvg } from '@resvg/resvg-js';
import { renderVArchiveLevelPerformanceCardSvg } from '../src/varchive-level-performance-card.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = `${root}/assets/fonts/NotoSansCJKkr-Bold.otf`;
const outputDir = `${root}/tmp/varchive-font-prototype`;
const subset = `${outputDir}/NotoSansCJKkr-Bold-varchive-subset.ttf`;
const textPath = `${outputDir}/card-text.txt`;
const probePath = `${outputDir}/fallback-probe-text.txt`;
const fontToolsPath = process.env.FONTTOOLS_PYTHONPATH || '/tmp/varchive-fonttools';
const args = new Map(process.argv.slice(2).map((value, index, values) => value.startsWith('--') ? [value.slice(2), values[index + 1]] : null).filter(Boolean));
const warmRuns = Math.max(1, Number(args.get('warm-runs') ?? 1));

await mkdir(outputDir, { recursive: true });
const text = args.get('text') || [
  '4B · V-ARCHIVE 14.1', '40 patterns · PLAYER KanNyan0713', 'Generated 2026-01-01 00:00 KST',
  '한글 레벨성과 점수', 'SC 14', 'Löschen', '테스트 카드', '★ ✓ → 99.56%',
].join('\n');
const probeText = args.get('probe-text') || '日本語 漢字';
await writeFile(textPath, text, 'utf8');
await writeFile(probePath, probeText, 'utf8');
const subsetResult = spawnSync('python3', [fileURLToPath(new URL('./font-subset.py', import.meta.url)), source, subset, textPath, probePath], {
  env: { ...process.env, PYTHONPATH: fontToolsPath }, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
});
if (subsetResult.status !== 0) throw new Error(`fontTools subset failed: ${subsetResult.stderr || subsetResult.error}`);
const analysis = JSON.parse(subsetResult.stdout);
const [sourceStat, subsetStat] = await Promise.all([stat(source), stat(subset)]);
const fixture = makeFixture(text);
const full = `${root}/assets/fonts/NotoSansCJKkr-Bold.otf`;
const cases = [
  { label: 'full NotoSansCJKkr-Bold', files: [full] },
  { label: 'prototype Korean subset', files: [subset] },
];
const rows = [];
for (const current of cases) {
  for (const count of [10, 20, 40]) {
    const svg = makeCardSvg(fixture.slice(0, count));
    const measurements = measure(svg, current.files, warmRuns);
    rows.push({ rendererFont: current.label, fontBytes: current === cases[0] ? sourceStat.size : subsetStat.size, glyphs: current === cases[0] ? analysis.sourceGlyphs : analysis.subsetGlyphs, entries: count, ...measurements });
  }
}
const comparison = compare(makeCardSvg(fixture.slice(0, 40)), cases[0].files, cases[1].files);
const result = {
  source: { path: source, bytes: sourceStat.size, glyphs: analysis.sourceGlyphs, cmapCodepoints: analysis.sourceCmapCodepoints, selectedRanges: analysis.selectedRanges },
  subset: { path: subset, bytes: subsetStat.size, glyphs: analysis.subsetGlyphs, cmapCodepoints: analysis.subsetCmapCodepoints, requestedCodepoints: analysis.requestedCodepoints, requestedMissing: analysis.requestedMissing },
  fallbackProbe: { covered: analysis.probeMissing.length === 0, missingCodepoints: analysis.probeMissing, strategy: analysis.probeMissing.length === 0 ? 'subset' : 'full-font fallback' },
  rows,
  speedup: Object.fromEntries([10, 20, 40].map((count) => {
    const fullRow = rows.find((row) => row.entries === count && row.rendererFont.startsWith('full'));
    const subsetRow = rows.find((row) => row.entries === count && row.rendererFont.startsWith('prototype'));
    return [count, { warm: round(fullRow.warmMedianMs / subsetRow.warmMedianMs), cold: round(fullRow.coldMs / subsetRow.coldMs) }];
  })),
  comparison,
  resvgApi: 'Resvg 2.6.2 exposes fontFiles/fontDirs only; no parsed font database reuse API.',
};
await writeFile(`${outputDir}/benchmark.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

function makeFixture(sourceText) {
  const lines = sourceText.split(/\n/).filter(Boolean);
  return Array.from({ length: 40 }, (_, index) => ({ titleId: String(index), songName: lines[index % lines.length], difficulty: index % 2 ? 'HD' : 'SC', level: 10 + index % 6, floorName: `${4 + index % 11}.${index % 10}`, scoreText: `${(98 + (index % 200) / 100).toFixed(2)}` }));
}
function makeCardSvg(entries) { return renderVArchiveLevelPerformanceCardSvg({ lookup: { nickname: 'KanNyan0713', difficulty: 'ALL', level: 14, button: 4, entries }, generatedAt: '2026-01-01T00:00:00.000Z' }); }
function measure(svg, files, warmCount) {
  const render = () => new Resvg(svg, { font: { fontFiles: files, defaultFontFamily: 'Noto Sans CJK KR', loadSystemFonts: false }, imageRendering: 0, textRendering: 1 }).render();
  const coldStart = performance.now(); const coldImage = render(); const coldMs = performance.now() - coldStart;
  const warm = [];
  for (let i = 0; i < warmCount; i += 1) { const started = performance.now(); render(); warm.push(performance.now() - started); }
  const png = coldImage.asPng();
  return { coldMs: round(coldMs), warmMedianMs: round([...warm].sort((a, b) => a - b)[Math.floor(warm.length / 2)]), warmSamplesMs: warm.map(round), png: { width: coldImage.width, height: coldImage.height, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') } };
}
function compare(svg, fullFiles, subsetFiles) {
  const render = (files) => new Resvg(svg, { font: { fontFiles: files, defaultFontFamily: 'Noto Sans CJK KR', loadSystemFonts: false }, imageRendering: 0, textRendering: 1 }).render();
  const a = render(fullFiles); const b = render(subsetFiles);
  const pixelsA = a.pixels; const pixelsB = b.pixels; let changed = 0; let absolute = 0; let max = 0;
  for (let i = 0; i < Math.min(pixelsA.length, pixelsB.length); i += 1) { const difference = Math.abs(pixelsA[i] - pixelsB[i]); if (difference) changed += 1; absolute += difference; max = Math.max(max, difference); }
  return { dimensions: `${a.width}x${a.height}`, pixelBytesCompared: Math.min(pixelsA.length, pixelsB.length), changedBytes: changed, changedByteRatio: round(changed / Math.min(pixelsA.length, pixelsB.length)), meanAbsoluteChannelDifference: round(absolute / Math.min(pixelsA.length, pixelsB.length)), maxChannelDifference: max, fullHash: createHash('sha256').update(a.asPng()).digest('hex'), subsetHash: createHash('sha256').update(b.asPng()).digest('hex') };
}
function round(value) { return Math.round(value * 100) / 100; }
