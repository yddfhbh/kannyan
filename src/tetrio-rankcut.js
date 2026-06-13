import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  bundledSvgFontFamily,
  renderSvgToPng,
} from './svg-renderer.js';
import {
  fetchCachedTetrioRankCutData,
  getCachedTetrioRankCutDataExpiresAt,
  getNextRankCutExpiryTime,
} from './tetrio-rankcut-cache.js';

const tetrioGameBaseUrl = 'https://tetr.io';
const tetrioHunFontUrl = `${tetrioGameBaseUrl}/res/font/hun2.ttf?v=6`;
const localHunFontPath = fileURLToPath(new URL('../assets/fonts/hun2.ttf', import.meta.url));
const tlLogoPath = fileURLToPath(new URL('../assets/tetrio-rankcut-tl-logo.png', import.meta.url));
const tetrioHeaders = {
  'User-Agent': 'discord-bot/1.0 TETR.IO rank cut',
  'X-Session-ID': 'discord-bot-tetrio-rankcut',
};
const cardFontFamily = `"HUN", ${bundledSvgFontFamily}`;
const rankOrder = [
  'x+',
  'x',
  'u',
  'ss',
  's+',
  's',
  's-',
  'a+',
  'a',
  'a-',
  'b+',
  'b',
  'b-',
  'c+',
  'c',
  'c-',
  'd+',
  'd',
  'tl',
];
const rankCardStyles = {
  'x+': { fill: '#7f1365', border: '#d66ec8', accent: '#ff87ee', shadow: '#4f0d41' },
  x: { fill: '#6f145f', border: '#c86ed5', accent: '#f88cff', shadow: '#460d3d' },
  u: { fill: '#782709', border: '#d17c51', accent: '#ffb196', shadow: '#4e1a05' },
  ss: { fill: '#9b6102', border: '#e5a94e', accent: '#ffd08f', shadow: '#684200' },
  's+': { fill: '#9c7505', border: '#ddbc46', accent: '#ffe58a', shadow: '#6b5104' },
  s: { fill: '#8d7006', border: '#d2b53b', accent: '#f6da79', shadow: '#5d4c04' },
  's-': { fill: '#7d6a08', border: '#c2ac40', accent: '#e8d775', shadow: '#574904' },
  'a+': { fill: '#126908', border: '#54c84e', accent: '#91f27d', shadow: '#0c4805' },
  a: { fill: '#0c6120', border: '#51bf65', accent: '#8ae796', shadow: '#084316' },
  'a-': { fill: '#0f5b4a', border: '#55b79c', accent: '#8ce0ca', shadow: '#093c31' },
  'b+': { fill: '#184b78', border: '#6fa0d0', accent: '#97d2ff', shadow: '#10314f' },
  b: { fill: '#24357f', border: '#7188d8', accent: '#a4b3ff', shadow: '#172252' },
  'b-': { fill: '#2c177d', border: '#7a68d0', accent: '#b29dff', shadow: '#1d1052' },
  'c+': { fill: '#30104d', border: '#8a53cf', accent: '#c899ff', shadow: '#1f0a33' },
  c: { fill: '#2a0534', border: '#974dc0', accent: '#cf9cf1', shadow: '#1a0421' },
  'c-': { fill: '#330d3d', border: '#9860b7', accent: '#d2a6ea', shadow: '#200826' },
  'd+': { fill: '#522356', border: '#9a6ca2', accent: '#c7a1cf', shadow: '#341637' },
  d: { fill: '#5a2c5d', border: '#a48aa8', accent: '#d3c5d6', shadow: '#3a1d3c' },
  tl: { fill: '#3f4349', border: '#a8acb1', accent: '#eceff3', shadow: '#272b2f' },
};
let tetrioHunFontDataUriPromise = null;
let tlLogoDataUriPromise = null;
let rankCutImageCache = null;
let rankCutImagePromise = null;
const rankIconDataUriCache = new Map();

export async function createTetrioRankCutImage() {
  const response = await fetchCachedTetrioRankCutData();
  const now = Date.now();
  if (rankCutImageCache && rankCutImageCache.expiresAt > now) {
    return rankCutImageCache.image;
  }

  if (rankCutImagePromise) {
    return rankCutImagePromise;
  }

  rankCutImagePromise = renderTetrioRankCutImage(response)
    .then((image) => {
      rankCutImageCache = {
        image,
        expiresAt: getCachedTetrioRankCutDataExpiresAt()
          || getNextRankCutExpiryTime(response.data?.t),
      };
      return image;
    })
    .finally(() => {
      rankCutImagePromise = null;
    });

  return rankCutImagePromise;
}

