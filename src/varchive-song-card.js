import {
  bundledSvgFontFamily,
  renderSvgToPng,
} from './svg-renderer.js';
import {
  buildVArchiveSongPageUrl,
  formatVArchiveSongDlc,
} from './varchive-song.js';

const varchiveSongCardWidth = 1400;
const varchiveSongCardOuterPadding = 24;
const varchiveSongCardRenderScale = 1;
const varchiveSongAssetTimeoutMs = 15_000;
const varchiveSongCardHeight = 806;
const varchiveSongBaseUrl = 'https://v-archive.net';
const varchiveSongJacketBaseUrl = 'https://v-archive.net/s3/images/jackets';
const varchiveKeyOrder = ['4B', '5B', '6B', '8B'];
const varchiveDifficultyOrder = ['NM', 'HD', 'MX', 'SC'];
const varchiveSongAssetDataUrlCache = new Map();
const varchiveSongGridStrokeWidth = 2;

const keyBackgroundUrls = {
  '4B': `${varchiveSongBaseUrl}/images/bg/4B-BG.png?v=knzjg`,
  '5B': `${varchiveSongBaseUrl}/images/bg/5B-BG.png?v=knzjg`,
  '6B': `${varchiveSongBaseUrl}/images/bg/6B-BG.png?v=knzjg`,
  '8B': `${varchiveSongBaseUrl}/images/bg/8B-BG.png?v=knzjg`,
};

const iconAssetUrls = {
  yellow: `${varchiveSongBaseUrl}/images/yellow_star.png?v=knzjg`,
  orange: `${varchiveSongBaseUrl}/images/orange_star.png?v=knzjg`,
  red: `${varchiveSongBaseUrl}/images/red_star.png?v=knzjg`,
  sc5: `${varchiveSongBaseUrl}/images/sc_5_star.png?v=knzjg`,
  sc10: `${varchiveSongBaseUrl}/images/sc_10_star.png?v=knzjg`,
  sc15: `${varchiveSongBaseUrl}/images/sc_15_star.png?v=knzjg`,
};

const difficultyDisplayLabels = {
  NM: 'NORMAL',
  HD: 'HARD',
  MX: 'MAXIMUM',
  SC: 'SC',
};

const difficultyPalette = {
  NM: { label: '#ffb000', value: '#ff7a18', accent: '#fff0c7' },
  HD: { label: '#ff8a00', value: '#ff5b7d', accent: '#ffe2ea' },
  MX: { label: '#ff3366', value: '#ff3e72', accent: '#ffe1ea' },
  SC: { label: '#6c63ff', value: '#4b74ff', accent: '#dfe6ff' },
};

const keyRowPalette = {
  '4B': ['#00c46a', '#11a7c7'],
  '5B': ['#0f5a88', '#73542e'],
  '6B': ['#ff9618', '#cf2d24'],
  '8B': ['#4e64d8', '#3e2057'],
};

export async function createVArchiveSongCard(song, options = {}) {
  const assets = await resolveSongCardAssets(song, options.fetchImpl);
  const svg = renderVArchiveSongCardSvg(song, {
    jacketDataUrl: assets.jacketDataUrl,
    keyBackgroundDataUrls: assets.keyBackgroundDataUrls,
    difficultyIconDataUrls: assets.difficultyIconDataUrls,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  });
  const image = renderSvgToPng(svg, { scale: varchiveSongCardRenderScale });

  return {
    image,
    imageFormat: 'png',
    imageContentType: 'image/png',
    pageUrl: buildVArchiveSongPageUrl(song),
    titleId: String(song?.title ?? ''),
    songName: String(song?.name ?? 'song'),
  };
}

