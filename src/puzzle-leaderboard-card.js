import {
  bundledSvgFontFamily,
  renderSvgToPng,
} from './svg-renderer.js';

const puzzleLeaderboardCardRenderScale = 1.35;
const puzzleLeaderboardCardFontFamily = bundledSvgFontFamily;

export async function renderPuzzleLeaderboardCard(view) {
  const svg = renderPuzzleLeaderboardCardSvg(view);
  return renderSvgToPng(svg);
}

export function renderPuzzleLeaderboardCardSvg(view) {
  const contentWidth = 720;
  const outerPadding = 8;
  const headerHeight = 86;
  const columnHeaderHeight = 34;
  const rowHeight = 44;
  const footerHeight = 36;
  const rows = Array.isArray(view.rows) ? view.rows : [];
  const contentHeight = headerHeight + columnHeaderHeight + rows.length * rowHeight + footerHeight;
  const viewBoxWidth = contentWidth + outerPadding * 2;
  const viewBoxHeight = contentHeight + outerPadding * 2;
  const width = Math.round(viewBoxWidth * puzzleLeaderboardCardRenderScale);
  const height = Math.round(viewBoxHeight * puzzleLeaderboardCardRenderScale);
  const contentX = outerPadding;
  const contentY = outerPadding;
  const rowsY = contentY + headerHeight + columnHeaderHeight;
  const rowMarkup = rows
    .map((entry, index) => renderPuzzleLeaderboardRow({
      entry,
      index,
      x: contentX,
      y: rowsY + index * rowHeight,
      width: contentWidth,
      height: rowHeight,
    }))
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}">
  <defs>
    <style>
      text {
        font-family: ${puzzleLeaderboardCardFontFamily};
        letter-spacing: 0;
      }
      .outerBox {
        fill: #1e2128;
        stroke: #363a44;
        stroke-width: 2;
      }
      .headerBox {
        fill: #242a35;
      }
      .title {
        fill: #f5f7fb;
        font-size: 28px;
        font-weight: 900;
      }
      .subtitle {
        fill: #adb6c7;
        font-size: 12px;
        font-weight: 750;
      }
      .columnHeader {
        fill: #191e27;
      }
      .columnLabel {
        fill: #c9d0dd;
        font-size: 12px;
        font-weight: 850;
      }
      .rowOdd {
        fill: #232936;
      }
      .rowEven {
        fill: #28303e;
      }
      .place {
        fill: #b8c0d0;
        font-size: 14px;
        font-weight: 850;
      }
      .player {
        fill: #f3f6fb;
        font-size: 16px;
        font-weight: 900;
      }
      .rating {
        fill: #8de4b4;
        font-size: 18px;
        font-weight: 900;
      }
      .meta {
        fill: #c1c8d5;
        font-size: 13px;
        font-weight: 760;
      }
      .separator {
        stroke: #394252;
        stroke-width: 1;
      }
      .footer {
        fill: #adb6c7;
        font-size: 11px;
        font-weight: 700;
      }
    </style>
  </defs>

  <rect x="1" y="1" width="${viewBoxWidth - 2}" height="${viewBoxHeight - 2}" class="outerBox"/>
  <rect x="${contentX}" y="${contentY}" width="${contentWidth}" height="${headerHeight}" class="headerBox"/>
  <text x="${contentX + 18}" y="${contentY + 37}" class="title">${escapeXml(view.title ?? 'PUZZLE LEADERBOARD')}</text>
  <text x="${contentX + 18}" y="${contentY + 61}" class="subtitle">${escapeXml(view.subtitle ?? `TOP ${rows.length} / DAILY CHESS PUZZLE`)}</text>

  <rect x="${contentX}" y="${contentY + headerHeight}" width="${contentWidth}" height="${columnHeaderHeight}" class="columnHeader"/>
  <text x="${contentX + 20}" y="${contentY + headerHeight + 22}" class="columnLabel">#</text>
  <text x="${contentX + 78}" y="${contentY + headerHeight + 22}" class="columnLabel">PLAYER</text>
  <text x="${contentX + 560}" y="${contentY + headerHeight + 22}" text-anchor="end" class="columnLabel">RATING</text>
  <text x="${contentX + contentWidth - 20}" y="${contentY + headerHeight + 22}" text-anchor="end" class="columnLabel">SOLVED / RATED</text>

  ${rowMarkup}

  <rect x="${contentX}" y="${rowsY + rows.length * rowHeight}" width="${contentWidth}" height="${footerHeight}" class="headerBox"/>
  <text x="${contentX + 18}" y="${rowsY + rows.length * rowHeight + 23}" class="footer">${escapeXml(`GENERATED ${formatGeneratedAt(view.generatedAt)}`)}</text>
  <text x="${contentX + contentWidth - 18}" y="${rowsY + rows.length * rowHeight + 23}" text-anchor="end" class="footer">KANNYAN DAILY PUZZLE</text>
</svg>`;
}

function renderPuzzleLeaderboardRow({ entry, index, x, y, width, height }) {
  const baseline = y + 28;
  const rowClass = index % 2 === 0 ? 'rowOdd' : 'rowEven';
  const solvedCount = Number.isFinite(Number(entry?.solvedCount)) ? Math.trunc(Number(entry.solvedCount)) : 0;
  const ratedAttempts = Number.isFinite(Number(entry?.ratedAttempts)) ? Math.trunc(Number(entry.ratedAttempts)) : 0;

  return `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" class="${rowClass}"/>
  <line x1="${x + 16}" y1="${y + height}" x2="${x + width - 16}" y2="${y + height}" class="separator"/>
  <text x="${x + 20}" y="${baseline}" class="place">#${escapeXml(entry.rank)}</text>
  <text x="${x + 78}" y="${baseline}" class="player">${escapeXml(truncatePlayerName(entry.name))}</text>
  <text x="${x + 560}" y="${baseline}" text-anchor="end" class="rating">${escapeXml(formatRating(entry.rating))}</text>
  <text x="${x + width - 20}" y="${baseline}" text-anchor="end" class="meta">${escapeXml(`${solvedCount} / ${ratedAttempts}`)}</text>`;
}

function truncatePlayerName(value) {
  const text = String(value ?? '').trim();
  return text.length > 34 ? `${text.slice(0, 33)}...` : text;
}

function formatRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) ? rating.toFixed(2) : '-';
}

function formatGeneratedAt(value) {
  if (!value) {
    return 'UNKNOWN';
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute} KST`;
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
