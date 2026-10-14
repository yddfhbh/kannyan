import { parentPort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Resvg } from '@resvg/resvg-js';

const bundledFontFiles = [
  fileURLToPath(new URL('../assets/fonts/Arial.ttf', import.meta.url)),
  fileURLToPath(new URL('../assets/fonts/Arial-Bold.ttf', import.meta.url)),
  fileURLToPath(new URL('../assets/fonts/NotoSansCJKkr-Bold.otf', import.meta.url)),
];

parentPort.on('message', (job) => {
  try {
    const started = performance.now();
    const scale = Number.isFinite(job.options?.scale) && job.options.scale > 0 ? job.options.scale : 1;
    const png = new Resvg(job.svg, { background: job.options?.background, font: { fontFiles: bundledFontFiles, defaultFontFamily: 'Arial', loadSystemFonts: false }, imageRendering: 0, textRendering: 1, fitTo: scale === 1 ? undefined : { mode: 'zoom', value: scale } }).render().asPng();
    const bytes = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
    parentPort.postMessage({ type: 'result', id: job.id, dispatchAt: job.dispatchAt, executionMs: performance.now() - started, bytes }, [bytes]);
  } catch (error) {
    parentPort.postMessage({ type: 'error', id: job.id, error: { message: String(error?.message ?? error) } });
  }
});