export function renderVArchiveSongCardSvg(song, options = {}) {
  songCardRenderContext = {
    keyBackgroundDataUrls: options.keyBackgroundDataUrls ?? {},
    difficultyIconDataUrls: options.difficultyIconDataUrls ?? {},
  };
  const width = varchiveSongCardWidth;
  const height = varchiveSongCardHeight;
  const contentWidth = width - varchiveSongCardOuterPadding * 2;
  const contentX = varchiveSongCardOuterPadding;
  const contentY = varchiveSongCardOuterPadding;
  const headerHeight = 130;
  const tableY = contentY + headerHeight;
  const tableWidth = contentWidth;
  const keyColumnWidth = 214;
  const diffColumnWidth = Math.floor((tableWidth - keyColumnWidth) / 4);
  const diffStartX = contentX + keyColumnWidth;
  const tableHeaderHeight = 72;
  const rowHeight = 128;
  const footerY = tableY + tableHeaderHeight + rowHeight * 4 + 36;
  const songName = String(song?.name ?? 'Unknown Song');
  const composer = String(song?.composer ?? 'Unknown Composer');
  const dlcLabel = formatVArchiveSongDlc(song);
  const dlcAccent = getVArchiveDlcAccent(song?.dlcCode);
  const pageUrl = buildVArchiveSongPageUrl(song);
  const titleId = String(song?.title ?? '-');
  const jacketDataUrl = options.jacketDataUrl || null;
  const rowMarkup = varchiveKeyOrder
    .map((key, index) => renderKeyRow({
      song,
      key,
      index,
      x: contentX,
      y: tableY + tableHeaderHeight + rowHeight * index,
      keyColumnWidth,
      diffColumnWidth,
      diffStartX,
      rowHeight,
    }))
    .join('');
  const diffHeaderMarkup = varchiveDifficultyOrder
    .map((difficulty, index) => renderDifficultyHeader({
      difficulty,
      x: diffStartX + diffColumnWidth * index,
      y: tableY,
      width: diffColumnWidth,
      height: tableHeaderHeight,
    }))
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      text {
        font-family: ${bundledSvgFontFamily};
        letter-spacing: 0;
      }
      .title {
        fill: #12111a;
        font-size: 44px;
        font-weight: 900;
      }
      .subtitle {
        fill: #644f63;
        font-size: 26px;
        font-weight: 700;
      }
      .dlcBadgeText {
        fill: #ffffff;
        font-size: 20px;
        font-weight: 900;
      }
      .footer {
        fill: #7e7484;
        font-size: 18px;
        font-weight: 700;
      }
      .keyLabel {
        fill: #ffffff;
        font-size: 60px;
        font-weight: 900;
        stroke: #23314e;
        stroke-width: 2.2;
        paint-order: stroke fill;
      }
      .cellLevel {
        font-size: 46px;
        font-weight: 900;
      }
      .cellFloor {
        font-size: 23px;
        font-weight: 800;
      }
      .cellDash {
        fill: #8d8694;
        font-size: 38px;
        font-weight: 800;
      }
      .titleId {
        fill: #5f5967;
        font-size: 22px;
        font-weight: 700;
      }
    </style>
    <linearGradient id="pageBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff7fb"/>
      <stop offset="1" stop-color="#f2eef6"/>
    </linearGradient>
    <linearGradient id="headerBg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#f3e8ee"/>
      <stop offset="1" stop-color="#ede8ee"/>
    </linearGradient>
    <linearGradient id="headerGlow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="jacketClip">
      <rect x="${contentX + 10}" y="${contentY + 10}" width="92" height="92" rx="14" ry="14"/>
    </clipPath>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#pageBg)"/>
  <rect x="${contentX}" y="${contentY}" width="${contentWidth}" height="${headerHeight}" fill="url(#headerBg)" stroke="${dlcAccent.gridColor}" stroke-width="${varchiveSongGridStrokeWidth}"/>
  <rect x="${contentX + 1}" y="${contentY + 1}" width="${contentWidth - 2}" height="${headerHeight - 2}" fill="url(#headerGlow)" opacity="0.65"/>
  ${renderHeaderJacket({ contentX, contentY, jacketDataUrl })}
  <rect x="${contentX + 124}" y="${contentY + 14}" width="156" height="30" rx="8" ry="8" fill="${dlcAccent.badgeFill}"/>
  <text x="${contentX + 142}" y="${contentY + 36}" class="dlcBadgeText">${escapeXml(dlcLabel)}</text>
  <text x="${contentX + 124}" y="${contentY + 80}" class="title">${escapeXml(songName)}</text>
  <text x="${contentX + 124}" y="${contentY + 112}" class="subtitle">${escapeXml(composer)}</text>

  <rect x="${contentX}" y="${tableY}" width="${tableWidth}" height="${tableHeaderHeight + rowHeight * 4}" fill="#f6f3f7" stroke="${dlcAccent.gridColor}" stroke-width="${varchiveSongGridStrokeWidth}"/>
  ${diffHeaderMarkup}
  ${rowMarkup}
  ${renderTableGridLines({
    x: contentX,
    y: tableY,
    keyColumnWidth,
    diffStartX,
    diffColumnWidth,
    tableWidth,
    tableHeaderHeight,
    rowHeight,
    rowCount: 4,
    diffCount: 4,
    color: dlcAccent.gridColor,
    strokeWidth: varchiveSongGridStrokeWidth,
  })}

  <text x="${contentX + 6}" y="${footerY}" class="footer">${escapeXml(`V-ARCHIVE title ID: ${titleId}`)}</text>
  <text x="${contentX + contentWidth}" y="${footerY}" text-anchor="end" class="footer">${escapeXml(`Generated ${formatGeneratedAt(options.generatedAt)} · V-ARCHIVE`)}</text>
  <text x="${contentX + contentWidth}" y="${footerY + 28}" text-anchor="end" class="titleId">${escapeXml(pageUrl)}</text>
</svg>`;
}

function renderHeaderJacket({ contentX, contentY, jacketDataUrl }) {
  if (jacketDataUrl) {
    return `<image href="${escapeXml(jacketDataUrl)}" x="${contentX + 10}" y="${contentY + 10}" width="92" height="92" preserveAspectRatio="xMidYMid slice" clip-path="url(#jacketClip)"/>`;
  }

  return `<rect x="${contentX + 10}" y="${contentY + 10}" width="92" height="92" rx="14" ry="14" fill="#d8d3da" stroke="#baadb7" stroke-width="1.5"/>`;
}

function renderDifficultyHeader({ difficulty, x, y, width, height }) {
  const palette = difficultyPalette[difficulty];
  return `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#fbfafc"/>
  <text x="${x + width / 2}" y="${y + 46}" text-anchor="middle" fill="${palette.label}" font-size="30" font-weight="900">${escapeXml(difficultyDisplayLabels[difficulty] ?? difficulty)}</text>`;
}

function renderKeyRow({ song, key, index, x, y, keyColumnWidth, diffColumnWidth, diffStartX, rowHeight }) {
  const [startColor, endColor] = keyRowPalette[key] ?? ['#4c5968', '#20242a'];
  const keyBackgroundDataUrl = songCardRenderContext.keyBackgroundDataUrls?.[key] ?? null;
  const difficultyCells = varchiveDifficultyOrder
    .map((difficulty, difficultyIndex) => renderDifficultyCell({
      pattern: song?.patterns?.[key]?.[difficulty],
      difficulty,
      x: diffStartX + diffColumnWidth * difficultyIndex,
      y,
      width: diffColumnWidth,
      height: rowHeight,
    }))
    .join('');

  return `
  <defs>
    <linearGradient id="keyGradient${index}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${startColor}"/>
      <stop offset="1" stop-color="${endColor}"/>
    </linearGradient>
  </defs>
  ${keyBackgroundDataUrl
    ? `<defs>
        <clipPath id="keyCellClip${index}">
          <rect x="${x}" y="${y}" width="${keyColumnWidth}" height="${rowHeight}"/>
        </clipPath>
      </defs>
      <g clip-path="url(#keyCellClip${index})">
        <image href="${escapeXml(keyBackgroundDataUrl)}" x="${x - 10}" y="${y}" width="${keyColumnWidth + 82}" height="${rowHeight}" preserveAspectRatio="xMinYMid slice"/>
      </g>`
    : `<rect x="${x}" y="${y}" width="${keyColumnWidth}" height="${rowHeight}" fill="url(#keyGradient${index})"/>`}
  ${keyBackgroundDataUrl ? '' : `<circle cx="${x + 52}" cy="${y + 36}" r="16" fill="#ffffff" fill-opacity="0.18"/>
  <circle cx="${x + 80}" cy="${y + 78}" r="22" fill="#ffffff" fill-opacity="0.12"/>`}
  <text x="${x + keyColumnWidth / 2}" y="${y + 82}" text-anchor="middle" class="keyLabel">${escapeXml(key)}</text>
  ${difficultyCells}`;
}

function renderDifficultyCell({ pattern, difficulty, x, y, width, height }) {
  const iconInfo = getDifficultyIconInfo(pattern, difficulty);
  const palette = difficultyPalette[difficulty] ?? difficultyPalette.NM;
  const iconDataUrl = iconInfo?.iconKey
    ? songCardRenderContext.difficultyIconDataUrls?.[iconInfo.iconKey] ?? null
    : null;
  if (!pattern || !Number.isFinite(Number(pattern.level))) {
    return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#f8f4f8"/>
    <text x="${x + width / 2}" y="${y + 77}" text-anchor="middle" class="cellDash">-</text>`;
  }

  const level = String(Number(pattern.level));
  const floor = String(pattern.floorName ?? '').trim();
  const levelColor = iconInfo?.textColor ?? palette.value;
  const iconSize = 28;
  const contentWidth = floor ? 170 : 88;
  const contentStartX = x + (width - contentWidth) / 2;
  const iconY = y + 49;
  const levelX = contentStartX + (iconDataUrl ? iconSize + 8 : 0);

  return `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#f8f4f8"/>
  ${iconDataUrl
    ? `<image href="${escapeXml(iconDataUrl)}" x="${contentStartX}" y="${iconY}" width="${iconSize}" height="${iconSize}" preserveAspectRatio="xMidYMid meet"/>`
    : ''}
  <text x="${levelX}" y="${y + 79}" fill="${levelColor}">
    <tspan class="cellLevel">${escapeXml(level)}</tspan>${floor ? `<tspan dx="8" class="cellFloor">(${escapeXml(floor)}F)</tspan>` : ''}
  </text>`;
}

