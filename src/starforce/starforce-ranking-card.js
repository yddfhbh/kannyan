import {
  bundledSvgFontFamily,
  renderSvgToPng,
} from '../svg-renderer.js';

const starforceRankingCardFontFamily = bundledSvgFontFamily;
const starforceRankingCardScale = 1.35;
const STARFORCE_RANKING_ROWS_PER_COLUMN = 25;

export async function renderStarforceRankingCard(view) {
  const svg = renderStarforceRankingCardSvg(view);
  return renderSvgToPng(svg);
}

export function renderStarforceRankingCardSvg(view) {
  const rows = Array.isArray(view?.rows) ? view.rows : [];
  const columns = chunkRows(rows, STARFORCE_RANKING_ROWS_PER_COLUMN);
  const normalizedColumns = columns.length > 0 ? columns : [[]];

  const outerPadding = 8;
  const cardWidth = normalizedColumns.length > 1 ? 1000 : 720;
  const headerHeight = 84;
  const columnHeaderHeight = 34;
  const rowHeight = 42;
  const footerHeight = 36;
  const columnGap = 14;
  const innerPadding = 16;
  const columnWidth = normalizedColumns.length > 1
    ? Math.floor((cardWidth - innerPadding * 2 - columnGap) / 2)
    : cardWidth - innerPadding * 2;
  const maxRows = Math.max(...normalizedColumns.map((column) => column.length), 1);
  const bodyHeight = columnHeaderHeight + maxRows * rowHeight;
  const contentHeight = headerHeight + bodyHeight + footerHeight;
  const viewBoxWidth = cardWidth + outerPadding * 2;
  const viewBoxHeight = contentHeight + outerPadding * 2;
  const width = Math.round(viewBoxWidth * starforceRankingCardScale);
  const height = Math.round(viewBoxHeight * starforceRankingCardScale);
  const contentX = outerPadding;
  const contentY = outerPadding;
  const columnsY = contentY + headerHeight;

  const columnMarkup = normalizedColumns
    .map((columnRows, columnIndex) => renderRankingColumn({
      rows: columnRows,
      columnIndex,
      x: contentX + innerPadding + columnIndex * (columnWidth + columnGap),
      y: columnsY,
      width: columnWidth,
      rowHeight,
      columnHeaderHeight,
    }))
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}">
  <defs>
    <style>
      text {
        font-family: ${starforceRankingCardFontFamily};
        letter-spacing: 0;
      }
      .outerBox {
        fill: #1d2028;
        stroke: #353c48;
        stroke-width: 2;
      }
      .headerBox {
        fill: #242a35;
      }
      .title {
        fill: #f7f8fb;
        font-size: 28px;
        font-weight: 900;
      }
      .subtitle {
        fill: #adb6c7;
        font-size: 12px;
        font-weight: 760;
      }
      .starAccent {
        fill: #ffd96a;
        font-size: 16px;
        font-weight: 900;
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
        font-size: 13px;
        font-weight: 850;
      }
      .player {
        fill: #f3f6fb;
        font-size: 15px;
        font-weight: 900;
      }
      .star {
        fill: #ffd96a;
        font-size: 16px;
        font-weight: 900;
      }
      .meso {
        fill: #8de4b4;
        font-size: 15px;
        font-weight: 900;
      }
      .separator {
        stroke: #394252;
        stroke-width: 1;
      }
      .emptyText {
        fill: #b9c2d1;
        font-size: 16px;
        font-weight: 760;
      }
      .footer {
        fill: #adb6c7;
        font-size: 11px;
        font-weight: 700;
      }
    </style>
  </defs>

  <rect x="1" y="1" width="${viewBoxWidth - 2}" height="${viewBoxHeight - 2}" rx="14" class="outerBox"/>
  <rect x="${contentX}" y="${contentY}" width="${cardWidth}" height="${headerHeight}" rx="12" class="headerBox"/>
  <text x="${contentX + 18}" y="${contentY + 36}" class="title">${escapeXml(view?.title ?? 'STARFORCE RANKING')}</text>
  <text x="${contentX + 18}" y="${contentY + 60}" class="subtitle">${escapeXml(view?.subtitle ?? 'TOP PLAYERS / STAR DESC / MESO ASC / TRY ASC')}</text>
  <text x="${contentX + cardWidth - 18}" y="${contentY + 36}" text-anchor="end" class="starAccent">${escapeXml(`★ LV.${view?.level ?? '-'}`)}</text>
  <text x="${contentX + cardWidth - 18}" y="${contentY + 60}" text-anchor="end" class="subtitle">${escapeXml(`GENERATED ${formatGeneratedAt(view?.generatedAt)}`)}</text>

  ${columnMarkup}

  <rect x="${contentX}" y="${contentY + headerHeight + bodyHeight}" width="${cardWidth}" height="${footerHeight}" rx="0" class="headerBox"/>
  <text x="${contentX + 18}" y="${contentY + headerHeight + bodyHeight + 23}" class="footer">${escapeXml(view?.footerLeft ?? 'RANK BY STAR, THEN LOWER MESO, THEN FEWER TRIES')}</text>
  <text x="${contentX + cardWidth - 18}" y="${contentY + headerHeight + bodyHeight + 23}" text-anchor="end" class="footer">${escapeXml(view?.footerRight ?? 'KANNYAN STARFORCE')}</text>
