import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getTetrioHunDinFontDataUri,
  renderTetrioHunDinFontFace,
  renderTetrioNumericTextMarkup,
  renderTetrioSvgToPng,
  renderTetrioTextMarkup,
  renderTetrioTextWeightCss,
  tetrioFontFamily,
} from './tetrio-font.js';

const defaultDataDir = fileURLToPath(new URL('../data/', import.meta.url));
const dataDir = resolve(
  process.env.TETRIO_LEAGUE_DATA_DIR?.trim()
    || process.env.DATA_DIR?.trim()
    || defaultDataDir
);
const assetCacheDir = join(dataDir, 'tetolb-assets');
const tetrioGameBaseUrl = 'https://tetr.io';
const tetrioContentBaseUrl = 'https://tetr.io/user-content';
const defaultAvatarUrl = `${tetrioGameBaseUrl}/res/avatar.png`;
const imageCacheTtlMs = 24 * 60 * 60 * 1000;
const imageFetchTimeoutMs = 8_000;
const imageFetchConcurrency = 5;
const supportedImageContentTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
const panelBg = '#10210f';
const panelBgAlt = '#132914';
const pageBg = '#071007';
const headerAccent = '#99dd81';
const textPrimary = '#e8f5df';
const textSecondary = '#94a893';
const lineColor = '#5d8b5c';
const levelBadgeGradients = [
  ['#C9C9C9', '#E4E4E4', '#C9C9C9', '#AEAEAE'],
  ['#FD3535', '#FF6D6D', '#FD3535', '#EB1A1A'],
  ['#F56200', '#FFA162', '#F56200', '#DF4A00'],
  ['#E9D41E', '#EDDE5F', '#E9D41E', '#CAB200'],
  ['#90DD21', '#B5F856', '#90DD21', '#73C400'],
  ['#23EE53', '#7DF89A', '#23EE53', '#0BDA33'],
  ['#22F0DA', '#8AFDF1', '#22F0DA', '#09D5BE'],
  ['#1F6CEC', '#84B2FE', '#1F6CEC', '#0950D8'],
  ['#8644FF', '#BB96FF', '#8644FF', '#6B1FF0'],
  ['#AA35AB', '#E81BEA', '#FEA4FF', '#E81BEA'],
];
const levelShapeGradients = [
  ['#C9C9C9', '#E4E4E4', '#C9C9C9'],
  ['#FD3535', '#FF6D6D', '#FD3535'],
  ['#F56200', '#FFA162', '#F56200'],
  ['#E9D41E', '#EDDE5F', '#E9D41E'],
  ['#90DD21', '#B5F856', '#90DD21'],
  ['#23EE53', '#7DF89A', '#23EE53'],
  ['#22F0DA', '#8AFDF1', '#22F0DA'],
  ['#1F6CEC', '#84B2FE', '#1F6CEC'],
  ['#8644FF', '#BB96FF', '#8644FF'],
  ['#E81BEA', '#FEA4FF', '#E81BEA'],
];

