import { JSDOM } from 'jsdom';
import {
  calculateCumulativeStats,
  combineStats,
  createGraph,
  parseReplay,
  Theme,
} from 'minomuncher-core';
import { renderSvgToPng } from './svg-renderer.js';

const muncherGraphGroups = [
  ['deathAndKills', ['deaths', 'kills']],
  ['annoyingness', ['downstacking', 'attack cheesiness']],
  ['stackedBars', ['spin efficiency', 'attack per line', 'phase PPS', 'phase APM']],
];
const muncherSingleGraphTypes = [
  'clear types',
  'PPS distribution',
  'well columns',
  'attack recieved',
  'surge',
  'PPS',
];
const muncherGraphRenderConcurrency = 3;

export async function createMinomuncherAnalysis(options = {}) {
  const replayFiles = normalizeReplayFiles(options.replays);
  const gameStats = {};
  const { failedReplayFiles } = parseLocalMinomuncherReplays(replayFiles, gameStats);
  const stats = buildCumulativeStats(gameStats);

  if (Object.keys(stats).length === 0 && failedReplayFiles.length > 0) {
    const error = new Error('No replay data could be parsed');
    error.code = 'MINOMUNCHER_REPLAY_PARSE_FAILED';
    error.failedReplayFiles = failedReplayFiles;
    throw error;
  }

  const files = Object.keys(stats).length > 0
    ? await createMinomuncherGraphFiles(stats)
    : [];

  return {
    files,
    stats,
    failedReplayFiles,
  };
}

function parseLocalMinomuncherReplays(replayFiles, gameStats) {
  const failedReplayFiles = [];

  for (const replayFile of replayFiles) {
    try {
      const localPlayers = parseReplay(replayFile.content);

      if (!localPlayers || Object.keys(localPlayers).length === 0) {
        throw new Error('Replay parser returned no players');
      }

      mergePlayerGameStats(gameStats, localPlayers);
    } catch (error) {
      failedReplayFiles.push(replayFile.name);
      console.error(`Failed to parse MinoMuncher replay attachment ${replayFile.name}:`);
      console.error(error);
    }
  }

  return { failedReplayFiles };
}

function mergePlayerGameStats(gameStats, localPlayers) {
  for (const [playerId, player] of Object.entries(localPlayers)) {
    if (!gameStats[playerId]) {
      gameStats[playerId] = player;
    } else {
      combineStats(gameStats[playerId].stats, player.stats);
    }
  }
}

function buildCumulativeStats(gameStats) {
  const stats = {};
  for (const [playerId, player] of Object.entries(gameStats)) {
    stats[playerId] = {
      username: player.username,
      stats: calculateCumulativeStats(player.stats),
    };
  }

  return stats;
}

async function createMinomuncherGraphFiles(stats) {
  const graphFiles = [];

  for (const [groupName, graphTypes] of muncherGraphGroups) {
    const svgData = graphTypes.map((graphType) => createMinomuncherGraphSvg(graphType, stats));
    const svg = combineSvgData(svgData);
    graphFiles.push({
      name: `${groupName}.png`,
      svg,
    });
  }

  for (const graphType of muncherSingleGraphTypes) {
    const svg = createMinomuncherGraphSvg(graphType, stats);
    graphFiles.push({
      name: `${formatAttachmentName(graphType)}.png`,
      svg,
    });
  }

  const files = await mapWithConcurrency(
    graphFiles,
    muncherGraphRenderConcurrency,
    async ({ name, svg }) => ({
      name,
      buffer: await renderSvgData(svg),
    }),
  );

  files.push({
    name: 'rawStats.json',
    buffer: Buffer.from(JSON.stringify(stats, null, 2)),
  });

  return files;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function createMinomuncherGraphSvg(graphType, stats) {
  const dom = new JSDOM();
  const root = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(root);
  createGraph(root, graphType, stats);
  return root.innerHTML;
}

async function renderSvgData(svg) {
  return renderSvgToPng(svg, {
    background: Theme.defaultScheme?.b_med ?? '#181820',
  });
}

function combineSvgData(svgData) {
  const dom = new JSDOM();
  const document = dom.window.document;
  const root = document.createElement('div');
  const [columns] = factorClosestPair(svgData.length);
  let cursorX = 0;
  let cursorY = 0;
  let maxWidth = 0;
  let maxHeight = 0;
  let rowHeight = 0;

  const baseSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  root.appendChild(baseSvg);

  for (let index = 0; index < svgData.length; index += 1) {
    const fragment = JSDOM.fragment(svgData[index]);
    const svgElement = fragment.firstChild;
    if (!svgElement) {
      continue;
    }

    const width = Number.parseFloat(svgElement.getAttribute('width') || '0');
    const height = Number.parseFloat(svgElement.getAttribute('height') || '0');
    svgElement.setAttribute('x', String(cursorX));
    svgElement.setAttribute('y', String(cursorY));

    cursorX += width;
    maxWidth = Math.max(maxWidth, cursorX);
    rowHeight = Math.max(rowHeight, height);

    if ((index + 1) % columns === 0) {
      cursorX = 0;
      cursorY += rowHeight;
      maxHeight = Math.max(maxHeight, cursorY);
      rowHeight = 0;
    }

    baseSvg.appendChild(svgElement);
  }

  if (svgData.length % columns !== 0) {
    maxHeight = cursorY + rowHeight;
  }

  baseSvg.setAttribute('width', String(maxWidth));
  baseSvg.setAttribute('height', String(maxHeight));
  baseSvg.setAttribute('viewBox', `0 0 ${maxWidth} ${maxHeight}`);

  return root.innerHTML;
}

function factorClosestPair(value) {
  let factor = Math.floor(Math.sqrt(value));

  while (factor > 0) {
    if (value % factor === 0) {
      return [factor, value / factor];
    }

    factor -= 1;
  }

  return [1, value];
}

function normalizeReplayFiles(replays) {
  return (Array.isArray(replays) ? replays : [])
    .map((replay, index) => ({
      name: String(replay?.name ?? `replay-${index + 1}.ttrm`).trim() || `replay-${index + 1}.ttrm`,
      content: String(replay?.content ?? ''),
    }))
    .filter((replay) => replay.content);
}

function formatAttachmentName(value) {
  return String(value ?? 'graph')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'graph';
}
