import sharp from 'sharp';
import {
  getTetrioHunDinFontDataUri,
  renderTetrioHunDinFontFace,
  renderTetrioNumericTextMarkup,
  renderTetrioSvgToPng,
  renderTetrioTextMarkup,
  tetrioFontFamily,
} from './tetrio-font.js';
import { renderTetrioAchievementIconMarkup } from './tetrio-achievement-icon.js';
import {
  calculateAchievementProgress,
  getAchievementCompetitivePlace,
  getAchievementRingClipPoints,
} from './tetrio-card.js';

const tetrioApiBaseUrl = 'https://ch.tetr.io/api';
const tetrioGameBaseUrl = 'https://tetr.io';
const tetrioHeaders = {
  'User-Agent': 'discord-bot/1.0 TETR.IO achievement card',
};
const achievementIconGridSize = 8;
const achievementSummaryCacheTtlMs = 30_000;
const achievementCatalogCacheTtlMs = 21_600_000;
const achievementCatalogSeedUsers = ['pyhok', 'hebi_', 'dude', 'osk', 'toptester'];
const achievementCatalogFrontierProbeLimit = 24;
const achievementCatalogFrontierMissLimit = 8;
const achievementCatalogHighIdThreshold = 1_000;
const imageDataUriCache = new Map();
const imageDataUriPendingPromises = new Map();
const summaryCache = new Map();
const summaryPendingPromises = new Map();
const spriteCache = new Map();
const spritePendingPromises = new Map();
const achievementDefinitionCache = new Map();
const achievementDefinitionPendingPromises = new Map();
let achievementCatalogCache = null;
let achievementCatalogPendingPromise = null;
const achievementRankNames = new Map([
  [0, 'none'],
  [1, 'bronze'],
  [2, 'silver'],
  [3, 'gold'],
  [4, 'platinum'],
  [5, 'diamond'],
  [100, 'issued'],
]);
const achievementAccentPalette = new Map([
  [0, { primary: '#cbd5de', secondary: '#9ba7b3', glow: 'rgba(203,213,222,0.26)' }],
  [1, { primary: '#dfaa6a', secondary: '#ad7a42', glow: 'rgba(223,170,106,0.28)' }],
  [2, { primary: '#d7e7ee', secondary: '#9bb4bf', glow: 'rgba(215,231,238,0.28)' }],
  [3, { primary: '#ffd768', secondary: '#cb9c26', glow: 'rgba(255,215,104,0.3)' }],
  [4, { primary: '#93fff1', secondary: '#59cab8', glow: 'rgba(147,255,241,0.28)' }],
  [5, { primary: '#c6a8ff', secondary: '#7f66ef', glow: 'rgba(198,168,255,0.3)' }],
  [100, { primary: '#ffb6d8', secondary: '#ea71b2', glow: 'rgba(255,182,216,0.28)' }],
]);

export async function searchTetrioAchievements(query = '', limit = 25) {
  const achievements = await fetchTetrioAchievementCatalog();
  const normalizedQuery = normalizeAchievementSearchText(query);
  const uniqueAchievements = dedupeAchievementsByName(achievements);
  const filtered = normalizedQuery
    ? uniqueAchievements.filter((achievement) =>
      normalizeAchievementSearchText(achievement.name).includes(normalizedQuery)
      || normalizeAchievementSearchText(achievement.n).includes(normalizedQuery))
    : uniqueAchievements;

  return filtered
    .sort(compareAchievementListOrder)
    .slice(0, limit);
}