function renderTableGridLines({
  x,
  y,
  keyColumnWidth,
  diffStartX,
  diffColumnWidth,
  tableWidth,
  tableHeaderHeight,
  rowHeight,
  rowCount,
  diffCount,
  color,
  strokeWidth,
}) {
  const verticalLines = Array.from({ length: diffCount - 1 }, (_, index) => {
    const lineX = diffStartX + diffColumnWidth * (index + 1);
    return `<line x1="${lineX}" y1="${y}" x2="${lineX}" y2="${y + tableHeaderHeight + rowHeight * rowCount}" stroke="${color}" stroke-width="${strokeWidth}"/>`;
  }).join('');
  const horizontalLines = Array.from({ length: rowCount }, (_, index) => {
    const lineY = y + tableHeaderHeight + rowHeight * index;
    return `<line x1="${x}" y1="${lineY}" x2="${x + tableWidth}" y2="${lineY}" stroke="${color}" stroke-width="${strokeWidth}"/>`;
  }).join('');
  const keyDivider = `<line x1="${x + keyColumnWidth}" y1="${y}" x2="${x + keyColumnWidth}" y2="${y + tableHeaderHeight + rowHeight * rowCount}" stroke="${color}" stroke-width="${strokeWidth}"/>`;

  return `${keyDivider}${verticalLines}${horizontalLines}`;
}

