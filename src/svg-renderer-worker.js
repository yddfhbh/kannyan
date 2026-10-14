import { parentPort } from 'node:worker_threads';
import { Resvg } from '@resvg/resvg-js';
import { fileURLToPath } from 'node:url';

if (!parentPort) throw new Error('SVG renderer worker requires parentPort');

const bundledFontFiles = [
  fileURLToPath(new URL('../assets/fonts/Arial.ttf', import.meta.url)),
  fileURLToPath(new URL('../assets/fonts/Arial-Bold.ttf', import.meta.url)),
];

parentPort.on('message', async (job) => {
  try {
    if (Number.isFinite(job?.options?.delayMs) && job.options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, job.options.delayMs));
    }
    const scale = Number.isFinite(job?.options?.scale) && job.options.scale > 0 ? job.options.scale : 1;
    const png = new Resvg(job.svg, {
      background: job.options?.background,
      font: {
        fontFiles: [...bundledFontFiles, ...(job.options?.fontFiles ?? [])],
        defaultFontFamily: job.options?.defaultFontFamily || 'Arial',
        loadSystemFonts: false,
      },
      imageRendering: 0,
      textRendering: 1,
      fitTo: scale === 1 ? undefined : { mode: 'zoom', value: scale },
    }).render().asPng();
    const bytes = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
    parentPort.postMessage({ type: 'result', id: job.id, bytes }, [bytes]);
  } catch (error) {
    parentPort.postMessage({ type: 'error', id: job?.id, error: {
      message: String(error?.message ?? 'SVG render worker failed'),
      stack: String(error?.stack ?? '').slice(0, 20_000),
    } });
  }
});
