import sharp from 'sharp';
import { bundledSvgFontFamily, renderSvgToPng } from './svg-renderer.js';
import { fetchVArchiveSongs } from './varchive-song.js';
import {
  buildVArchiveJacketUrl,
  findVArchiveGradeEntries,
  getVArchiveGradeEmptyMessage,
  getVArchiveGradeKey,
  normalizeVArchiveGradeButton,
  normalizeVArchiveGradeFloorName,
} from './varchive-grade.js';

const discordSafeImageBudgetBytes = 7_900_000;
const varchiveGradeRenderScale = 1;
const varchiveGradeRequestTimeoutMs = 15_000;
const varchiveGradeColumnsCompact = 8;
const varchiveGradeColumnsWide = 10;
const varchiveGradeOuterPadding = 28;
const varchiveGradeGap = 12;
const varchiveGradeTileWidth = 142;
const varchiveGradeTileHeight = 182;
const varchiveGradeJacketSize = 120;
const varchiveGradeHeaderHeight = 102;
const varchiveGradeFooterHeight = 30;
const varchiveGradeAssetDataUrlCache = new Map();
const difficultyPalette = {
  NM: { fill: '#f5b52b', text: '#2c1900' },
  HD: { fill: '#ff8c42', text: '#2b1200' },
  MX: { fill: '#ff5478', text: '#33030f' },
  SC: { fill: '#6d82ff', text: '#07113c' },
};

export async function createVArchiveGradeCard(floorName, button, options = {}) {
  const normalizedFloorName = normalizeVArchiveGradeFloorName(floorName);
  const normalizedButton = normalizeVArchiveGradeButton(button);
  const songs = Array.isArray(options.songs)
    ? options.songs
    : await fetchVArchiveSongs(options);
  const entries = findVArchiveGradeEntries(songs, normalizedFloorName, normalizedButton);

  if (entries.length === 0) {
    const error = new Error(getVArchiveGradeEmptyMessage(normalizedButton, normalizedFloorName));
    error.code = 'NO_VARCHIVE_GRADE_ENTRIES';
    error.button = normalizedButton;
    error.floorName = normalizedFloorName;
    throw error;
  }

  const fetchImpl = resolveFetch(options.fetchImpl);
  const jacketDataUrlByTitleId = await buildJacketDataUrlByTitleId(entries, fetchImpl);
  const view = buildVArchiveGradeCardView({
    floorName: normalizedFloorName,
    button: normalizedButton,
    entries,
    jacketDataUrlByTitleId,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  });
  const renderedCard = await renderVArchiveGradeCardResult(view);

  return {
    image: renderedCard.buffer,
    imageFormat: renderedCard.format,
    imageContentType: renderedCard.contentType,
    floorName: normalizedFloorName,
    button: normalizedButton,
    entries,
    entryCount: entries.length,
    view,
  };
}

export function buildVArchiveGradeCardView({
  floorName,
  button,
  entries,
  jacketDataUrlByTitleId = {},
  generatedAt,
}) {
  const normalizedFloorName = normalizeVArchiveGradeFloorName(floorName);
  const normalizedButton = normalizeVArchiveGradeButton(button);
  const safeEntries = Array.isArray(entries) ? entries : [];
  const columns = safeEntries.length >= 40 ? varchiveGradeColumnsWide : varchiveGradeColumnsCompact;
  const rows = Math.max(1, Math.ceil(Math.max(1, safeEntries.length) / columns));
  const contentWidth = columns * varchiveGradeTileWidth + Math.max(0, columns - 1) * varchiveGradeGap;
  const viewBoxWidth = varchiveGradeOuterPadding * 2 + contentWidth;
  const gridHeight = rows * varchiveGradeTileHeight + Math.max(0, rows - 1) * varchiveGradeGap;
  const viewBoxHeight = varchiveGradeOuterPadding * 2 + varchiveGradeHeaderHeight + 18 + gridHeight + varchiveGradeFooterHeight;

  return {
    floorName: normalizedFloorName,
    button: normalizedButton,
    heading: `${getVArchiveGradeKey(normalizedButton)} \uC11C\uC5F4\uD45C \u00B7 ${normalizedFloorName}`,
    entryCountText: `${safeEntries.length} patterns`,
    generatedAtText: formatGeneratedAt(generatedAt),
    columns,
    rows,
    contentWidth,
    viewBoxWidth,
    viewBoxHeight,
    gridY: varchiveGradeOuterPadding + varchiveGradeHeaderHeight + 18,
    entries: safeEntries.map((entry, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const tileX = varchiveGradeOuterPadding + column * (varchiveGradeTileWidth + varchiveGradeGap);
      const tileY = varchiveGradeOuterPadding + varchiveGradeHeaderHeight + 18 + row * (varchiveGradeTileHeight + varchiveGradeGap);
      const jacketX = tileX + Math.round((varchiveGradeTileWidth - varchiveGradeJacketSize) / 2);
      const jacketY = tileY + 10;

      return {
        ...entry,
        tileX,
        tileY,
        jacketX,
        jacketY,
        jacketDataUrl: jacketDataUrlByTitleId[String(entry.titleId ?? '')] ?? null,
        difficultyLabel: `${entry.difficulty} ${entry.level}`,
        titleLines: splitTextLines(entry.songName, 14, 2),
      };
    }),
  };
}

