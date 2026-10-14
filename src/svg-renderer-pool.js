import { Worker } from 'node:worker_threads';
import { ensureSvgNamespace } from './svg-renderer.js';

const workerUrl = new URL('./svg-renderer-worker.js', import.meta.url);
const defaultPoolSize = 3;
const defaultQueueLimit = 8;
const defaultTimeoutMs = 30_000;

export class SvgRendererPool {
  constructor({ size = defaultPoolSize, queueLimit = defaultQueueLimit, timeoutMs = defaultTimeoutMs } = {}) {
    this.size = Math.max(1, Math.floor(size));
    this.queueLimit = Math.max(0, Math.floor(queueLimit));
    this.timeoutMs = Math.max(1, Math.floor(timeoutMs));
    this.workers = [];
    this.queue = [];
    this.nextJobId = 1;
    this.closed = false;
    for (let index = 0; index < this.size; index += 1) this.#addWorker(index);
  }

  render(svg, options = {}) {
    if (this.closed) return Promise.reject(new Error('SVG renderer pool is closed'));
    if (this.queue.length >= this.queueLimit && this.workers.every((state) => state.busy)) {
      return Promise.reject(Object.assign(new Error('SVG renderer queue is full'), { code: 'SVG_RENDER_QUEUE_FULL' }));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextJobId++, svg: ensureSvgNamespace(svg), options: {
        background: options.background,
        defaultFontFamily: options.defaultFontFamily || 'Arial',
        fontFiles: Array.isArray(options.fontFiles) ? options.fontFiles.filter(Boolean) : [],
        scale: options.scale,
        delayMs: options.delayMs,
      }, resolve, reject });
      this.#dispatch();
    });
  }

  async close() {
    this.closed = true;
    const error = new Error('SVG renderer pool is closed');
    for (const job of this.queue.splice(0)) job.reject(error);
    const workers = this.workers.splice(0);
    for (const state of workers) {
      clearTimeout(state.timer);
      state.timer = null;
      const job = state.busy;
      state.busy = null;
      if (job) job.reject(error);
    }
    await Promise.all(workers.map(({ worker }) => worker.terminate()));
  }

  #addWorker(index) {
    const worker = new Worker(workerUrl, { type: 'module', execArgv: [] });
    const state = { index, worker, busy: null };
    this.workers.push(state);
    worker.on('message', (message) => this.#finish(state, message));
    worker.on('error', (error) => this.#crash(state, error));
    worker.on('exit', (code) => {
      if (!this.closed && code !== 0 && this.workers.includes(state)) this.#crash(state, new Error(`SVG renderer worker exited with code ${code}`));
    });
  }

  #dispatch() {
    for (const state of this.workers) {
      if (state.busy || this.queue.length === 0 || this.closed) continue;
      const job = this.queue.shift();
      state.busy = job;
      state.timer = setTimeout(() => this.#crash(state, Object.assign(new Error('SVG renderer worker timed out'), { code: 'SVG_RENDER_TIMEOUT' })), this.timeoutMs);
      try {
        state.worker.postMessage({ id: job.id, svg: job.svg, options: job.options });
      } catch (error) {
        this.#crash(state, error);
      }
    }
  }

  #finish(state, message) {
    if (!state.busy || message?.id !== state.busy.id) return;
    const job = state.busy;
    clearTimeout(state.timer);
    state.timer = null;
    state.busy = null;
    if (message.type === 'result') job.resolve(Buffer.from(message.bytes));
    else job.reject(Object.assign(new Error(message.error?.message ?? 'SVG renderer worker failed'), { stack: message.error?.stack }));
    this.#dispatch();
  }

  #crash(state, error) {
    if (!this.workers.includes(state)) return;
    clearTimeout(state.timer);
    state.timer = null;
    const job = state.busy;
    state.busy = null;
    if (job) job.reject(error);
    this.workers = this.workers.filter((candidate) => candidate !== state);
    state.worker.terminate();
    if (!this.closed) this.#addWorker(state.index);
    this.#dispatch();
  }
}

export const svgRendererPoolDefaults = Object.freeze({ size: defaultPoolSize, queueLimit: defaultQueueLimit, timeoutMs: defaultTimeoutMs });

let sharedPool;
export function getSvgRendererPool(options = {}) {
  if (!sharedPool) sharedPool = new SvgRendererPool(options);
  return sharedPool;
}
export function renderSvgToPngInWorker(svg, options = {}) {
  return getSvgRendererPool(options.pool).render(svg, options);
}

export async function closeSvgRendererPool() {
  if (!sharedPool) return;
  const pool = sharedPool;
  sharedPool = null;
  await pool.close();
}