async function resolveSongCardAssets(song, fetchImpl) {
  const difficultyIconKeys = new Set();
  for (const key of varchiveKeyOrder) {
    for (const difficulty of varchiveDifficultyOrder) {
      const iconInfo = getDifficultyIconInfo(song?.patterns?.[key]?.[difficulty], difficulty);
      if (iconInfo?.iconKey) {
        difficultyIconKeys.add(iconInfo.iconKey);
      }
    }
  }

  const keyBackgroundEntries = await Promise.all(
    Object.entries(keyBackgroundUrls).map(async ([key, url]) => [
      key,
      await fetchAssetDataUrl(url, fetchImpl),
    ])
  );
  const iconEntries = await Promise.all(
    [...difficultyIconKeys].map(async (iconKey) => [
      iconKey,
      await fetchAssetDataUrl(iconAssetUrls[iconKey], fetchImpl),
    ])
  );

  return {
    jacketDataUrl: await fetchJacketDataUrl(song, fetchImpl),
    keyBackgroundDataUrls: Object.fromEntries(keyBackgroundEntries),
    difficultyIconDataUrls: Object.fromEntries(iconEntries),
  };
}

async function fetchJacketDataUrl(song, fetchImpl) {
  const titleId = encodeURIComponent(String(song?.title ?? '').trim());
  if (!titleId) {
    return null;
  }

  return fetchAssetDataUrl(`${varchiveSongJacketBaseUrl}/${titleId}.jpg`, fetchImpl);
}