export async function createTetrioAchievementCard(username, achievementQuery) {
  const [summary, catalog] = await Promise.all([
    fetchTetrioAchievementSummary(username),
    fetchTetrioAchievementCatalog(),
  ]);
  const catalogAchievement = findBestAchievementMatch(catalog, achievementQuery);
  const summaryAchievement = catalogAchievement
    ? findAchievementByKey(summary.achievements, catalogAchievement.k) ?? findBestAchievementMatch(summary.achievements, achievementQuery)
    : findBestAchievementMatch(summary.achievements, achievementQuery);
  const achievement = summaryAchievement ?? (catalogAchievement ? createStubAchievementFromDefinition(catalogAchievement) : null);

  if (!achievement) {
    const error = new Error('Achievement not found');
    error.code = 'TETRIO_ACHIEVEMENT_NOT_FOUND';
    throw error;
  }

  const asset = await fetchAchievementAsset(achievement);
  const svg = await renderAchievementCardSvg({
    achievement: asset,
    username: summary.username,
  });

  return {
    achievementName: achievement.name,
    image: renderTetrioSvgToPng(svg, 2),
    svg,
    username: summary.username,
  };
}

async function fetchTetrioAchievementCatalog() {
  if (achievementCatalogCache && achievementCatalogCache.expiresAt > Date.now()) {
    return achievementCatalogCache.value;
  }

  if (achievementCatalogPendingPromise) {
    return achievementCatalogPendingPromise;
  }

  const promise = fetchTetrioAchievementCatalogUncached()
    .finally(() => {
      achievementCatalogPendingPromise = null;
    });
  achievementCatalogPendingPromise = promise;
  return promise;
}

async function fetchTetrioAchievementCatalogUncached() {
  const seedSummaries = await Promise.all(achievementCatalogSeedUsers.map(async (username) => {
    try {
      return await fetchTetrioAchievementSummary(username);
    } catch {
      return null;
    }
  }));
  const catalog = new Map();

  for (const summary of seedSummaries) {
    for (const achievement of summary?.achievements ?? []) {
      mergeAchievementCatalogEntry(catalog, achievement);
    }
  }

  await fillAchievementCatalogRegularRange(catalog);
  await fillAchievementCatalogFrontier(catalog, getHighestCatalogIdBelow(catalog, achievementCatalogHighIdThreshold), achievementCatalogHighIdThreshold);
  await fillAchievementCatalogHighRange(catalog);

  const value = [...catalog.values()].sort(compareAchievementListOrder);
  achievementCatalogCache = {
    expiresAt: Date.now() + achievementCatalogCacheTtlMs,
    value,
  };

  return value;
}

async function fetchTetrioAchievementSummary(username) {
  const normalizedUsername = String(username ?? '').trim();
  if (!normalizedUsername) {
    const error = new Error('TETR.IO username is required');
    error.status = 400;
    throw error;
  }

  const cached = summaryCache.get(normalizedUsername);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  if (summaryPendingPromises.has(normalizedUsername)) {
    return summaryPendingPromises.get(normalizedUsername);
  }

  const promise = fetchTetrioAchievementSummaryUncached(normalizedUsername)
    .finally(() => {
      summaryPendingPromises.delete(normalizedUsername);
    });
  summaryPendingPromises.set(normalizedUsername, promise);
  return promise;
}

async function fetchTetrioAchievementSummaryUncached(username) {
  const [userResponse, summariesResponse] = await Promise.all([
    fetch(`${tetrioApiBaseUrl}/users/${encodeURIComponent(username)}`, { headers: tetrioHeaders }),
    fetch(`${tetrioApiBaseUrl}/users/${encodeURIComponent(username)}/summaries`, { headers: tetrioHeaders }),
  ]);

  if (!userResponse.ok) {
    const error = new Error(`TETR.IO user lookup failed with ${userResponse.status}`);
    error.status = userResponse.status;
    throw error;
  }

  if (!summariesResponse.ok) {
    const error = new Error(`TETR.IO achievement summary lookup failed with ${summariesResponse.status}`);
    error.status = summariesResponse.status;
    throw error;
  }

  const userPayload = await userResponse.json();
  const summariesPayload = await summariesResponse.json();
  const value = {
    achievements: Array.isArray(summariesPayload?.data?.achievements)
      ? summariesPayload.data.achievements.filter((achievement) => !achievement?.stub && Number(achievement?.rank) !== 0)
      : [],
    username: userPayload?.data?.username ?? username,
  };

  summaryCache.set(username, {
    expiresAt: Date.now() + achievementSummaryCacheTtlMs,
    value,
  });

  return value;
}

