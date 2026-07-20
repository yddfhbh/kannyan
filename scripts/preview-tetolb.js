import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
  fetchTetolbLeaderboard,
  parseTetolbCountryOption,
} from '../src/tetrio-tetolb.js';
import { renderTetrioSvgToPng } from '../src/tetrio-font.js';
import { renderTetolbLeaderboardCardSvg } from '../src/tetrio-tetolb-renderer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultQueries = ['', 'blitz', 'blitz kr'];
const modeAliases = new Map([
  ['40l', '40l'],
  ['40line', '40l'],
  ['40lines', '40l'],
  ['fortylines', '40l'],
  ['blitz', 'blitz'],
  ['블리츠', 'blitz'],
]);

function normalizeToken(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '')
    .replace(/[()]/g, '');
}

function parseTetolbInput(input = '') {
  const trimmed = String(input ?? '').trim();

  if (!trimmed) {
    return {
      rawInput: '',
      mode: 'league',
      countryCode: null,
      label: '%tetolb',
    };
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const parsedMode = modeAliases.get(normalizeToken(tokens[0])) ?? null;
  const mode = parsedMode ?? 'league';
  const countryInput = parsedMode ? tokens.slice(1).join(' ') : trimmed;
  const parsedCountry = parseTetolbCountryOption(countryInput);

  if (parsedCountry.errorMessage) {
    throw new Error(parsedCountry.errorMessage);
  }

  return {
    rawInput: trimmed,
    mode,
    countryCode: parsedCountry.countryCode ?? null,
    label: `%tetolb${trimmed ? ` ${trimmed}` : ''}`,
  };
}

function buildOutputBasename(mode, countryCode) {
  if (mode === 'league') {
    return countryCode ? `preview-tetolb-${countryCode.toLowerCase()}` : 'preview-tetolb';
  }

  return countryCode
    ? `preview-tetolb-${mode}-${countryCode.toLowerCase()}`
    : `preview-tetolb-${mode}`;
}

function classifyFetch(url) {
  const text = String(url ?? '');

  if (text.includes('/users/by/league')) {
    return 'league leaderboard';
  }

  if (text.includes('/records/40l_')) {
    return '40l leaderboard';
  }

  if (text.includes('/records/blitz_')) {
    return 'blitz leaderboard';
  }

  if (text.includes('/summaries')) {
    return 'user summaries';
  }

  if (text.includes('/api/users/')) {
    return 'user profile';
  }

  if (text.includes('/user-content/avatars/')) {
    return 'avatar';
  }

  if (text.includes('/user-content/banners/')) {
    return 'banner';
  }

  if (text.includes('flagcdn.com/')) {
    return 'flag';
  }

  if (text.includes('/res/league-ranks/')) {
    return 'rank icon';
  }

  if (text.endsWith('/res/avatar.png')) {
    return 'default avatar';
  }

  return 'other';
}

async function withFetchTrace(fn) {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (...args) => {
    const request = args[0];
    const url = typeof request === 'string'
      ? request
      : request instanceof URL
        ? request.toString()
        : request?.url ?? String(request ?? '');
    const startedAt = performance.now();

    try {
      const response = await originalFetch(...args);
      calls.push({
        url,
        kind: classifyFetch(url),
        status: response.status,
        ok: response.ok,
        durationMs: performance.now() - startedAt,
      });
      return response;
    } catch (error) {
      calls.push({
        url,
        kind: classifyFetch(url),
        status: null,
        ok: false,
        durationMs: performance.now() - startedAt,
        error: error?.message ?? String(error),
      });
      throw error;
    }
  };

  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function summarizeFetchCalls(calls) {
  const byKind = new Map();

  for (const call of calls) {
    const current = byKind.get(call.kind) ?? {
      count: 0,
      durationMs: 0,
    };
    current.count += 1;
    current.durationMs += call.durationMs;
    byKind.set(call.kind, current);
  }

  return [...byKind.entries()]
    .map(([kind, info]) => ({
      kind,
      count: info.count,
      durationMs: info.durationMs,
    }))
    .sort((left, right) => right.durationMs - left.durationMs);
}

async function measureStage(name, fn) {
  const startedAt = performance.now();
  let result;
  let calls = [];

  await withFetchTrace(async (capturedCalls) => {
    result = await fn();
    calls = capturedCalls;
  });

  return {
    name,
    durationMs: performance.now() - startedAt,
    fetchCalls: calls,
    fetchSummary: summarizeFetchCalls(calls),
    result,
  };
}

function formatMs(value) {
  return `${value.toFixed(1)}ms`;
}

function printStage(stage) {
  const fetchSuffix = stage.fetchCalls.length > 0
    ? `, fetch ${stage.fetchCalls.length}회`
    : ', fetch 0회';
  console.log(`  - ${stage.name}: ${formatMs(stage.durationMs)}${fetchSuffix}`);

  for (const item of stage.fetchSummary) {
    console.log(`    * ${item.kind}: ${item.count}회 / ${formatMs(item.durationMs)}`);
  }
}

async function runPreview(rawInput) {
  const parsed = parseTetolbInput(rawInput);
  const basename = buildOutputBasename(parsed.mode, parsed.countryCode);
  const svgPath = path.resolve(repoRoot, `${basename}.svg`);
  const pngPath = path.resolve(repoRoot, `${basename}.png`);
  const totalStartedAt = performance.now();

  const fetchStage = await measureStage('leaderboard fetch', async () =>
    fetchTetolbLeaderboard(parsed.mode, parsed.countryCode)
  );
  const leaderboard = fetchStage.result;

  const svgStage = await measureStage('svg render', async () =>
    renderTetolbLeaderboardCardSvg({
      entries: leaderboard.entries,
      countryCode: parsed.countryCode,
      mode: parsed.mode,
    })
  );
  const svg = svgStage.result;

  const pngStage = await measureStage('png render', async () =>
    renderTetrioSvgToPng(svg, 2)
  );
  const pngBuffer = pngStage.result;

  const writeStartedAt = performance.now();
  await Promise.all([
    fs.writeFile(svgPath, svg, 'utf8'),
    fs.writeFile(pngPath, pngBuffer),
  ]);
  const writeDurationMs = performance.now() - writeStartedAt;
  const totalDurationMs = performance.now() - totalStartedAt;

  console.log('');
  console.log(`[${parsed.label}]`);
  console.log(`  mode=${parsed.mode}, country=${parsed.countryCode ?? 'global'}, entries=${leaderboard.entries.length}, leaderboardCache=${leaderboard.fromCache ? 'hit' : 'miss'}`);
  printStage(fetchStage);
  printStage(svgStage);
  printStage(pngStage);
  console.log(`  - file write: ${formatMs(writeDurationMs)}`);
  console.log(`  - total: ${formatMs(totalDurationMs)}`);
  console.log(`  - saved: ${pngPath}`);
  console.log(`  - saved: ${svgPath}`);

  return {
    label: parsed.label,
    mode: parsed.mode,
    countryCode: parsed.countryCode,
    entries: leaderboard.entries.length,
    fromCache: leaderboard.fromCache,
    paths: {
      svgPath,
      pngPath,
    },
    stages: {
      fetch: fetchStage,
      svg: svgStage,
      png: pngStage,
      writeDurationMs,
      totalDurationMs,
    },
  };
}

const args = process.argv.slice(2);
const queryInputs = args.length > 0 ? [args.join(' ')] : defaultQueries;

for (const query of queryInputs) {
  await runPreview(query);
}
