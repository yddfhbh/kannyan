import { bundledSvgFontFamily } from './svg-renderer.js';
import { renderSvgToPngInWorker } from './svg-renderer-pool.js';
import { selectVArchiveFont } from './varchive-font-selection.js';
import {
  buildVArchiveLevelPerformanceFocusUrl,
  createVArchiveLevelPerformanceLookup,
} from './varchive-level-performance.js';

const varchiveRequestTimeoutMs = 15_000;
const assetDataUrlCache = new Map();

export async function createVArchiveLevelPerformanceCard(
  nickname,
  difficulty,
  level,
  button,
  options = {},
) {
  const fetchImpl = resolveFetch(options.fetchImpl);
  const { performanceTrace, ...lookupOptions } = options;
  const measure = options.performanceTrace?.measure
    ? (label, operation) => options.performanceTrace.measure(label, operation)
    : async (_label, operation) => operation();
  const lookup = await measure('lookup', () => createVArchiveLevelPerformanceLookup(
    nickname,
    difficulty,
    level,
    button,
    {
      ...lookupOptions,
      fetchImpl,
    },
  ));
  const jackets = await measure('assets', () => resolveJacketDataUrls(lookup.entries, fetchImpl));
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const svg = await measure('render-svg', () => renderVArchiveLevelPerformanceCardSvg({
    lookup,
    jacketDataUrls: jackets,
    generatedAt,
  }));
  const fontSelection = selectVArchiveFont(getVArchiveLevelPerformanceTextContent({ lookup, generatedAt }));
  const renderPng = options.renderPng ?? renderSvgToPngInWorker;

  const image = await measure('render-png', () => renderPng(svg, {
    scale: 1,
    fontFiles: [fontSelection.fontPath],
  }));
  if (performanceTrace) {
    console.log(`[V-ARCHIVE][${performanceTrace.id ?? 'trace'}] renderer=worker font=${fontSelection.kind} unsupportedCodepointCount=${fontSelection.unsupportedCodepointCount}`);
    console.log(`[V-ARCHIVE][${performanceTrace.id ?? 'trace'}] render-diagnostics ${JSON.stringify(getVArchiveRenderDiagnostics(svg, lookup, jackets, image))}`);
  }

  return {
    image,
    imageFormat: 'png',
    imageContentType: 'image/png',
    nickname: lookup.nickname,
    difficulty: lookup.difficulty,
    level: lookup.level,
    floorName: lookup.floorName,
    button: lookup.button,
    focusUrl: buildVArchiveLevelPerformanceFocusUrl(lookup),
    entries: lookup.entries,
  };
}

export { renderSvgToPngInWorker };

export function getVArchiveLevelPerformanceTextContent({ lookup, generatedAt }) {
  const entries = Array.isArray(lookup?.entries) ? lookup.entries : [];
  const heading = getVArchiveLevelPerformanceHeading(lookup);
  const content = [
    heading,
    `${entries.length} patterns · PLAYER ${lookup?.nickname ?? '-'}`,
    'V-ARCHIVE archive board · compact grid',
  ];
  for (const entry of entries) {
    const songLines = wrapSongTitle(entry?.songName ?? 'Unknown Song', 16, 2);
    content.push(
      formatScoreText(entry?.scoreText),
      `${entry?.difficulty ?? '-'} ${entry?.level ?? '-'}`,
      entry?.floorName ? `V-ARCHIVE ${entry.floorName}` : '',
      ...songLines,
    );
  }
  content.push(`Generated ${formatGeneratedAt(generatedAt ?? new Date().toISOString())}`);
  return content.join('\n');
}

export function getVArchiveRenderDiagnostics(svg, lookup, jacketDataUrls = {}, png = null) {
  const svgText = String(svg ?? '');
  const width = readSvgDimension(svgText, 'width');
  const height = readSvgDimension(svgText, 'height');
  const images = [...new Set((Array.isArray(lookup?.entries) ? lookup.entries : [])
    .map((entry) => jacketDataUrls[entry?.titleId])
    .filter(Boolean))]
    .map((dataUrl) => ({
      bytes: dataUrlByteLength(dataUrl),
      ...readImageDimensions(dataUrl),
    }));
  return {
    svg: { width, height, bytes: Buffer.byteLength(svgText, 'utf8') },
    entries: Array.isArray(lookup?.entries) ? lookup.entries.length : 0,
    embeddedJackets: { count: images.length, bytes: images.reduce((sum, image) => sum + image.bytes, 0), images },
    png: readPngDimensions(png),
  };
}