async function fillAchievementCatalogRegularRange(catalog) {
  const highestKnownRegularId = getHighestCatalogIdBelow(catalog, achievementCatalogHighIdThreshold);
  if (!Number.isFinite(highestKnownRegularId) || highestKnownRegularId < 1) {
    return;
  }

  const missingIds = [];
  for (let id = 1; id <= highestKnownRegularId; id += 1) {
    if (!catalog.has(id)) {
      missingIds.push(id);
    }
  }

  const missingDefinitions = await Promise.all(missingIds.map((id) => fetchTetrioAchievementDefinition(id)));
  for (const definition of missingDefinitions) {
    mergeAchievementCatalogEntry(catalog, definition);
  }
}

async function fillAchievementCatalogHighRange(catalog) {
  const highIds = [...catalog.keys()]
    .filter((id) => id >= achievementCatalogHighIdThreshold)
    .sort((left, right) => left - right);

  if (highIds.length === 0) {
    return;
  }

  const highStart = highIds[0];
  const highEnd = highIds[highIds.length - 1];
  const missingIds = [];

  for (let id = highStart; id <= highEnd; id += 1) {
    if (!catalog.has(id)) {
      missingIds.push(id);
    }
  }

  const missingDefinitions = await Promise.all(missingIds.map((id) => fetchTetrioAchievementDefinition(id)));
  for (const definition of missingDefinitions) {
    mergeAchievementCatalogEntry(catalog, definition);
  }

  await fillAchievementCatalogFrontier(catalog, highEnd, Number.POSITIVE_INFINITY);
}

async function fillAchievementCatalogFrontier(catalog, startId, maxIdExclusive) {
  let currentId = Number(startId) + 1;
  let misses = 0;
  let attempts = 0;

  while (
    Number.isSafeInteger(currentId)
    && currentId > 0
    && currentId < maxIdExclusive
    && misses < achievementCatalogFrontierMissLimit
    && attempts < achievementCatalogFrontierProbeLimit
  ) {
    const definition = await fetchTetrioAchievementDefinition(currentId);
    if (definition) {
      mergeAchievementCatalogEntry(catalog, definition);
      misses = 0;
    } else {
      misses += 1;
    }

    attempts += 1;
    currentId += 1;
  }
}

async function fetchTetrioAchievementDefinition(id) {
  const normalizedId = Number(id);
  if (!Number.isSafeInteger(normalizedId) || normalizedId < 1) {
    return null;
  }

  if (achievementDefinitionCache.has(normalizedId)) {
    return achievementDefinitionCache.get(normalizedId);
  }

  if (achievementDefinitionPendingPromises.has(normalizedId)) {
    return achievementDefinitionPendingPromises.get(normalizedId);
  }

  const promise = fetchTetrioAchievementDefinitionUncached(normalizedId)
    .finally(() => {
      achievementDefinitionPendingPromises.delete(normalizedId);
    });
  achievementDefinitionPendingPromises.set(normalizedId, promise);
  return promise;
}

