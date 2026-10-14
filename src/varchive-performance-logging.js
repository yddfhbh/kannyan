import { randomBytes } from 'node:crypto';

function readMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
  };
}

function formatMemory(memory) {
  return `rss=${memory.rss} heapUsed=${memory.heapUsed} heapTotal=${memory.heapTotal} external=${memory.external} arrayBuffers=${memory.arrayBuffers}`;
}

function elapsedMs(start) {
  return Math.round(performance.now() - start);
}

export function createVArchivePerformanceTrace(prefix) {
  const id = randomBytes(3).toString('hex');
  const startedAt = performance.now();
  const startMemory = readMemoryUsage();
  let failed = false;

  console.log(`[${prefix}][${id}] memory start ${formatMemory(startMemory)}`);

  return {
    id,
    async measure(label, operation) {
      const stageStartedAt = performance.now();
      try {
        return await operation();
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        console.log(`[${prefix}][${id}] ${label} ${elapsedMs(stageStartedAt)}ms`);
        console.log(`[${prefix}][${id}] memory ${label} ${formatMemory(readMemoryUsage())}`);
      }
    },
    markFailed() {
      failed = true;
    },
    finish() {
      const status = failed ? ' failed' : '';
      console.log(`[${prefix}][${id}] total ${elapsedMs(startedAt)}ms${status}`);
      console.log(`[${prefix}][${id}] memory end ${formatMemory(readMemoryUsage())}`);
    },
  };
}

export async function withVArchivePerformanceTrace(prefix, handler) {
  const trace = createVArchivePerformanceTrace(prefix);
  try {
    return await handler(trace);
  } catch (error) {
    trace.markFailed();
    throw error;
  } finally {
    trace.finish();
  }
}
