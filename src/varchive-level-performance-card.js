import {
  bundledSvgFontFamily,
  renderSvgToPng,
} from './svg-renderer.js';
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
  const lookup = await createVArchiveLevelPerformanceLookup(
    nickname,
    difficulty,
    level,
    button,
    {
      ...options,
      fetchImpl,
    },
  );
  const jackets = await resolveJacketDataUrls(lookup.entries, fetchImpl);
  const svg = renderVArchiveLevelPerformanceCardSvg({
    lookup,
    jacketDataUrls: jackets,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  });

  return {
    image: renderSvgToPng(svg, { scale: 1 }),
    imageFormat: 'png',
    imageContentType: 'image/png',
    nickname: lookup.nickname,
    difficulty: lookup.difficulty,
    level: lookup.level,
    button: lookup.button,
    focusUrl: buildVArchiveLevelPerformanceFocusUrl(lookup),
    entries: lookup.entries,
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
  const tileHeight = 238;
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
  const heading = `${lookup?.difficulty ?? '-'} ${lookup?.level ?? '-'} · ${lookup?.button ?? '-'}B`;
  const subheading = `${entries.length} patterns · PLAYER ${lookup?.nickname ?? '-'}`;
  const tileMarkup = entries.map((entry, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = outerPadding + column * (tileWidth + gap);
    const y = gridY + row * (tileHeight + gap);
    const jacketDataUrl = jacketDataUrls[entry.titleId] ?? null;
    return renderEntryTile({ entry, jacketDataUrl, x, y, width: tileWidth, height: tileHeight });
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

function renderEntryTile({ entry, jacketDataUrl, x, y, width, height }) {
  const jacketSize = 124;
  const jacketX = x + Math.round((width - jacketSize) / 2);
  const jacketY = y + 46;
  const badgeWidth = 88;
  const badgeX = x + Math.round((width - badgeWidth) / 2);
  const songLines = wrapSongTitle(entry?.songName ?? 'Unknown Song', 16, 2);
  const scoreLabel = formatScoreText(entry?.scoreText);

  return `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" ry="18" class="tile"/>
    <text x="${x + width / 2}" y="${y + 30}" text-anchor="middle" class="${scoreLabel === '-' ? 'emptyScore' : 'score'}">${escapeXml(scoreLabel)}</text>
    ${jacketDataUrl
      ? `<image href="${escapeXml(jacketDataUrl)}" x="${jacketX}" y="${jacketY}" width="${jacketSize}" height="${jacketSize}" preserveAspectRatio="none"/>`
      : `<rect x="${jacketX}" y="${jacketY}" width="${jacketSize}" height="${jacketSize}" rx="14" ry="14" fill="#d6deea"/>`}
    <rect x="${badgeX}" y="${y + 180}" width="${badgeWidth}" height="26" rx="13" ry="13" fill="#e8f1fb"/>
    <text x="${x + width / 2}" y="${y + 198}" text-anchor="middle" class="difficulty">${escapeXml(`${entry?.difficulty ?? '-'} ${entry?.level ?? '-'}`)}</text>
    <text x="${x + width / 2}" y="${y + 220}" text-anchor="middle" class="${songLines.some((line) => String(line).length > 14) ? 'songSmall' : 'song'}">${escapeXml(songLines[0] ?? '')}</text>
    <text x="${x + width / 2}" y="${y + 239}" text-anchor="middle" class="${songLines.some((line) => String(line).length > 14) ? 'songSmall' : 'song'}">${escapeXml(songLines[1] ?? '')}</text>
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
    if (next.length <= maxCharsPerLine || !current) {
      current = next;
      continue;
    }

    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) {
      break;
    }
  }

  const remainingWords = lines.length === maxLines - 1
    ? [current, ...words.slice(lines.join(' ').split(/\s+/).filter(Boolean).length + (current ? 1 : 0))]
    : [current];
  const remaining = remainingWords.join(' ').trim();

  if (lines.length < maxLines) {
    lines.push(current);
  }

  while (lines.length < maxLines) {
    lines.push('');
  }

  if (remaining && lines[maxLines - 1] !== remaining) {
    lines[maxLines - 1] = trimWithEllipsis(remaining, maxCharsPerLine);
  } else {
    lines[maxLines - 1] = trimWithEllipsis(lines[maxLines - 1], maxCharsPerLine);
  }

  return lines.slice(0, maxLines);
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

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&apos;');
}
