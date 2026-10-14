import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { renderSvgToPng } from '../src/svg-renderer.js';
import { SvgRendererPool } from '../src/svg-renderer-pool.js';
import {
  isVArchiveSubsetCodepointSupported,
  selectVArchiveFont,
} from '../src/varchive-font-selection.js';

const svg = '<svg width="32" height="24" viewBox="0 0 32 24"><rect width="32" height="24" fill="#123456"/><text x="2" y="16">test</text></svg>';

test('SVG worker renderer preserves synchronous PNG output', async () => {
  const pool = new SvgRendererPool({ size: 2, queueLimit: 2, timeoutMs: 10_000 });
  try {
    const sync = renderSvgToPng(svg);
    const worker = await pool.render(svg);
    assert.deepEqual({ width: sync.readUInt32BE(16), height: sync.readUInt32BE(20) }, { width: worker.readUInt32BE(16), height: worker.readUInt32BE(20) });
    assert.equal(createHash('sha256').update(worker).digest('hex'), createHash('sha256').update(sync).digest('hex'));
  } finally {
    await pool.close();
  }
});

test('SVG worker renderer rejects work beyond its bounded queue', async () => {
  const pool = new SvgRendererPool({ size: 1, queueLimit: 0, timeoutMs: 10_000 });
  try {
    const first = pool.render(svg);
    await assert.rejects(() => pool.render(svg), (error) => error.code === 'SVG_RENDER_QUEUE_FULL');
    await first;
  } finally {
    await pool.close();
  }
});

test('SVG worker renderer close rejects an in-flight job and leaves the pool closed', async () => {
  const pool = new SvgRendererPool({ size: 1, queueLimit: 2, timeoutMs: 10_000 });
  const inFlight = pool.render(svg);
  const closePromise = pool.close();
  await assert.rejects(inFlight, /SVG renderer pool is closed/);
  await closePromise;
  await assert.rejects(() => pool.render(svg), /SVG renderer pool is closed/);
});

test('V-ARCHIVE subset coverage handles Korean, Jamo, Kana, Han, and supplementary codepoints', () => {
  assert.equal(selectVArchiveFont('한글 ABC 123').kind, 'subset');
  assert.equal(selectVArchiveFont('ᄀᄁᄂ').kind, 'subset');
  assert.equal(selectVArchiveFont('カタカナ').kind, 'full');
  assert.equal(selectVArchiveFont('漢字').kind, 'full');
  assert.equal(selectVArchiveFont('𠀀').kind, 'full');
  assert.equal(isVArchiveSubsetCodepointSupported(0x1f600), false);
});

test('V-ARCHIVE subset and full worker renders preserve dimensions and fixture pixels', async () => {
  const fixture = '<svg width="120" height="48" viewBox="0 0 120 48"><rect width="120" height="48" fill="white"/><text x="4" y="28" font-family="Noto Sans CJK KR">한글 ABC 123</text></svg>';
  const pool = new SvgRendererPool({ size: 1, queueLimit: 8, timeoutMs: 10_000 });
  try {
    const sync = renderSvgToPng(fixture);
    const subset = await pool.render(fixture, { fontFiles: [selectVArchiveFont('한글 ABC 123').fontPath] });
    const full = await pool.render(fixture, { fontFiles: [selectVArchiveFont('漢字').fontPath] });
    for (const image of [subset, full]) {
      assert.deepEqual([image.readUInt32BE(16), image.readUInt32BE(20)], [120, 48]);
      assert.equal(createHash('sha256').update(image).digest('hex'), createHash('sha256').update(sync).digest('hex'));
    }
  } finally {
    await pool.close();
  }
});

test('SVG worker renderer rejects queued jobs when closed', async () => {
  const pool = new SvgRendererPool({ size: 1, queueLimit: 2, timeoutMs: 10_000 });
  const first = pool.render(svg);
  const second = pool.render(svg);
  const closePromise = pool.close();
  await assert.rejects(first, /SVG renderer pool is closed/);
  await assert.rejects(second, /SVG renderer pool is closed/);
  await closePromise;
});

test('SVG worker renderer timeout replaces the worker and continues queued work', async () => {
  const pool = new SvgRendererPool({ size: 1, queueLimit: 2, timeoutMs: 500 });
  try {
    const timedOut = pool.render(svg, { delayMs: 1_000 });
    const queued = pool.render(svg);
    await assert.rejects(timedOut, (error) => error.code === 'SVG_RENDER_TIMEOUT');
    const recovered = await queued;
    assert.equal(recovered.readUInt32BE(16), 32);
  } finally {
    await pool.close();
  }
});