async function renderTetrioRankCutImage(response) {
  const payload = response.data?.data;
  if (!payload || typeof payload !== 'object') {
    throw new Error('TETR.IO league rank data is unavailable');
  }

  const cards = buildRankCards(payload);
  const [assets, hunFont] = await Promise.all([
    fetchRankAssets(cards),
    fetchTetrioHunFontDataUri(),
  ]);
  const svg = renderTetrioRankCutSvg(cards, assets, hunFont, response.data?.t);
  return renderSvgToPng(svg, {
    defaultFontFamily: 'HUN',
    fontFiles: [localHunFontPath],
  });
}

function buildRankCards(data) {
  const rankedCards = rankOrder
    .filter((rank) => rank !== 'tl')
    .map((rank) => buildRankCard(rank, data[rank]))
    .filter(Boolean);

  return [...rankedCards, buildLeagueSummaryCard(rankedCards, data.total)];
}

function buildRankCard(rank, data) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  return {
    rank,
    label: rank.toUpperCase(),
    tr: Number(data.tr),
    players: Number(data.count),
    apm: Number(data.apm),
    pps: Number(data.pps),
    vs: Number(data.vs),
    app: calculateApp(data.apm, data.pps),
    style: rankCardStyles[rank] ?? rankCardStyles.tl,
    isSummary: false,
  };
}

function buildLeagueSummaryCard(cards, totalPlayers) {
  const weightedPlayerCount = cards.reduce((sum, card) => sum + Math.max(0, card.players), 0);
  const safeTotalPlayers = Number.isFinite(totalPlayers) && totalPlayers > 0
    ? totalPlayers
    : weightedPlayerCount;

  return {
    rank: 'tl',
    label: 'TL',
    tr: 0,
    players: safeTotalPlayers,
    apm: calculateWeightedAverage(cards, 'apm', weightedPlayerCount),
    pps: calculateWeightedAverage(cards, 'pps', weightedPlayerCount),
    vs: calculateWeightedAverage(cards, 'vs', weightedPlayerCount),
    app: calculateWeightedAverage(cards, 'app', weightedPlayerCount),
    style: rankCardStyles.tl,
    isSummary: true,
  };
}

function calculateWeightedAverage(cards, key, totalPlayers) {
  if (!Number.isFinite(totalPlayers) || totalPlayers <= 0) {
    return null;
  }

  const total = cards.reduce((sum, card) => {
    if (!Number.isFinite(card[key]) || !Number.isFinite(card.players) || card.players <= 0) {
      return sum;
    }

    return sum + card[key] * card.players;
  }, 0);

  return total / totalPlayers;
}

function calculateApp(apm, pps) {
  const normalizedApm = Number(apm);
  const normalizedPps = Number(pps);
  if (!Number.isFinite(normalizedApm) || !Number.isFinite(normalizedPps) || normalizedPps <= 0) {
    return null;
  }

  return normalizedApm / (normalizedPps * 60);
}

async function fetchRankAssets(cards) {
  const iconEntries = await Promise.all(cards.map(async (card) => {
    return [card.rank, await fetchRankIconDataUri(card.rank)];
  }));

  return Object.fromEntries(iconEntries);
}

async function fetchRankIconDataUri(rank) {
  if (rank === 'tl') {
    tlLogoDataUriPromise ??= readLocalImageDataUri(tlLogoPath);
    return tlLogoDataUriPromise;
  }

  if (rankIconDataUriCache.has(rank)) {
    return rankIconDataUriCache.get(rank);
  }

  const dataUri = await fetchImageDataUri(`${tetrioGameBaseUrl}/res/league-ranks/${formatTetrioAssetPath(rank)}.png`, {
    trimTransparent: true,
  });
  if (dataUri) {
    rankIconDataUriCache.set(rank, dataUri);
  }

  return dataUri;
}