export async function renderVArchiveGradeCard(view) {
  const renderedCard = await renderVArchiveGradeCardResult(view);
  return renderedCard.buffer;
}

export async function renderVArchiveGradeCardResult(view) {
  const pngBuffer = await renderSvgToPng(renderVArchiveGradeCardSvg(view), {
    scale: varchiveGradeRenderScale,
  });

  if (pngBuffer.length <= discordSafeImageBudgetBytes) {
    return {
      buffer: pngBuffer,
      format: 'png',
      contentType: 'image/png',
    };
  }

  const jpegBuffer = await encodeDiscordSafeJpeg(pngBuffer);
  return {
    buffer: jpegBuffer,
    format: 'jpeg',
    contentType: 'image/jpeg',
  };
}

export function renderVArchiveGradeCardSvg(view) {
  const safeEntries = Array.isArray(view?.entries) ? view.entries : [];
  const tileMarkup = safeEntries.map((entry, index) => renderGradeTile(entry, index)).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${view.viewBoxWidth}" height="${view.viewBoxHeight}" viewBox="0 0 ${view.viewBoxWidth} ${view.viewBoxHeight}">
  <defs>
    <style>
      text {
        font-family: ${bundledSvgFontFamily};
        letter-spacing: 0;
      }
      .heading {
        fill: #102033;
        font-size: 34px;
        font-weight: 900;
      }
      .subheading {
        fill: #5f7088;
        font-size: 16px;
        font-weight: 700;
      }
      .tile {
        fill: rgba(255,255,255,0.94);
        stroke: rgba(59, 79, 107, 0.16);
        stroke-width: 1.5;
      }
      .placeholder {
        fill: #dbe5ef;
      }
      .dlcBadge {
        fill: rgba(16, 27, 43, 0.88);
      }
      .dlcText {
        fill: #f8fbff;
        font-size: 12px;
        font-weight: 900;
      }
      .title {
        fill: #182435;
        font-size: 15px;
        font-weight: 900;
      }
      .footer {
        fill: #76879d;
        font-size: 12px;
        font-weight: 700;
      }
    </style>
    <linearGradient id="gradeBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f4f8ff"/>
      <stop offset="0.55" stop-color="#eef5f2"/>
      <stop offset="1" stop-color="#fff5ec"/>
    </linearGradient>
    <pattern id="gradeDots" width="18" height="18" patternUnits="userSpaceOnUse">
      <circle cx="3" cy="3" r="1" fill="rgba(65,96,140,0.12)" />
    </pattern>
  </defs>
  <rect x="0" y="0" width="${view.viewBoxWidth}" height="${view.viewBoxHeight}" fill="url(#gradeBg)" />
  <rect x="0" y="0" width="${view.viewBoxWidth}" height="${view.viewBoxHeight}" fill="url(#gradeDots)" />
  <rect x="${varchiveGradeOuterPadding}" y="${varchiveGradeOuterPadding}" width="${view.contentWidth}" height="${varchiveGradeHeaderHeight}" rx="24" ry="24" fill="rgba(255,255,255,0.88)" stroke="rgba(68,93,123,0.12)" />
  <text x="${varchiveGradeOuterPadding + 20}" y="${varchiveGradeOuterPadding + 42}" class="heading">${escapeXml(view.heading)}</text>
  <text x="${varchiveGradeOuterPadding + 20}" y="${varchiveGradeOuterPadding + 70}" class="subheading">${escapeXml(view.entryCountText)}</text>
  <text x="${varchiveGradeOuterPadding + 20}" y="${varchiveGradeOuterPadding + 92}" class="subheading">${escapeXml('V-ARCHIVE songs.json')}</text>
  <text x="${view.viewBoxWidth - varchiveGradeOuterPadding - 2}" y="${varchiveGradeOuterPadding + 92}" text-anchor="end" class="footer">${escapeXml(`Generated ${view.generatedAtText}`)}</text>
  ${tileMarkup}
</svg>`;
}

async function buildJacketDataUrlByTitleId(entries, fetchImpl) {
  const uniqueTitleIds = [...new Set(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => String(entry?.titleId ?? '').trim())
      .filter(Boolean)
  )];
  const results = await Promise.all(
    uniqueTitleIds.map(async (titleId) => [
      titleId,
      await fetchAssetDataUrl(buildVArchiveJacketUrl(titleId), fetchImpl, {
        width: varchiveGradeJacketSize,
        height: varchiveGradeJacketSize,
        format: 'jpeg',
        quality: 72,
      }),
    ])
  );

  return Object.fromEntries(results);
}

async function fetchAssetDataUrl(url, fetchImpl, options = {}) {
  if (!url) {
    return null;
  }

  const cacheKey = JSON.stringify({
    url,
    width: options.width ?? null,
    height: options.height ?? null,
    format: options.format ?? 'jpeg',
    quality: options.quality ?? null,
  });

  if (!varchiveGradeAssetDataUrlCache.has(cacheKey)) {
    varchiveGradeAssetDataUrlCache.set(cacheKey, (async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), varchiveGradeRequestTimeoutMs);

        try {
          const response = await fetchImpl(url, {
            signal: controller.signal,
          });
          if (!response.ok) {
            return null;
          }

          const sourceBuffer = Buffer.from(await response.arrayBuffer());
          const transformedBuffer = await sharp(sourceBuffer, { failOn: 'none' })
            .resize({
              width: Number.isFinite(options.width) ? options.width : null,
              height: Number.isFinite(options.height) ? options.height : null,
              fit: 'cover',
              position: 'centre',
            })
            .jpeg({
              quality: Number.isFinite(options.quality) ? options.quality : 74,
              mozjpeg: true,
            })
            .toBuffer();

          return `data:image/jpeg;base64,${transformedBuffer.toString('base64')}`;
        } finally {
          clearTimeout(timeout);
        }
      } catch {
        return null;
      }
    })());
  }

  return varchiveGradeAssetDataUrlCache.get(cacheKey);
}

function renderGradeTile(entry, index) {
  const difficultyColors = difficultyPalette[entry.difficulty] ?? difficultyPalette.NM;
  const titleMarkup = renderTextLines({
    lines: entry.titleLines,
    x: entry.tileX + 12,
    y: entry.tileY + 150,
    lineHeight: 17,
    className: 'title',
  });
  const clipId = `grade-title-clip-${index}`;

  return `
  <g>
    <rect x="${entry.tileX}" y="${entry.tileY}" width="${varchiveGradeTileWidth}" height="${varchiveGradeTileHeight}" rx="18" ry="18" class="tile" />
    ${entry.jacketDataUrl
      ? `<image href="${escapeXml(entry.jacketDataUrl)}" x="${entry.jacketX}" y="${entry.jacketY}" width="${varchiveGradeJacketSize}" height="${varchiveGradeJacketSize}" preserveAspectRatio="none" />`
      : `<rect x="${entry.jacketX}" y="${entry.jacketY}" width="${varchiveGradeJacketSize}" height="${varchiveGradeJacketSize}" rx="14" ry="14" class="placeholder" />`}
    <rect x="${entry.jacketX + 8}" y="${entry.jacketY + 8}" width="38" height="18" rx="9" ry="9" class="dlcBadge" />
    <text x="${entry.jacketX + 27}" y="${entry.jacketY + 21}" text-anchor="middle" class="dlcText">${escapeXml(entry.dlcCode || '-')}</text>
    <rect x="${entry.jacketX + 58}" y="${entry.jacketY + 90}" width="54" height="22" rx="11" ry="11" fill="${difficultyColors.fill}" />
    <text x="${entry.jacketX + 85}" y="${entry.jacketY + 105}" text-anchor="middle" fill="${difficultyColors.text}" font-size="12" font-weight="900">${escapeXml(entry.difficultyLabel)}</text>
    <defs>
      <clipPath id="${clipId}">
        <rect x="${entry.tileX + 10}" y="${entry.tileY + 136}" width="${varchiveGradeTileWidth - 20}" height="36" />
      </clipPath>
    </defs>
    <g clip-path="url(#${clipId})">
      ${titleMarkup}
    </g>
  </g>`;
}

function renderTextLines({ lines, x, y, lineHeight, className }) {
  const safeLines = Array.isArray(lines) && lines.length > 0 ? lines : ['-'];
  return `<text x="${x}" y="${y}" class="${className}">${safeLines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join('')}</text>`;
}

function splitTextLines(value, maxUnitsPerLine, maxLines) {
  const text = String(value ?? '').trim();
  if (!text) {
    return ['-'];
  }

  const lines = [];
  let remaining = text;

  while (remaining && lines.length < maxLines) {
    if (getTextDisplayUnits(remaining) <= maxUnitsPerLine) {
      lines.push(remaining);
      remaining = '';
      break;
    }

    let breakIndex = findWrapIndexByDisplayUnits(remaining, maxUnitsPerLine);
    if (breakIndex <= 0) {
      breakIndex = Math.max(1, findHardWrapIndexByDisplayUnits(remaining, maxUnitsPerLine));
    }

    lines.push(remaining.slice(0, breakIndex).trim());
    remaining = remaining.slice(breakIndex).trimStart();
  }

  if (remaining) {
    const lastIndex = Math.max(0, lines.length - 1);
    lines[lastIndex] = truncateTextByDisplayUnits(`${lines[lastIndex]} ${remaining}`.trim(), maxUnitsPerLine);
  }

  return lines.filter(Boolean);
}

function truncateTextByDisplayUnits(value, maxUnits) {
  const text = String(value ?? '');
  if (getTextDisplayUnits(text) <= maxUnits) {
    return text;
  }

  let output = '';
  let units = 0;
  for (const character of text) {
    const characterUnits = getCharacterDisplayUnits(character);
    if (units + characterUnits > Math.max(1, maxUnits - 1)) {
      break;
    }

    output += character;
    units += characterUnits;
  }

  return `${output.trimEnd()}…`;
}

function findWrapIndexByDisplayUnits(text, maxUnits) {
  const hardIndex = findHardWrapIndexByDisplayUnits(text, maxUnits);
  if (hardIndex >= text.length) {
    return text.length;
  }

  const candidate = text.slice(0, hardIndex + 1);
  const breakIndex = candidate.lastIndexOf(' ');
  return breakIndex > 0 ? breakIndex : hardIndex;
}

function findHardWrapIndexByDisplayUnits(text, maxUnits) {
  let units = 0;
  for (let index = 0; index < text.length; index += 1) {
    units += getCharacterDisplayUnits(text[index]);
    if (units > maxUnits) {
      return index;
    }
  }

  return text.length;
}

function getTextDisplayUnits(text) {
  return [...String(text ?? '')].reduce((sum, character) => sum + getCharacterDisplayUnits(character), 0);
}

function getCharacterDisplayUnits(character) {
  if (/\s/.test(character)) {
    return 0.35;
  }

  if (/[A-Z]/.test(character)) {
    return 0.72;
  }

  if (/[a-z0-9]/.test(character)) {
    return 0.62;
  }

  if (/[()&.,'":;!?\-~]/.test(character)) {
    return 0.45;
  }

  return 1;
}

async function encodeDiscordSafeJpeg(pngBuffer) {
  const qualitySteps = [95, 93, 91, 89, 87, 85, 83];
  let fallbackBuffer = null;

  for (const quality of qualitySteps) {
    const jpegBuffer = await sharp(pngBuffer)
      .jpeg({
        quality,
        mozjpeg: true,
        chromaSubsampling: '4:4:4',
      })
      .toBuffer();
    fallbackBuffer = jpegBuffer;

    if (jpegBuffer.length <= discordSafeImageBudgetBytes) {
      return jpegBuffer;
    }
  }

  return fallbackBuffer;
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

function resolveFetch(fetchImpl) {
  const targetFetch = fetchImpl ?? globalThis.fetch;
  if (typeof targetFetch !== 'function') {
    throw new Error('Fetch is not available in the current runtime.');
  }

  return targetFetch;
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
