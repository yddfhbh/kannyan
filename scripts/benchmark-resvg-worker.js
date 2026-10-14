import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const workerUrl = new URL('./benchmark-resvg-worker-thread.js', import.meta.url);

export class TimedWorkerHarness {
  constructor(size = 1) {
    this.workers = [];
    this.queue = [];
    this.nextId = 1;
    const started = performance.now();
    for (let index = 0; index < size; index += 1) this.#addWorker();
    this.initMs = performance.now() - started;
  }

  #addWorker() {
    const worker = new Worker(workerUrl, { type: 'module', execArgv: [] });
    const state = { worker, busy: null };
    worker.on('message', (message) => {
      if (!state.busy || state.busy.id !== message.id) return;
      const job = state.busy;
      state.busy = null;
      if (message.type === 'result') {
        job.resolve({ queueWaitMs: round(message.dispatchAt - job.enqueuedAt), workerExecutionMs: round(message.executionMs), totalMs: round(performance.now() - job.enqueuedAt), png: pngDimensions(Buffer.from(message.bytes)) });
      } else job.reject(new Error(message.error?.message ?? 'worker error'));
      this.#dispatch();
    });
    worker.on('error', (error) => { if (state.busy) state.busy.reject(error); });
    this.workers.push(state);
  }

  render(svg, options = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, svg, options, enqueuedAt: performance.now(), resolve, reject });
      this.#dispatch();
    });
  }

  #dispatch() {
    for (const state of this.workers) {
      if (state.busy || this.queue.length === 0) continue;
      const job = this.queue.shift();
      state.busy = job;
      const dispatchAt = performance.now();
      state.worker.postMessage({ id: job.id, svg: job.svg, options: job.options, dispatchAt });
    }
  }

  async close() { await Promise.all(this.workers.map(({ worker }) => worker.terminate())); }
}

function pngDimensions(png) { return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), bytes: png.length }; }
function round(value) { return Math.round(value * 100) / 100; }