function renderTetrioRankCutSvg(cards, assets, hunFontDataUri, asOf) {
  const columns = 7;
  const cardWidth = 188;
  const cardHeight = 292;
  const gap = 16;
  const paddingX = 18;
  const paddingTop = 18;
  const paddingBottom = 18;
  const width = paddingX * 2 + columns * cardWidth + (columns - 1) * gap;
  const rows = [cards.slice(0, 7), cards.slice(7, 14), cards.slice(14, 19)];
  const height = paddingTop + rows.length * cardHeight + (rows.length - 1) * gap + paddingBottom;
  const infoPanelX = paddingX + 5 * (cardWidth + gap);
  const infoPanelY = paddingTop + 2 * (cardHeight + gap);
  const infoPanelWidth = cardWidth * 2 + gap;
  const infoPanelHeight = cardHeight;
  const asOfText = formatRankCutKst(asOf);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      ${renderFontFace(hunFontDataUri)}
      text {
        font-family: ${escapeXml(cardFontFamily)};
      }
      .rankValue {
        fill: #ffffff;
        font-size: 30.24px;
        font-weight: 900;
      }
      .rankValueUnit {
        fill: #ffffff;
        font-size: 16.065px;
        font-weight: 800;
      }
      .playersLabel {
        fill: #f1f3f5;
        font-size: 16px;
        font-weight: 800;
        letter-spacing: 0.6px;
      }
      .metricLabel {
        fill: rgba(255, 255, 255, 0.82);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.5px;
      }
      .metricValue {
        fill: #ffffff;
        font-size: 19px;
        font-weight: 800;
      }
      .infoTitle {
        fill: #f2f5f7;
        font-size: 45.9px;
        font-weight: 900;
        letter-spacing: 0.2px;
      }
      .infoValue {
        fill: #ffffff;
        font-size: 28.9px;
        font-weight: 900;
        letter-spacing: 0.2px;
      }
    </style>
    <linearGradient id="pageBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#171c20"/>
      <stop offset="1" stop-color="#0d1115"/>
    </linearGradient>
    <pattern id="pagePattern" width="64" height="64" patternUnits="userSpaceOnUse">
      <path d="M0 8 L8 0 H28 L36 8 V28 L28 36 H8 L0 28 Z" fill="rgba(255,255,255,0.035)"/>
      <path d="M40 14 L50 4 H62 V16 L50 28 H40 Z" fill="rgba(255,255,255,0.025)"/>
      <path d="M18 46 L28 36 H42 L52 46 V60 L42 70 H28 L18 60 Z" fill="rgba(255,255,255,0.02)"/>
    </pattern>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#pageBg)"/>
  <rect width="${width}" height="${height}" fill="url(#pagePattern)"/>
  ${rows.map((row, rowIndex) => row.map((card, cardIndex) => {
    const x = paddingX + cardIndex * (cardWidth + gap);
    const y = paddingTop + rowIndex * (cardHeight + gap);
    return renderRankCutCard(card, assets[card.rank], x, y, cardWidth, cardHeight);
  }).join('')).join('')}
  ${renderRankCutInfoPanel(infoPanelX, infoPanelY, infoPanelWidth, infoPanelHeight, asOfText)}
</svg>`;
}

function renderRankCutCard(card, iconDataUri, x, y, width, height) {
  const style = card.style;
  const contentTop = y + 12;
  const iconBoxY = contentTop + 2;
  const iconMarkup = card.rank === 'tl'
    ? renderTlWordmark(iconDataUri, x, iconBoxY, width)
    : renderRankIcon(iconDataUri, x, iconBoxY, width);
  const valueY = y + 148;
  const playersY = y + 176;
  const metricsY = y + 188;
  const halfWidth = width / 2;

  return `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" fill="${style.fill}" stroke="${style.border}" stroke-width="4"/>
    <rect x="${x + 4}" y="${y + 4}" width="${width - 8}" height="${height - 8}" rx="2" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
    <rect x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${height - 2}" rx="4" fill="none" stroke="${style.shadow}" stroke-width="3" opacity="0.48"/>
    ${iconMarkup}
    <text x="${x + width / 2}" y="${valueY}" text-anchor="middle" class="rankValue">${formatRankValueMarkup(card.tr)}</text>
    <text x="${x + width / 2}" y="${playersY}" text-anchor="middle" class="playersLabel">${escapeXml(formatPlayersText(card.players))}</text>
    <line x1="${x + 4}" y1="${metricsY}" x2="${x + width - 4}" y2="${metricsY}" stroke="${style.border}" stroke-width="1.5" opacity="0.95"/>
    <line x1="${x + halfWidth}" y1="${metricsY}" x2="${x + halfWidth}" y2="${y + height - 4}" stroke="${style.border}" stroke-width="1" opacity="0.72"/>
    <line x1="${x + 4}" y1="${metricsY + 50}" x2="${x + width - 4}" y2="${metricsY + 50}" stroke="${style.border}" stroke-width="1" opacity="0.72"/>
    ${renderMetricCell(x, metricsY, halfWidth, 'APM', card.apm)}
    ${renderMetricCell(x + halfWidth, metricsY, halfWidth, 'VS', card.vs)}
    ${renderMetricCell(x, metricsY + 50, halfWidth, 'PPS', card.pps)}
    ${renderMetricCell(x + halfWidth, metricsY + 50, halfWidth, 'APP', card.app)}
  </g>`;
}

function renderRankIcon(iconDataUri, x, y, width) {
  if (!iconDataUri) {
    return '';
  }

  const iconWidth = 112;
  const iconHeight = 92;
  const iconX = x + (width - iconWidth) / 2;
  return `<image href="${iconDataUri}" x="${iconX}" y="${y + 6}" width="${iconWidth}" height="${iconHeight}" preserveAspectRatio="xMidYMid meet"/>`;
}

function renderTlWordmark(iconDataUri, x, y, width) {
  if (!iconDataUri) {
    return '';
  }

  const iconWidth = 98;
  const iconHeight = 98;
  const iconX = x + (width - iconWidth) / 2;
  return `<image href="${iconDataUri}" x="${iconX}" y="${y + 1}" width="${iconWidth}" height="${iconHeight}" preserveAspectRatio="xMidYMid meet"/>`;
}

function renderRankCutInfoPanel(x, y, width, height, asOfText) {
  const centerX = x + width / 2;
  const titleFontSize = 45.9;
  const valueFontSize = 28.9;
  const textGap = 10;
  const textGroupHeight = titleFontSize + textGap + valueFontSize;
  const textGroupTop = y + (height - textGroupHeight) / 2;
  const titleCenterY = textGroupTop + titleFontSize / 2;
  const valueCenterY = textGroupTop + titleFontSize + textGap + valueFontSize / 2;
  return `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" fill="#373584" stroke="#a8acb1" stroke-width="4"/>
    <rect x="${x + 4}" y="${y + 4}" width="${width - 8}" height="${height - 8}" rx="2" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
    <rect x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${height - 2}" rx="4" fill="none" stroke="#272b2f" stroke-width="3" opacity="0.48"/>
    <text x="${centerX}" y="${titleCenterY}" text-anchor="middle" dominant-baseline="middle" class="infoTitle">Tetr. io RankCut</text>
    <text x="${centerX}" y="${valueCenterY}" text-anchor="middle" dominant-baseline="middle" class="infoValue">${escapeXml(asOfText)}</text>
  </g>`;
}

async function readLocalImageDataUri(path) {
  try {
    const buffer = await readFile(path);
    const contentType = path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

function renderMetricCell(x, y, width, label, value) {
  return `
    <text x="${x + width / 2}" y="${y + 20}" text-anchor="middle" class="metricLabel">${escapeXml(label)}</text>
    <text x="${x + width / 2}" y="${y + 42}" text-anchor="middle" class="metricValue">${escapeXml(formatMetricValue(value))}</text>
  `;
}

function formatRankValueMarkup(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }

  return `${Math.round(value).toLocaleString('en-US')}<tspan class="rankValueUnit">TR</tspan>`;
}

function formatPlayersText(value) {
  if (!Number.isFinite(value) || value < 0) {
    return '0 PLAYERS';
  }

  return `${Math.round(value).toLocaleString('en-US')} PLAYERS`;
}

function formatMetricValue(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }

  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatRankCutKst(value) {
  const timestamp = value ? new Date(value) : null;
  if (!timestamp || Number.isNaN(timestamp.getTime())) {
    return 'UNKNOWN DATE 00:00:00';
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(timestamp);
  const getPart = (type) => parts.find((part) => part.type === type)?.value ?? '';
  const year = getPart('year');
  const month = getPart('month');
  const day = getPart('day');
  const hour = getPart('hour');
  const minute = getPart('minute');
  const second = getPart('second');

  return `${year}.${month}.${day} ${hour}:${minute}:${second}`;
}

function renderFontFace(fontDataUri) {
  if (!fontDataUri) {
    return '';
  }

  return `@font-face {
    font-family: "HUN";
    src: url("${fontDataUri}") format("truetype");
    font-weight: 400 900;
    font-style: normal;
  }`;
}

function fetchTetrioHunFontDataUri() {
  tetrioHunFontDataUriPromise ??= readLocalFontDataUri(localHunFontPath)
    .then((localFont) => localFont ?? fetchFontDataUri(tetrioHunFontUrl));
  return tetrioHunFontDataUriPromise;
}

async function readLocalFontDataUri(path) {
  try {
    const buffer = await readFile(path);
    return `data:font/ttf;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

async function fetchFontDataUri(url) {
  try {
    const response = await fetch(url, { headers: tetrioHeaders });
    if (!response.ok) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:font/ttf;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

async function fetchImageDataUri(url, options = {}) {
  if (!url) {
    return null;
  }

  try {
    const response = await fetch(url, { headers: tetrioHeaders });
    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') ?? 'image/png';
    const originalBuffer = Buffer.from(await response.arrayBuffer());
    const buffer = options.trimTransparent
      ? await trimTransparentImageBuffer(originalBuffer, contentType)
      : originalBuffer;
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

async function trimTransparentImageBuffer(buffer, contentType) {
  if (!contentType.includes('png')) {
    return buffer;
  }

  try {
    return await sharp(buffer)
      .trim()
      .png()
      .toBuffer();
  } catch {
    return buffer;
  }
}

function formatTetrioAssetPath(value) {
  return String(value)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