async function fetchTetrioAchievementDefinitionUncached(id) {
  const response = await fetch(`${tetrioApiBaseUrl}/achievements/${id}`, { headers: tetrioHeaders });
  if (response.status === 404) {
    achievementDefinitionCache.set(id, null);
    return null;
  }

  if (!response.ok) {
    const error = new Error(`TETR.IO achievement lookup failed with ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  const entry = normalizeAchievementCatalogEntry(payload?.data?.achievement);
  achievementDefinitionCache.set(id, entry);
  return entry;
}

function mergeAchievementCatalogEntry(catalog, achievement) {
  const normalized = normalizeAchievementCatalogEntry(achievement);
  if (!normalized) {
    return;
  }

  const existing = catalog.get(normalized.k);
  if (!existing) {
    catalog.set(normalized.k, normalized);
    return;
  }

  catalog.set(normalized.k, {
    ...existing,
    ...normalized,
    n: normalized.n || existing.n,
    o: Number.isFinite(Number(normalized.o)) ? Number(normalized.o) : existing.o,
  });
}

function dedupeAchievementsByName(achievements = []) {
  const seen = new Set();
  const result = [];

  for (const achievement of achievements) {
    const key = normalizeAchievementSearchText(achievement?.name);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(achievement);
  }

  return result;
}

function compareAchievementListOrder(left, right) {
  const leftOrder = Number(left?.o);
  const rightOrder = Number(right?.o);

  if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder) && leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  const leftId = Number(left?.k);
  const rightId = Number(right?.k);
  if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
    return leftId - rightId;
  }

  return String(left?.name ?? '').localeCompare(String(right?.name ?? ''), 'en', { sensitivity: 'base' });
}

function findBestAchievementMatch(achievements = [], query) {
  const normalizedQuery = normalizeAchievementSearchText(query);
  if (!normalizedQuery) {
    return null;
  }

  const exactName = achievements.find((achievement) =>
    normalizeAchievementSearchText(achievement?.name) === normalizedQuery);
  if (exactName) {
    return exactName;
  }

  const exactInternal = achievements.find((achievement) =>
    normalizeAchievementSearchText(achievement?.n) === normalizedQuery);
  if (exactInternal) {
    return exactInternal;
  }

  const prefixName = achievements.find((achievement) =>
    normalizeAchievementSearchText(achievement?.name).startsWith(normalizedQuery));
  if (prefixName) {
    return prefixName;
  }

  const substringName = achievements.find((achievement) =>
    normalizeAchievementSearchText(achievement?.name).includes(normalizedQuery)
    || normalizeAchievementSearchText(achievement?.n).includes(normalizedQuery));
  return substringName ?? null;
}

function normalizeAchievementSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim()
    .replaceAll(/\s+/g, ' ');
}

function normalizeAchievementCatalogEntry(achievement) {
  const id = Number(achievement?.k);
  const name = String(achievement?.name ?? '').trim();
  if (!Number.isSafeInteger(id) || id < 1 || !name) {
    return null;
  }

  const order = Number(achievement?.o);

  return {
    ...achievement,
    k: id,
    n: String(achievement?.n ?? name).trim() || name,
    name,
    o: Number.isFinite(order) ? order : id,
  };
}

function findAchievementByKey(achievements = [], id) {
  const normalizedId = Number(id);
  if (!Number.isSafeInteger(normalizedId)) {
    return null;
  }

  return achievements.find((achievement) => Number(achievement?.k) === normalizedId) ?? null;
}

function createStubAchievementFromDefinition(achievement) {
  return {
    ...achievement,
    art: Number.isFinite(Number(achievement?.art)) ? Number(achievement.art) : 0,
    pos: -1,
    progress: 0,
    rank: 0,
    stub: true,
    t: null,
    total: 0,
    v: 0,
    x: achievement?.x ?? {},
  };
}

function getHighestCatalogIdBelow(catalog, maxExclusive) {
  let highest = 0;

  for (const id of catalog.keys()) {
    if (id < maxExclusive && id > highest) {
      highest = id;
    }
  }

  return highest;
}

async function fetchAchievementAsset(achievement) {
  const id = Number(achievement?.k);
  const rank = Number(achievement?.rank);
  const rankName = achievementRankNames.get(rank);
  if (!Number.isSafeInteger(id) || id < 1 || !rankName) {
    return {
      ...achievement,
      progress: calculateAchievementProgress(achievement),
    };
  }

  const spriteIndex = Math.floor((id - 1) / 64);
  const tileIndex = (id - 1) % (achievementIconGridSize * achievementIconGridSize);
  const progress = calculateAchievementProgress(achievement);
  const competitivePlace = getAchievementCompetitivePlace(achievement);
  const [frame, ringPiece, wreath, icon] = await Promise.all([
    fetchImageDataUri(`${tetrioGameBaseUrl}/res/achievements/frames/${rankName}.png`),
    fetchImageDataUri(`${tetrioGameBaseUrl}/res/achievements/frames/ring-piece.png`),
    fetchImageDataUri(competitivePlace ? `${tetrioGameBaseUrl}/res/achievements/wreaths/${competitivePlace}.png` : null),
    fetchAchievementIconDataUri(spriteIndex, tileIndex, { invertRgb: rank !== 0 }),
  ]);

  return {
    ...achievement,
    competitivePlace,
    frame,
    icon,
    progress,
    ringPiece,
    wreath,
  };
}

async function fetchImageDataUri(url) {
  if (!url) {
    return null;
  }

  if (imageDataUriCache.has(url)) {
    return imageDataUriCache.get(url);
  }

  if (imageDataUriPendingPromises.has(url)) {
    return imageDataUriPendingPromises.get(url);
  }

  const promise = (async () => {
    try {
      const response = await fetch(url, { headers: tetrioHeaders });
      if (!response.ok) {
        return null;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const dataUri = `data:image/png;base64,${buffer.toString('base64')}`;
      imageDataUriCache.set(url, dataUri);
      return dataUri;
    } finally {
      imageDataUriPendingPromises.delete(url);
    }
  })();

  imageDataUriPendingPromises.set(url, promise);
  return promise;
}

async function fetchAchievementIconDataUri(spriteIndex, tileIndex, options = {}) {
  const invertRgb = Boolean(options?.invertRgb);
  const cacheKey = `achievement-icon:${spriteIndex}:${tileIndex}:${invertRgb ? 'invert' : 'plain'}`;

  if (imageDataUriCache.has(cacheKey)) {
    return imageDataUriCache.get(cacheKey);
  }

  if (imageDataUriPendingPromises.has(cacheKey)) {
    return imageDataUriPendingPromises.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const sprite = await fetchAchievementSprite(spriteIndex);
      const tileWidth = Math.floor((sprite?.width ?? 0) / achievementIconGridSize);
      const tileHeight = Math.floor((sprite?.height ?? 0) / achievementIconGridSize);

      if (tileWidth <= 0 || tileHeight <= 0) {
        return null;
      }

      const tileColumn = tileIndex % achievementIconGridSize;
      const tileRow = Math.floor(tileIndex / achievementIconGridSize);
      let image = sharp(sprite.buffer).extract({
        left: tileColumn * tileWidth,
        top: tileRow * tileHeight,
        width: tileWidth,
        height: tileHeight,
      });

      if (invertRgb) {
        image = image.negate({ alpha: false });
      }

      const buffer = await image.png().toBuffer();
      const dataUri = `data:image/png;base64,${buffer.toString('base64')}`;
      imageDataUriCache.set(cacheKey, dataUri);
      return dataUri;
    } finally {
      imageDataUriPendingPromises.delete(cacheKey);
    }
  })();

  imageDataUriPendingPromises.set(cacheKey, promise);
  return promise;
}

async function fetchAchievementSprite(spriteIndex) {
  const cacheKey = `achievement-sprite:${spriteIndex}`;
  if (spriteCache.has(cacheKey)) {
    return spriteCache.get(cacheKey);
  }

  if (spritePendingPromises.has(cacheKey)) {
    return spritePendingPromises.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const response = await fetch(`${tetrioGameBaseUrl}/res/achievements/icons/${spriteIndex}.png`, {
        headers: tetrioHeaders,
      });
      if (!response.ok) {
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(buffer).metadata();
      const result = {
        buffer,
        height: metadata.height,
        width: metadata.width,
      };
      spriteCache.set(cacheKey, result);
      return result;
    } finally {
      spritePendingPromises.delete(cacheKey);
    }
  })();

  spritePendingPromises.set(cacheKey, promise);
  return promise;
}

async function renderAchievementCardSvg({ achievement, username }) {
  const width = 760;
  const height = 214;
  const cardX = 0;
  const cardY = 0;
  const iconSize = 120;
  const iconX = 24;
  const iconY = 34;
  const contentX = 176;
  const contentRight = width - 28;
  const titleY = 44;
  const valueY = 92;
  const objectY = 124;
  const palette = achievementAccentPalette.get(Number(achievement?.rank)) ?? achievementAccentPalette.get(0);
  const valueText = formatAchievementPrimaryValue(achievement);
  const metaText = formatAchievementMeta(achievement);
  const objectText = buildAchievementObjectText(achievement);
  const objectLines = wrapAchievementText(objectText, 70, 2);
  const descriptionY = objectY + Math.max(1, objectLines.length) * 20 + 8;
  const descriptionLines = wrapAchievementText(String(achievement?.desc ?? ''), 60, 2);
  const metaX = Math.min(contentRight - 8, contentX + estimateAchievementValueWidth(valueText, 50) + 18);
  const valueFontSize = fitFontSize(valueText, 50, contentRight - contentX - 12, 28);
  const objectFontSize = fitBodyFontSize(objectText, 15, contentRight - contentX - 8, 11);
  const titleText = String(achievement?.name ?? '').toUpperCase();
  const iconMarkup = renderAchievementIcon(achievement, iconX, iconY, iconSize, 'detail');
  const fontDataUri = await getTetrioHunDinFontDataUri();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">
  <defs>
    <filter id="cardGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="10" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 1 0 0 0  0 0 0 0.22 0"/>
    </filter>
  </defs>
  <style>
    ${renderTetrioHunDinFontFace(fontDataUri)}
    text { font-family: ${tetrioFontFamily}; }
    .title {
      font-size: 22px;
      font-weight: 900;
      fill: #f6faf8;
      letter-spacing: 0.02em;
    }
    .value {
      font-size: ${roundSvgNumber(valueFontSize)}px;
      font-weight: 900;
      fill: ${palette.primary};
    }
    .meta {
      font-family: "Noto Sans CJK KR", Arial;
      font-size: 15px;
      font-weight: 700;
      fill: ${palette.secondary};
      opacity: 0.95;
    }
    .object {
      font-family: "Noto Sans CJK KR", Arial;
      font-size: 17px;
      font-weight: 700;
      fill: #f0f5f2;
    }
    .description {
      font-family: "Noto Sans CJK KR", Arial;
      font-size: 16px;
      font-style: italic;
      font-weight: 600;
      fill: #d3dbd6;
      opacity: 0.9;
    }
    .username {
      font-family: "Noto Sans CJK KR", Arial;
      font-size: 14px;
      font-weight: 700;
      fill: #89a897;
      opacity: 0.9;
    }
  </style>
  <rect x="${cardX}" y="${cardY}" width="${width}" height="${height}" rx="0" fill="#07100d"/>
  <rect x="${cardX}" y="${cardY}" width="${width}" height="${height}" fill="url(#backTint)"/>
  <defs>
    <linearGradient id="backTint" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#060f0c"/>
      <stop offset="0.42" stop-color="#101914"/>
      <stop offset="0.72" stop-color="#18211c"/>
      <stop offset="1" stop-color="#203029"/>
    </linearGradient>
    <linearGradient id="accentBand" x1="${contentX}" y1="${height}" x2="${width}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${palette.glow}"/>
      <stop offset="0.48" stop-color="${palette.secondary}33"/>
      <stop offset="1" stop-color="rgba(255,255,255,0)"/>
    </linearGradient>
  </defs>
  <rect x="${contentX - 15}" y="0" width="${width - contentX + 15}" height="${height}" fill="url(#accentBand)" opacity="0.96"/>
  <rect x="0" y="0" width="8" height="${height}" fill="${palette.primary}" opacity="0.55"/>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="none" stroke="#1d2a23" stroke-width="2"/>
  <rect x="${iconX - 8}" y="${iconY - 8}" width="${iconSize + 16}" height="${iconSize + 16}" rx="22" fill="${palette.glow}" filter="url(#cardGlow)" opacity="0.7"/>
  ${iconMarkup}
  <text x="${contentX}" y="${titleY}" class="title">${renderTetrioTextMarkup(titleText)}</text>
  <text x="${contentRight}" y="26" text-anchor="end" class="username">@${escapeXml(username)}</text>
  <text x="${contentX}" y="${valueY}" class="value">${renderTetrioNumericTextMarkup(valueText)}</text>
  ${metaText ? `<text x="${roundSvgNumber(metaX)}" y="${valueY - 3}" class="meta">${escapeXml(metaText)}</text>` : ''}
  ${objectLines.map((line, index) =>
    `<text x="${contentX}" y="${objectY + index * 18}" class="object" font-size="${roundSvgNumber(objectFontSize)}">${escapeXml(line)}</text>`).join('\n  ')}
  ${descriptionLines.map((line, index) =>
    `<text x="${contentX}" y="${descriptionY + index * 20}" class="description">${escapeXml(line)}</text>`).join('\n  ')}
</svg>`;
}

function renderAchievementIcon(achievement, x, y, size, idSuffix) {
  const clipPathId = `achievement-ring-${idSuffix}-${String(achievement?.k ?? 'unknown').replaceAll(/[^a-zA-Z0-9_-]/g, '')}`;
  const ringClipPoints = getAchievementRingClipPoints(achievement?.progress, size);
  return renderTetrioAchievementIconMarkup({
    achievement,
    clipPathId,
    fallbackCornerRadius: 16,
    ringClipPoints,
    size,
    x,
    y,
  });
}

function formatAchievementPrimaryValue(achievement) {
  if (achievement?.stub) {
    return '---';
  }

  const numericValue = Number(achievement?.v);
  const precision = Math.max(0, Math.min(3, Number(achievement?.deci) || 0));

  if (!Number.isFinite(numericValue)) {
    return 'UNLOCKED';
  }

  if (achievement?.vt === 2 || achievement?.vt === 3) {
    return formatAchievementTime(Math.abs(numericValue));
  }

  if (achievement?.vt === 4) {
    const value = Math.abs(numericValue);
    const decimals = precision > 0 ? precision : (Math.abs(value - Math.round(value)) >= 0.05 ? 1 : 0);
    return formatAchievementNumber(value, decimals);
  }

  if (achievement?.vt === 5) {
    return 'ISSUED';
  }

  return formatAchievementNumber(Math.abs(numericValue), precision);
}

function formatAchievementNumber(value, precision = 0) {
  return Number(value).toLocaleString('en-US', {
    maximumFractionDigits: precision,
    minimumFractionDigits: precision,
  });
}

function formatAchievementTime(milliseconds) {
  const totalMilliseconds = Math.max(0, Number(milliseconds) || 0);
  const totalSeconds = totalMilliseconds / 1000;

  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
  }

  return totalSeconds.toFixed(3);
}

function formatAchievementMeta(achievement) {
  if (achievement?.stub) {
    return '';
  }

  const parts = [];
  const position = Number(achievement?.pos);
  const total = Number(achievement?.total);

  if (Number.isFinite(position) && position >= 0 && Number.isFinite(total) && total > 0) {
    const percentile = Math.max(0, position / Math.max(1, total - 1) * 100);
    parts.push(`top ${percentile.toFixed(2)}%`);
    parts.push(`(#${(position + 1).toLocaleString('en-US')})`);
  }

  const dateText = formatAchievementDateWithRelative(achievement?.t);
  if (dateText) {
    parts.push(dateText);
  }

  return parts.join('  ');
}

export function formatAchievementDateWithRelative(value, now = Date.now()) {
  const dateText = formatAchievementDate(value);
  if (!dateText) {
    return '';
  }

  const daysAgoText = formatAchievementDaysAgo(value, now);
  return daysAgoText ? `${dateText} (${daysAgoText})` : dateText;
}

function buildAchievementObjectText(achievement) {
  const objectText = String(achievement?.object ?? '').trim();
  if (!objectText) {
    return 'Achievement unlocked';
  }

  return objectText;
}

function formatAchievementDate(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `${date.getUTCFullYear()}. ${date.getUTCMonth() + 1}. ${date.getUTCDate()}.`;
}

function formatAchievementDaysAgo(value, now = Date.now()) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  const current = new Date(now);
  if (Number.isNaN(date.getTime()) || Number.isNaN(current.getTime())) {
    return '';
  }

  const dayMs = 86_400_000;
  const achievementDayUtc = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  const currentDayUtc = Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate(),
  );
  const diffDays = Math.max(0, Math.floor((currentDayUtc - achievementDayUtc) / dayMs));
  return `${diffDays} days ago`;
}