</svg>`;
}

function renderRankingColumn({ rows, columnIndex, x, y, width, rowHeight, columnHeaderHeight }) {
  const rowsY = y + columnHeaderHeight;
  const header = `
  <rect x="${x}" y="${y}" width="${width}" height="${columnHeaderHeight}" rx="8" class="columnHeader"/>
  <text x="${x + 18}" y="${y + 22}" class="columnLabel">#</text>
  <text x="${x + 74}" y="${y + 22}" class="columnLabel">PLAYER</text>
  <text x="${x + width - 118}" y="${y + 22}" text-anchor="end" class="columnLabel">STAR</text>
  <text x="${x + width - 18}" y="${y + 22}" text-anchor="end" class="columnLabel">MESO</text>`;

  if (!rows.length) {
    return `${header}
  <rect x="${x}" y="${rowsY}" width="${width}" height="${rowHeight}" rx="8" class="${columnIndex % 2 === 0 ? 'rowOdd' : 'rowEven'}"/>
  <text x="${x + width / 2}" y="${rowsY + 27}" text-anchor="middle" class="emptyText">아직 기록이 없습니다.</text>`;
  }

  const rowMarkup = rows.map((entry, index) => renderRankingRow({
    entry,
    index,
    x,
    y: rowsY + index * rowHeight,
    width,
    height: rowHeight,
  })).join('');

  return `${header}${rowMarkup}`;
}

function renderRankingRow({ entry, index, x, y, width, height }) {
  const baseline = y + 27;
  const rowClass = index % 2 === 0 ? 'rowOdd' : 'rowEven';

  return `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" class="${rowClass}"/>
  <line x1="${x + 16}" y1="${y + height}" x2="${x + width - 16}" y2="${y + height}" class="separator"/>
  <text x="${x + 18}" y="${baseline}" class="place">#${escapeXml(entry.rank)}</text>
  <text x="${x + 74}" y="${baseline}" class="player">${escapeXml(truncatePlayerName(entry.nickname))}</text>
  <text x="${x + width - 118}" y="${baseline}" text-anchor="end" class="star">${escapeXml(`${formatStar(entry.star)}성`)}</text>
  <text x="${x + width - 18}" y="${baseline}" text-anchor="end" class="meso">${escapeXml(formatMeso(entry.mesosUsed))}</text>`;
}

function chunkRows(rows, size) {
  const chunks = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
}

function truncatePlayerName(value) {
  const text = String(value ?? '').trim();
  return text.length > 18 ? `${text.slice(0, 17)}...` : text;
}

function formatStar(value) {
  const star = Number(value);
  return Number.isFinite(star) ? Math.trunc(star).toString() : '0';
}

function formatMeso(value) {
  const meso = Number(value);
  return Number.isFinite(meso) ? Math.trunc(meso).toLocaleString('ko-KR') : '0';
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