const memoryImageCache = new Map();
const pendingImageCache = new Map();
const usernameWidthCache = new Map();
let activeImageFetches = 0;
const imageFetchQueue = [];

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function normalizeCountryCode(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function formatTetrioAssetPath(value) {
  return String(value ?? '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function getFlagUrl(countryCode) {
  const normalized = normalizeCountryCode(countryCode);
  return normalized ? `https://flagcdn.com/w40/${normalized.toLowerCase()}.png` : null;
}

function getAvatarUrl(entry) {
  return entry?._id && Number(entry.avatar_revision) > 0
    ? `${tetrioContentBaseUrl}/avatars/${entry._id}.jpg?rv=${entry.avatar_revision}`
    : defaultAvatarUrl;
}

function getBannerUrl(entry) {
  return entry?._id && entry.banner_revision != null && entry.supporter
    ? `${tetrioContentBaseUrl}/banners/${entry._id}.jpg?rv=${entry.banner_revision}`
    : null;
}

function getRankIconUrl(rank) {
  const normalizedRank = String(rank ?? '').trim().toLowerCase();
  return normalizedRank
    ? `${tetrioGameBaseUrl}/res/league-ranks/${formatTetrioAssetPath(normalizedRank)}.png`
    : null;
}

function roundSvgNumber(value) {
  return Math.round(Number(value) * 100) / 100;
}

function formatPoint(point) {
  return point.map((value) => roundSvgNumber(value)).join(',');
}

function truncateName(value, maxLength = 16) {
  const text = String(value ?? '').trim().toUpperCase();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function fitUsernameToWidthFallback(value, maxWidth, maxLength = 16) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized) {
    return '';
  }

  let candidate = truncateName(normalized, maxLength);
  if (estimateUsernameWidth(candidate) <= maxWidth) {
    return candidate;
  }

  for (let length = Math.min(candidate.length, normalized.length); length >= 1; length -= 1) {
    const next = length >= normalized.length
      ? normalized
      : truncateName(normalized, Math.max(1, length));
    if (estimateUsernameWidth(next) <= maxWidth) {
      return next;
    }
  }

  return '.';
}

function formatTr(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : '0.00';
}

function estimateUsernameWidth(text, fontSize = 15.5) {
  let units = 0;

  for (const char of String(text ?? '')) {
    if ('MW@#%&'.includes(char)) {
      units += 0.92;
    } else if ('I'.includes(char)) {
      units += 0.32;
    } else if ('J1|'.includes(char)) {
      units += 0.42;
    } else if (/\d/.test(char)) {
      units += 0.56;
    } else if (char === ' ') {
      units += 0.3;
    } else if ('_-'.includes(char)) {
      units += 0.5;
    } else {
      units += 0.63;
    }
  }

  return Math.ceil(units * fontSize + 2);
}

function estimateTrWidth(text, fontSize = 16) {
  let units = 0;

  for (const char of String(text ?? '')) {
    if (/\d/.test(char)) {
      units += 0.55;
    } else if (char === '.') {
      units += 0.28;
    } else if (char === ' ') {
      units += 0.24;
    } else {
      units += 0.46;
    }
  }

  return Math.ceil(units * fontSize + 1);
}

async function measureTetolbUsernameWidth(text, fontSize = 15.5, fontWeight = 900) {
  const normalized = String(text ?? '').trim().toUpperCase();
  if (!normalized) {
    return 0;
  }

  const cacheKey = `${fontSize}|${fontWeight}|${normalized}`;
  if (usernameWidthCache.has(cacheKey)) {
    return usernameWidthCache.get(cacheKey);
  }

  // 기존 sharp 기반 실측은 50명 × 여러 후보 문자열에서 너무 무거움.
  // 약간 넉넉하게 잡아서 국기 겹침도 줄인다.
  const width = Math.ceil(estimateUsernameWidth(normalized, fontSize) * 1.04 + 3);

  usernameWidthCache.set(cacheKey, width);
  return width;
}

async function fitUsernameToWidth(value, maxWidth, maxLength = 32) {
  const normalized = String(value ?? '').trim().toUpperCase();

  if (!normalized) {
    return {
      text: '',
      width: 0,
    };
  }

  const safeMaxWidth = Math.max(1, Number(maxWidth) || 1);
  const hardMaxLength = Math.max(1, Number(maxLength) || 32);

  function makeCandidate(length) {
    const safeLength = Math.max(1, Math.floor(length));

    if (normalized.length <= safeLength) {
      return normalized;
    }

    if (safeLength <= 3) {
      return normalized.slice(0, safeLength);
    }

    return `${normalized.slice(0, safeLength - 3)}...`;
  }

  const initialText = makeCandidate(Math.min(hardMaxLength, normalized.length));
  let initialWidth = await measureTetolbUsernameWidth(initialText);

  if (initialWidth <= safeMaxWidth) {
    return {
      text: initialText,
      width: initialWidth,
    };
  }

  let low = 1;
  let high = Math.min(hardMaxLength, normalized.length);
  let bestText = normalized.slice(0, 1);
  let bestWidth = await measureTetolbUsernameWidth(bestText);

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = makeCandidate(mid);
    const width = await measureTetolbUsernameWidth(candidate);

    if (width <= safeMaxWidth) {
      bestText = candidate;
      bestWidth = width;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return {
    text: bestText,
    width: bestWidth,
  };
}

function renderTetolbDecimalNumberMarkup(value, options = {}) {
  const text = String(value ?? '');
  const dotFontSize = options.dotFontSize ?? '0.99em';
  const dotDyEm = options.dotDyEm ?? 0.02;

  let markup = '';
  let resetDyEm = 0;
  let tightenNext = false;

  for (const char of text) {
    if (char === '.') {
      markup += `<tspan dy="${dotDyEm}em" font-family="Arial" font-size="${dotFontSize}" stroke="none">.</tspan>`;
      resetDyEm = dotDyEm;
      tightenNext = false;
      continue;
    }

    const dx = tightenNext && /\d/.test(char) ? ' dx="-0.4em"' : '';
    const dy = resetDyEm ? ` dy="${roundSvgNumber(-resetDyEm)}em"` : '';

    markup += dx || dy
      ? `<tspan${dx}${dy}>${escapeXml(char)}</tspan>`
      : escapeXml(char);

    resetDyEm = 0;
    tightenNext = char === ',';
  }

  return markup;
}

function getCompactBadgeTag(value) {
  const numericValue = Number(value);
  const displayValue = Number.isFinite(numericValue) ? Math.max(0, Math.round(numericValue)) : 0;
  const text = String(displayValue);
  const width = text.length * 9 + 34;

  return {
    text,
    width,
    shape: Math.floor(displayValue / 100) % 5,
    shapeColor: Math.floor(displayValue / 10) % 10,
    badgeColor: Math.floor(displayValue / 500) % 10,
    golden: displayValue >= 5000,
    nullTag: !Number.isFinite(numericValue) || numericValue < 0,
  };
}

function renderTetolbLevelTagGradients() {
  const badgeGradients = levelBadgeGradients.map((colors, index) => `
    <linearGradient id="tetolbLevelBadge${index}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${colors[0]}"/>
      <stop offset="50%" stop-color="${colors[1]}"/>
      <stop offset="50%" stop-color="${colors[2]}"/>
      <stop offset="100%" stop-color="${colors[3]}"/>
    </linearGradient>`).join('');
  const shapeGradients = levelShapeGradients.map((colors, index) => `
    <linearGradient id="tetolbLevelShape${index}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${colors[0]}"/>
      <stop offset="50%" stop-color="${colors[1]}"/>
      <stop offset="100%" stop-color="${colors[2]}"/>
    </linearGradient>`).join('');

  return `${badgeGradients}${shapeGradients}
    <linearGradient id="tetolbLevelBadgeGolden" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#FFD800"/>
      <stop offset="50%" stop-color="#FFFFFF"/>
      <stop offset="50%" stop-color="#FF7800"/>
      <stop offset="100%" stop-color="#FFD800"/>
    </linearGradient>
    <linearGradient id="tetolbLevelShapeGolden" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#88BAD9"/>
      <stop offset="50%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#BBB5F0"/>
    </linearGradient>`;
}

function getLevelTagBodyPoints(shape, width, height, unit) {
  const leftInset = unit * 0.2;
  const bottomLeft = height - unit * 0.2;

  if (shape === 'golden') {
    return [
      [leftInset, 0],
      [width - unit * 0.7, 0],
      [width - unit * 0.35, height / 2],
      [width - unit * 0.7, height],
      [leftInset, height],
      [0, bottomLeft],
      [0, unit * 0.2],
    ].map(formatPoint).join(' ');
  }

  if (shape === 2 || shape === 3) {
    const notch = shape === 2 ? unit * 0.6 : unit * 0.5;
    return [
      [leftInset, 0],
      [width, 0],
      [width - notch, height / 2],
      [width, height],
      [leftInset, height],
      [0, bottomLeft],
      [0, unit * 0.2],
    ].map(formatPoint).join(' ');
  }

  if (shape === 4) {
    return [
      [leftInset, 0],
      [width, 0],
      [width - unit * 0.4, height * 0.3],
      [width - unit * 0.4, height * 0.7],
      [width, height],
      [leftInset, height],
      [0, bottomLeft],
      [0, unit * 0.2],
    ].map(formatPoint).join(' ');
  }

  return [
    [leftInset, 0],
    [width, 0],
    [width - unit * 0.7, height],
    [leftInset, height],
    [0, bottomLeft],
    [0, unit * 0.2],
  ].map(formatPoint).join(' ');
}

function getLevelTagItemPoints(shape, x, height, unit) {
  const points = shape === 'golden'
    ? [[0, 0], [unit * 0.3, 0], [unit * 0.65, height / 2], [unit * 0.3, height], [0, height], [unit * 0.3, height / 2]]
    : [
      [[unit * 0.7, 0], [unit, 0], [unit * 0.3, height], [0, height]],
      [[unit * 0.7, 0], [unit * 1.4, height], [0, height]],
      [[unit * 0.7, 0], [unit * 0.1, height / 2], [unit * 0.7, height], [unit * 1.3, height / 2]],
      [[unit * 0.7, 0], [unit * 0.2, height / 2], [unit * 0.7, height], [unit * 1.2, height * 0.75], [unit * 1.2, height * 0.25]],
      [[unit * 0.75, 0], [unit * 0.25, height * 0.3], [unit * 0.25, height * 0.7], [unit * 0.75, height], [unit * 1.25, height * 0.7], [unit * 1.25, height * 0.3]],
    ][shape];

  return points.map(([pointX, pointY]) => formatPoint([x + pointX, pointY])).join(' ');
}

function renderCompactLevelBadge(tag, x, y, height = 18) {
  const unit = height * 0.75;
  const bodyWidth = tag.width - unit;
  const itemX = bodyWidth - unit * 0.5;
  const fill = tag.golden ? 'url(#tetolbLevelBadgeGolden)' : (tag.nullTag ? '#111111' : `url(#tetolbLevelBadge${tag.badgeColor})`);
  const itemFill = tag.golden ? 'url(#tetolbLevelShapeGolden)' : (tag.nullTag ? '#111111' : `url(#tetolbLevelShape${tag.shapeColor})`);
  const textFill = tag.golden || tag.nullTag || [1, 7, 8, 9].includes(tag.badgeColor) ? '#ffffff' : '#111111';
  const textX = roundSvgNumber(6.5);
  const textY = roundSvgNumber(height * 0.78);
  const fontSize = roundSvgNumber(height * 0.77);

  return `
  <g transform="translate(${roundSvgNumber(x)} ${roundSvgNumber(y)})">
    <polygon points="${getLevelTagBodyPoints(tag.golden ? 'golden' : tag.shape, bodyWidth, height, unit)}" fill="${fill}" opacity="${tag.nullTag ? 0.65 : 1}"/>
    <polygon points="${getLevelTagItemPoints(tag.golden ? 'golden' : tag.shape, itemX, height, unit)}" fill="${itemFill}" opacity="${tag.nullTag ? 0.65 : 1}"/>
    <text
      x="${textX}"
      y="${textY}"
      font-size="${fontSize}"
      font-weight="950"
      fill="${textFill}"
      stroke="${textFill}"
      stroke-width="0.4"
      stroke-linejoin="round"
      paint-order="stroke fill"
      opacity="1"
    >${escapeXml(tag.text)}</text>
  </g>`;
}

function renderTetolbTitle(titleX, titleY, countryCode = null) {
  const segmentGap = 20;
  const leagueWidth = 102;
  const tetraWidth = 86;
  const suffixStartX = titleX + leagueWidth / 2 + segmentGap;

  const globalMarkup = `
  <text x="${titleX - leagueWidth / 2 - segmentGap}" y="${titleY}" text-anchor="end" class="title">${renderTetrioTextMarkup('TETRA')}</text>
  <text x="${titleX}" y="${titleY}" text-anchor="middle" class="title">${renderTetrioTextMarkup('LEAGUE')}</text>`;

  if (!countryCode) {
    return globalMarkup;
  }

  const tetraEndX = titleX - leagueWidth / 2 - segmentGap;
  const tetraStartX = tetraEndX - tetraWidth;

  return `
  <text x="${tetraStartX}" y="${titleY}" text-anchor="start" class="title">${renderTetrioTextMarkup('TETRA')}</text>
  <text x="${titleX}" y="${titleY}" text-anchor="middle" class="title">${renderTetrioTextMarkup('LEAGUE')}</text>
  <text x="${suffixStartX}" y="${titleY}" text-anchor="start" class="title countrySuffix">${renderTetrioTextMarkup(`· ${countryCode}`)}</text>`;
}

async function runWithImageFetchLimit(task) {
  if (activeImageFetches < imageFetchConcurrency) {
    activeImageFetches += 1;
    try {
      return await task();
    } finally {
      activeImageFetches -= 1;
      const next = imageFetchQueue.shift();
      if (next) {
        next();
      }
    }
  }

  return new Promise((resolve, reject) => {
    imageFetchQueue.push(() => {
      runWithImageFetchLimit(task).then(resolve, reject);
    });
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = imageFetchTimeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function getImageCachePaths(url) {
  const key = createHash('sha1').update(url).digest('hex');
  return {
    metaPath: join(assetCacheDir, `${key}.json`),
    dataPath: join(assetCacheDir, `${key}.bin`),
  };
}

async function readCachedImageDataUri(url) {
  const now = Date.now();
  const memoryCached = memoryImageCache.get(url);

  if (memoryCached && memoryCached.expiresAt > now) {
    return memoryCached.dataUri;
  }

  const { metaPath, dataPath } = getImageCachePaths(url);

  try {
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    if (!meta?.expiresAt || meta.expiresAt <= now || !meta.contentType) {
      return null;
    }

    const buffer = await fs.readFile(dataPath);
    const dataUri = `data:${meta.contentType};base64,${buffer.toString('base64')}`;
    memoryImageCache.set(url, {
      dataUri,
      expiresAt: meta.expiresAt,
    });
    return dataUri;
  } catch {
    return null;
  }
}

async function writeCachedImage(url, buffer, contentType, ttlMs = imageCacheTtlMs) {
  const expiresAt = Date.now() + ttlMs;
  const { metaPath, dataPath } = getImageCachePaths(url);

  await fs.mkdir(assetCacheDir, { recursive: true });
  await fs.writeFile(dataPath, buffer);
  await fs.writeFile(
    metaPath,
    JSON.stringify({
      url,
      contentType,
      expiresAt,
      savedAt: Date.now(),
    }, null, 2),
    'utf8'
  );

  const dataUri = `data:${contentType};base64,${buffer.toString('base64')}`;
  memoryImageCache.set(url, { dataUri, expiresAt });
  return dataUri;
}

async function fetchImageDataUri(url) {
  if (!url) {
    return null;
  }

  const cached = await readCachedImageDataUri(url);
  if (cached) {
    return cached;
  }

  if (pendingImageCache.has(url)) {
    return pendingImageCache.get(url);
  }

  const promise = runWithImageFetchLimit(async () => {
    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': 'kannyan discord bot; TETR.IO tetolb image cache',
        },
      });

      if (!response.ok) {
        return null;
      }

      const contentType = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!supportedImageContentTypes.has(contentType)) {
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      return writeCachedImage(url, buffer, contentType);
    } catch {
      return null;
    } finally {
      pendingImageCache.delete(url);
    }
  });

  pendingImageCache.set(url, promise);
  return promise;
}

async function buildAssetMap(entries) {
  const urls = new Set([defaultAvatarUrl]);

  for (const entry of entries) {
    urls.add(getAvatarUrl(entry));

    const bannerUrl = getBannerUrl(entry);
    if (bannerUrl) {
      urls.add(bannerUrl);
    }

    const flagUrl = getFlagUrl(entry.country);
    if (flagUrl) {
      urls.add(flagUrl);
    }

    const rankIconUrl = getRankIconUrl(entry?.league?.rank);
    if (rankIconUrl) {
      urls.add(rankIconUrl);
    }
  }

  const assetEntries = await Promise.all(
    [...urls].map(async (url) => [url, await fetchImageDataUri(url)])
  );

  return new Map(assetEntries);
}

function renderLeaderboardRow({
  entry,
  place,
  columnIndex,
  rowIndex,
  columnX,
  rowY,
  assets,
  usernameLayout,
}) {
  const cardX = columnX + 52;
  const cardY = rowY;
  const cardWidth = 368;
  const cardHeight = 52;
  const avatarX = cardX + 4;
  const avatarY = cardY + 1;
  const avatarSize = 50;
  const cardId = `tetolb-${columnIndex}-${rowIndex}-${place}`;
  const flagWidth = 21;
  const usernameText = usernameLayout?.text ?? truncateName(entry.username, 32);
  const rank = String(entry?.league?.rank ?? '').toLowerCase() || 'z';
  const rankLabel = String(entry?.league?.rank ?? 'z').toUpperCase();
  const glickoBadge = getCompactBadgeTag(entry?.league?.glicko);
  const tr = formatTr(entry?.league?.tr);
  const avatarDataUri = assets.get(getAvatarUrl(entry)) ?? null;
  const bannerDataUri = assets.get(getBannerUrl(entry)) ?? null;
  const flagDataUri = assets.get(getFlagUrl(entry.country)) ?? null;
  const rankIconDataUri = assets.get(getRankIconUrl(entry?.league?.rank)) ?? null;
const cardBaseFill = rowIndex % 2 === 0 ? panelBg : panelBgAlt;
const bannerOverlayOpacity = bannerDataUri ? 0.64 : 0.08;
const usernameStyle = bannerDataUri ? 'fill:#ffffff;' : '';
const trValueStyle = bannerDataUri ? 'fill:#ffffff;' : '';
  const usernameX = cardX + 60;
  const usernameY = cardY + 19;
  const badgeX = cardX + 60;
  const badgeY = cardY + 27;
  const badgeHeight = 18;
const usernameWidth = usernameLayout?.width ?? estimateUsernameWidth(usernameText);
const supporterExtraWidth = entry.supporter ? 16 : 0;
const nameFlagGap = 18;

const flagX = Math.round(usernameX + usernameWidth + supporterExtraWidth + nameFlagGap);
const flagY = cardY + 5;
  const rankX = badgeX + glickoBadge.width + 7;
  const rankY = cardY + 25;
  const rankWidth = 20;
  const rankHeight = 20;
  const trX = rankX + rankWidth + 8;
  const trY = cardY + 41;
  const trWidth = estimateTrWidth(tr);
  const trSuffixX = trX + trWidth + 2;
  const clipMarkup = [
    `<clipPath id="${cardId}-clip"><rect x="${cardX}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" rx="6"/></clipPath>`,
    `<clipPath id="${cardId}-avatar"><rect x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" rx="4"/></clipPath>`,
  ].join('');

  const bannerMarkup = bannerDataUri
    ? `<image href="${bannerDataUri}" x="${cardX}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${cardId}-clip)"/>`
    : '';
  const avatarMarkup = avatarDataUri
    ? `<image href="${avatarDataUri}" x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${cardId}-avatar)"/>`
    : `<rect x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" rx="4" fill="#29422c"/>`;
const flagMarkup = flagDataUri
  ? `<image href="${flagDataUri}" x="${flagX}" y="${flagY}" width="${flagWidth}" height="15" preserveAspectRatio="xMidYMid slice"/>`
  : '';
  const placeText = String(place);
  const placeX = columnX + (place >= 10 ? 13 : 33);

  return `
  <defs>${clipMarkup}</defs>
  <text x="${placeX}" y="${cardY + 40}" class="place">${renderTetrioNumericTextMarkup(placeText)}</text>
  <g>
    <rect x="${cardX}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" rx="6" fill="${cardBaseFill}" stroke="rgba(138,182,128,0.10)" stroke-width="1"/>
    ${bannerMarkup}
<rect x="${cardX}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" rx="6" fill="rgba(8,15,8,${bannerOverlayOpacity})"/>
    ${avatarMarkup}
    <rect x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" rx="4" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1.2"/>
    <text x="${usernameX}" y="${usernameY}" class="username"${usernameStyle ? ` style="${usernameStyle}"` : ''} xml:space="preserve">${escapeXml(usernameText)}${entry.supporter ? `<tspan dx="3.5" fill="#ff9f2e">★</tspan>` : ''}</text>
    ${flagMarkup}
    ${renderCompactLevelBadge(glickoBadge, badgeX, badgeY, badgeHeight)}
    ${rankIconDataUri
      ? `<image href="${rankIconDataUri}" x="${rankX}" y="${rankY}" width="${rankWidth}" height="${rankHeight}" preserveAspectRatio="xMidYMid meet"/>`
      : `<text x="${rankX + rankWidth / 2}" y="${trY}" text-anchor="middle" class="rankLabel">${renderTetrioTextMarkup(rankLabel)}</text>`}
    <text x="${trX}" y="${trY}" class="trValue"${trValueStyle ? ` style="${trValueStyle}"` : ''}>${renderTetolbDecimalNumberMarkup(tr)}</text>
    <text x="${trSuffixX}" y="${trY}" class="trSuffix">${renderTetrioTextMarkup('TR')}</text>
  </g>`;
}

export async function renderTetolbLeaderboardCardSvg({ entries, countryCode = null }) {
  const fontDataUri = await getTetrioHunDinFontDataUri();
  const assets = await buildAssetMap(entries);

  const width = 1344;
  const height = 1024;
  const outerPadding = 24;
  const columnGap = 18;
  const columnWidth = 420;
  const headerY = 28;
  const titleX = width / 2;
  const columnStarts = [1, 18, 35];

  const columns = [
    entries.slice(0, 17),
    entries.slice(17, 34),
    entries.slice(34, 50),
  ];

  const usernameLayouts = await Promise.all(
    entries.map(async (entry, index) => {
      const columnIndex = index < 17 ? 0 : index < 34 ? 1 : 2;
      const columnX = outerPadding + columnIndex * (columnWidth + columnGap);

      const cardX = columnX + 52;
      const cardWidth = 368;

      const usernameX = cardX + 60;
      const flagWidth = 21;
      const flagGap = 18;
      const rightPadding = 10;
      const supporterExtraWidth = entry?.supporter ? 16 : 0;

      const maxWidth =
        cardX + cardWidth
        - rightPadding
        - flagWidth
        - usernameX
        - supporterExtraWidth
        - flagGap;

      return fitUsernameToWidth(
        entry?.username,
        Math.max(40, maxWidth),
        32
      );
    })
  );

  const rowMarkup = columns.map((columnEntries, columnIndex) => {
    const columnX = outerPadding + columnIndex * (columnWidth + columnGap);
    const startRank = columnStarts[columnIndex];

    return columnEntries.map((entry, rowIndex) => {
      const rowY = 48 + rowIndex * 57;

      return renderLeaderboardRow({
        entry,
        place: startRank + rowIndex,
        columnIndex,
        rowIndex,
        columnX,
        rowY,
        assets,
        usernameLayout: usernameLayouts[startRank + rowIndex - 1],
      });
    }).join('');
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <pattern id="bgGrid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(255,255,255,0.006)" stroke-width="1"/>
    </pattern>
    ${renderTetolbLevelTagGradients()}
    <style>
      ${renderTetrioHunDinFontFace(fontDataUri)}
      text {
        font-family: ${tetrioFontFamily};
        letter-spacing: 0;
      }
      .title {
        font-size: 25px;
        font-weight: 900;
        fill: ${headerAccent};
        ${renderTetrioTextWeightCss()}
      }
      .countrySuffix {
        font-size: 21px;
      }
      .place {
        font-size: 32px;
        font-weight: 900;
        fill: #f4f7ef;
        ${renderTetrioTextWeightCss()}
      }
      .username {
        font-family: Arial, sans-serif;
        font-size: 15.5px;
        font-weight: 900;
        fill: #bde8b6;
        ${renderTetrioTextWeightCss()}
      }
      .rankLabel {
        font-size: 17px;
        font-weight: 900;
        fill: #f6f0ff;
        ${renderTetrioTextWeightCss()}
      }
      .trValue {
        font-size: 16px;
        font-weight: 900;
        fill: #d8f3d2;
        ${renderTetrioTextWeightCss()}
      }
      .trSuffix {
        font-size: 13px;
        font-weight: 900;
        fill: ${textSecondary};
      }
    </style>
  </defs>
  <rect width="${width}" height="${height}" fill="${pageBg}"/>
  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#bgGrid)"/>
  ${renderTetolbTitle(titleX, headerY, countryCode)}
  <line x1="${outerPadding}" y1="${headerY + 8}" x2="${width - outerPadding}" y2="${headerY + 8}" stroke="${lineColor}" stroke-width="1.5"/>
  <line x1="${width / 2 - 82}" y1="${headerY + 8}" x2="${width / 2 + 82}" y2="${headerY + 8}" stroke="${headerAccent}" stroke-width="3.2"/>
  ${rowMarkup}
</svg>`;
}

export async function createTetolbLeaderboardImage(options) {
  const svg = await renderTetolbLeaderboardCardSvg(options);

  const requestedScale = Number(process.env.TETOLB_RENDER_SCALE ?? '1.25');
  const renderScale = Number.isFinite(requestedScale)
    ? Math.min(1.5, Math.max(1, requestedScale))
    : 1.25;

  return renderTetrioSvgToPng(svg, renderScale);
}