export function renderVArchiveLevelPerformanceCardSvg({
  lookup,
  jacketDataUrls = {},
  generatedAt = new Date().toISOString(),
}) {
  const entries = Array.isArray(lookup?.entries) ? lookup.entries : [];
  const columns = getColumnCount(entries.length);
  const tileWidth = 164;
  const tileHeight = 264;
  const gap = 14;
  const outerPadding = 28;
  const headerHeight = 118;
  const footerHeight = 34;
  const rows = Math.max(1, Math.ceil(entries.length / columns));
  const contentWidth = columns * tileWidth + Math.max(0, columns - 1) * gap;
  const viewBoxWidth = outerPadding * 2 + contentWidth;
  const gridY = outerPadding + headerHeight;
  const contentHeight = rows * tileHeight + Math.max(0, rows - 1) * gap;
  const viewBoxHeight = outerPadding + headerHeight + contentHeight + footerHeight;
  const heading = getVArchiveLevelPerformanceHeading(lookup);
  const subheading = `${entries.length} patterns · PLAYER ${lookup?.nickname ?? '-'}`;
  const tileMarkup = entries.map((entry, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = outerPadding + column * (tileWidth + gap);
    const y = gridY + row * (tileHeight + gap);
    const jacketDataUrl = jacketDataUrls[entry.titleId] ?? null;
    return renderEntryTile({
      entry,
      jacketDataUrl,
      showVArchiveLevel: false,
      x,
      y,
      width: tileWidth,
      height: tileHeight,
    });
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${viewBoxWidth}" height="${viewBoxHeight}" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}">
  <defs>
    <style>
      text {
        font-family: ${bundledSvgFontFamily};
        letter-spacing: 0;
      }
      .heading { fill: #152033; font-size: 38px; font-weight: 900; }
      .subheading { fill: #58708a; font-size: 21px; font-weight: 700; }
      .footer { fill: #7d8797; font-size: 16px; font-weight: 700; }
      .tile { fill: rgba(255,255,255,0.92); stroke: rgba(76,104,141,0.18); stroke-width: 1.5; }
      .score { fill: #172338; font-size: 28px; font-weight: 900; }
      .emptyScore { fill: #9aa4b3; font-size: 28px; font-weight: 800; }
      .difficulty { fill: #365b91; font-size: 18px; font-weight: 900; }
      .song { fill: #243247; font-size: 18px; font-weight: 800; }
      .songSmall { fill: #243247; font-size: 16px; font-weight: 800; }
      .meta { fill: #7b8694; font-size: 15px; font-weight: 700; }
    </style>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f7fbff"/>
      <stop offset="1" stop-color="#eef3f9"/>
    </linearGradient>
    <linearGradient id="headerBg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#edf4fb" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  <rect width="${viewBoxWidth}" height="${viewBoxHeight}" fill="url(#bg)"/>
  <rect x="${outerPadding}" y="${outerPadding}" width="${contentWidth}" height="${headerHeight - 16}" rx="24" ry="24" fill="url(#headerBg)" stroke="rgba(76,104,141,0.18)"/>
  <text x="${outerPadding + 20}" y="${outerPadding + 46}" class="heading">${escapeXml(heading)}</text>
  <text x="${outerPadding + 20}" y="${outerPadding + 78}" class="subheading">${escapeXml(subheading)}</text>
  <text x="${outerPadding + 20}" y="${outerPadding + 102}" class="meta">${escapeXml('V-ARCHIVE archive board · compact grid')}</text>
  ${tileMarkup}
  <text x="${outerPadding}" y="${viewBoxHeight - 12}" class="footer">${escapeXml(`Generated ${formatGeneratedAt(generatedAt)}`)}</text>
</svg>`;
}

function getVArchiveLevelPerformanceHeading(lookup) {
  return lookup?.floorName
    ? `${lookup?.button ?? '-'}B · V-ARCHIVE ${lookup.floorName}`
    : lookup?.difficulty === 'ALL'
      ? `${lookup?.button ?? '-'}B · LEVEL ${lookup?.level ?? '-'}`
      : `${lookup?.difficulty ?? '-'} ${lookup?.level ?? '-'} · ${lookup?.button ?? '-'}B`;
}

async function resolveJacketDataUrls(entries, fetchImpl) {
  const unique = new Map();

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry?.titleId || !entry?.jacketUrl || unique.has(entry.titleId)) {
      continue;
    }

    unique.set(entry.titleId, entry.jacketUrl);
  }

  const dataUrls = await Promise.all(
    [...unique.entries()].map(async ([titleId, url]) => [titleId, await fetchAssetDataUrl(url, fetchImpl)]),
  );

  return Object.fromEntries(dataUrls);
}

function renderEntryTile({ entry, jacketDataUrl, showVArchiveLevel, x, y, width, height }) {
  const jacketSize = 124;
  const jacketX = x + Math.round((width - jacketSize) / 2);
  const jacketY = y + 46;
  const badgeWidth = 88;
  const badgeX = x + Math.round((width - badgeWidth) / 2);
  const songLines = wrapSongTitle(entry?.songName ?? 'Unknown Song', 16, 2);
  const scoreLabel = formatScoreText(entry?.scoreText);
  const levelLabel = showVArchiveLevel
    ? `V-ARCHIVE ${entry?.floorName ?? '-'}`
    : `${entry?.difficulty ?? '-'} ${entry?.level ?? '-'}`;

  return `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" ry="18" class="tile"/>
    <text x="${x + width / 2}" y="${y + 30}" text-anchor="middle" class="${scoreLabel === '-' ? 'emptyScore' : 'score'}">${escapeXml(scoreLabel)}</text>
    ${jacketDataUrl
      ? `<image href="${escapeXml(jacketDataUrl)}" x="${jacketX}" y="${jacketY}" width="${jacketSize}" height="${jacketSize}" preserveAspectRatio="none"/>`
      : `<rect x="${jacketX}" y="${jacketY}" width="${jacketSize}" height="${jacketSize}" rx="14" ry="14" fill="#d6deea"/>`}
    <rect x="${badgeX}" y="${y + 180}" width="${badgeWidth}" height="26" rx="13" ry="13" fill="#e8f1fb"/>
    <text x="${x + width / 2}" y="${y + 198}" text-anchor="middle" class="difficulty">${escapeXml(levelLabel)}</text>
    <text x="${x + width / 2}" y="${y + 216}" text-anchor="middle" class="meta">${escapeXml(entry?.floorName ? `V-ARCHIVE ${entry.floorName}` : '')}</text>
    <text x="${x + width / 2}" y="${y + 238}" text-anchor="middle" class="${songLines.some((line) => String(line).length > 14) ? 'songSmall' : 'song'}">${escapeXml(songLines[0] ?? '')}</text>
    <text x="${x + width / 2}" y="${y + 257}" text-anchor="middle" class="${songLines.some((line) => String(line).length > 14) ? 'songSmall' : 'song'}">${escapeXml(songLines[1] ?? '')}</text>
  </g>`;
}

function getColumnCount(entryCount) {
  if (entryCount >= 33) {
    return 8;
  }

  if (entryCount >= 21) {
    return 7;
  }

  if (entryCount >= 13) {
    return 6;
  }

  return Math.max(4, Math.min(5, entryCount || 4));
}

function wrapSongTitle(value, maxCharsPerLine, maxLines) {
  const text = String(value ?? '').trim();
  if (!text) {
    return ['Unknown Song', ''];
  }

  const words = text.split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxCharsPerLine) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
    }
    current = word;
    if (lines.length >= maxLines - 1) {
      break;
    }
  }

  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  const result = lines.slice(0, maxLines).map((line) => trimWithEllipsis(line, maxCharsPerLine));
  while (result.length < maxLines) {
    result.push('');
  }

  return result;
}

function trimWithEllipsis(value, maxChars) {
  const text = String(value ?? '').trim();
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function formatScoreText(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || trimmed === '-') {
    return '-';
  }

  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric)) {
    return `${trimmed}%`;
  }

  return `${numeric.toFixed(2)}%`;
}

async function fetchAssetDataUrl(url, fetchImpl) {
  if (!url) {
    return null;
  }

  if (!assetDataUrlCache.has(url)) {
    assetDataUrlCache.set(url, (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), varchiveRequestTimeoutMs);

      try {
        const response = await fetchImpl(url, {
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

  return assetDataUrlCache.get(url);
}

function resolveFetch(fetchImpl) {
  const targetFetch = fetchImpl ?? globalThis.fetch;
  if (typeof targetFetch !== 'function') {
    throw new Error('현재 실행 환경에서 fetch를 사용할 수 없다냥.');
  }

  return targetFetch;
}

function guessContentTypeFromUrl(url) {
  return String(url ?? '').toLowerCase().includes('.png')
    ? 'image/png'
    : 'image/jpeg';
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

function readSvgDimension(svg, name) {
  const match = new RegExp(`\\b${name}=["']([0-9.]+)`).exec(svg);
  return match ? Number(match[1]) : null;
}

function dataUrlByteLength(dataUrl) {
  const base64 = String(dataUrl).split(',', 2)[1] ?? '';
  return Buffer.byteLength(base64, 'base64');
}

function readImageDimensions(dataUrl) {
  const base64 = String(dataUrl).split(',', 2)[1] ?? '';
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), format: 'png' };
  }
  if (bytes.length >= 10 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1, format: 'webp' };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 9 < bytes.length;) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5), format: 'jpeg' };
      }
      offset += 2 + length;
    }
  }
  return { width: null, height: null, format: 'unknown' };
}

function readPngDimensions(png) {
  if (!Buffer.isBuffer(png) || png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), bytes: png.length };
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&apos;');
}