async function fetchAssetDataUrl(url, fetchImpl) {
  if (!url) {
    return null;
  }

  if (!varchiveSongAssetDataUrlCache.has(url)) {
    varchiveSongAssetDataUrlCache.set(url, (async () => {
      const targetFetch = resolveFetch(fetchImpl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), varchiveSongAssetTimeoutMs);

      try {
        const response = await targetFetch(url, {
          signal: controller.signal,
        });
        if (!response.ok) {
          return null;
        }

        const contentType = response.headers.get('content-type') || guessContentTypeFromUrl(url);
        const buffer = Buffer.from(await response.arrayBuffer());
        return `data:${contentType};base64,${buffer.toString('base64')}`;
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    })());
  }

  return varchiveSongAssetDataUrlCache.get(url);
}

function resolveFetch(fetchImpl) {
  const targetFetch = fetchImpl ?? globalThis.fetch;
  if (typeof targetFetch !== 'function') {
    throw new Error('현재 실행 환경에서 fetch를 사용할 수 없다냥.');
  }

  return targetFetch;
}

function guessContentTypeFromUrl(url) {
  const lowered = String(url ?? '').toLowerCase();
  if (lowered.endsWith('.svg')) {
    return 'image/svg+xml';
  }

  if (lowered.endsWith('.png') || lowered.includes('.png?')) {
    return 'image/png';
  }

  return 'image/jpeg';
}

function getDifficultyIconInfo(pattern, difficulty) {
  const level = Number(pattern?.level);
  if (!Number.isFinite(level)) {
    return null;
  }

  if (difficulty === 'SC') {
    if (level <= 5) {
      return { iconKey: 'sc5', textColor: '#df0074' };
    }

    if (level <= 10) {
      return { iconKey: 'sc10', textColor: '#c604e4' };
    }

    return { iconKey: 'sc15', textColor: '#3d66ff' };
  }

  if (level <= 5) {
    return { iconKey: 'yellow', textColor: '#f7b401' };
  }

  if (level <= 10) {
    return { iconKey: 'orange', textColor: '#f95b08' };
  }

  return { iconKey: 'red', textColor: '#f30253' };
}

function getVArchiveDlcAccent(dlcCode) {
  const code = String(dlcCode ?? '').trim().toUpperCase();
  const accentMap = [
    { match: /^(?:VE|VE2|VE3|VE4|VE5|R|RV)$/, badgeFill: '#a10f1e', gridColor: '#c43345' },
    { match: /^(?:VL|VL2|VL3|VL4|VL5)$/, badgeFill: '#1c7c55', gridColor: '#31976d' },
    { match: /^(?:T1|T2|T3|TEK)$/, badgeFill: '#0b7a86', gridColor: '#2d98a3' },
    { match: /^(?:P1|P2|P3|PLI1|PLI2|PLI3)$/, badgeFill: '#c56d00', gridColor: '#da8c28' },
    { match: /^(?:TR|CE|BS)$/, badgeFill: '#7a244d', gridColor: '#a24f75' },
    { match: /^(?:ES|EZ2|ESTI|MAP|NXN|FAL|CP|CY|CHU|BA|ARC|GG|GF|GC|DM|MD|OGK|TQ)$/, badgeFill: '#6b3e88', gridColor: '#8b63a5' },
  ];

  const matched = accentMap.find((entry) => entry.match.test(code));
  if (matched) {
    return {
      badgeFill: matched.badgeFill,
      gridColor: matched.gridColor,
    };
  }

  return {
    badgeFill: '#7b303f',
    gridColor: '#b16070',
  };
}

function formatGeneratedAt(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${mapped.year}-${mapped.month}-${mapped.day} ${mapped.hour}:${mapped.minute} KST`;
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

let songCardRenderContext = {
  keyBackgroundDataUrls: {},
  difficultyIconDataUrls: {},
};