function wrapAchievementText(text, maxLength, maxLines) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length <= maxLength || !currentLine) {
      currentLine = nextLine;
      continue;
    }

    lines.push(currentLine);
    currentLine = word;
    if (lines.length === maxLines - 1) {
      break;
    }
  }

  if (lines.length < maxLines && currentLine) {
    lines.push(currentLine);
  }

  if (lines.length > maxLines) {
    return lines.slice(0, maxLines);
  }

  const joinedWords = words.join(' ');
  const renderedText = lines.join(' ');
  if (lines.length === maxLines && renderedText.length < joinedWords.length) {
    const lastLine = lines[maxLines - 1];
    const remaining = joinedWords.slice(renderedText.length).trim();
    lines[maxLines - 1] = `${lastLine}${remaining ? '…' : ''}`;
  }

  return lines;
}

function estimateAchievementValueWidth(text, fontSize) {
  return [...String(text ?? '')].reduce((total, char) => total + getAchievementValueCharUnits(char) * fontSize, 0);
}

function getAchievementValueCharUnits(char) {
  if (char === ',' || char === '.') {
    return 0.22;
  }

  if (char === ':') {
    return 0.26;
  }

  if (char === '1') {
    return 0.34;
  }

  return 0.58;
}

function fitFontSize(text, preferredSize, maxWidth, minSize) {
  const estimatedWidth = estimateAchievementValueWidth(text, preferredSize);
  if (estimatedWidth <= maxWidth) {
    return preferredSize;
  }

  return Math.max(minSize, preferredSize * maxWidth / Math.max(estimatedWidth, 1));
}

function fitBodyFontSize(text, preferredSize, maxWidth, minSize) {
  const estimatedWidth = estimateBodyTextWidth(text, preferredSize);
  if (estimatedWidth <= maxWidth) {
    return preferredSize;
  }

  return Math.max(minSize, preferredSize * maxWidth / Math.max(estimatedWidth, 1));
}

function estimateBodyTextWidth(text, fontSize) {
  return [...String(text ?? '')].reduce((total, char) => total + getBodyTextCharUnits(char) * fontSize, 0);
}

function getBodyTextCharUnits(char) {
  if (char === ' ') {
    return 0.34;
  }

  if (char === '"' || char === '\'' || char === '.' || char === ',') {
    return 0.22;
  }

  if (char === '-' || char === '/' || char === ':') {
    return 0.28;
  }

  if (/[A-Z]/.test(char)) {
    return 0.62;
  }

  if (/[a-z]/.test(char)) {
    return 0.56;
  }

  if (/\d/.test(char)) {
    return 0.56;
  }

  return 0.9;
}

function roundSvgNumber(value) {
  return Number(Number(value).toFixed(2));
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
