import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const fontDir = new URL('../assets/fonts/', import.meta.url);
const fonts = {
  Arial: fileURLToPath(new URL('Arial.ttf', fontDir)),
  'Arial Bold': fileURLToPath(new URL('Arial-Bold.ttf', fontDir)),
  NotoSansCJKkrBold: fileURLToPath(new URL('NotoSansCJKkr-Bold.otf', fontDir)),
};
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1466" height="1556"><rect width="100%" height="100%" fill="white"/>${Array.from({ length: 160 }, (_, index) => `<text x="20" y="${40 + index * 9}" font-family="Noto Sans CJK KR, Arial" font-size="24" font-weight="900">한글 Benchmark ${index} ABC 99.00</text>`).join('')}</svg>`;
const cases = [
  ['Arial', [fonts.Arial]],
  ['Arial + Arial Bold', [fonts.Arial, fonts['Arial Bold']]],
  ['NotoSansCJKkr-Bold', [fonts.NotoSansCJKkrBold]],
  ['all bundled', Object.values(fonts)],
];

for (const [label, fontFiles] of cases) {
  const cold = measure(fontFiles);
  const warm = [measure(fontFiles), measure(fontFiles), measure(fontFiles)].sort((a, b) => a.ms - b.ms);
  console.log(JSON.stringify({ label, fontFiles: fontFiles.map((value) => value.split('/').at(-1)), cold, warmMs: warm.map((value) => value.ms), warmMedianMs: warm[1].ms }, null, 2));
}

function measure(fontFiles) {
  const started = performance.now();
  const png = new Resvg(svg, { font: { fontFiles, defaultFontFamily: 'Arial', loadSystemFonts: false }, textRendering: 1 }).render().asPng();
  return { ms: Math.round((performance.now() - started) * 100) / 100, pngBytes: png.length };
}
