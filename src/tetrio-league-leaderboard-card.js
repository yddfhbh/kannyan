import {
  bundledSvgFontFamily,
  renderSvgToPng,
} from './svg-renderer.js';

const leaderboardCardRenderScale = 1.35;
const leaderboardCardFontFamily = bundledSvgFontFamily;

export async function renderTetrioLeaderboardCard(view) {
  const svg = renderTetrioLeaderboardCardSvg(view);
  return renderSvgToPng(svg);
}

function renderTetrioLeaderboardCardSvg(view) {
  const contentWidth = 680;
  const outerPadding = 8;
  const headerHeight = 82;
  const columnHeaderHeight = 34;
  const rowHeight = 43;
  const footerHeight = 36;
  const contentHeight = headerHeight
    + columnHeaderHeight
    + view.rows.length * rowHeight
    + footerHeight;
  const viewBoxWidth = contentWidth + outerPadding * 2;
  const viewBoxHeight = contentHeight + outerPadding * 2;
  const width = Math.round(viewBoxWidth * leaderboardCardRenderScale);
  const height = Math.round(viewBoxHeight * leaderboardCardRenderScale);
  const contentX = outerPadding;
  const contentY = outerPadding;
  const rowsY = contentY + headerHeight + columnHeaderHeight;
  const titleRank = view.normalizedRank ? ` ${view.normalizedRank.toUpperCase()}` : '';
  const direction = view.reverse ? 'REVERSE ' : '';
  const mode = view.reverse ? 'RLB' : 'LB';
  const rowMarkup = view.rows
    .map((user, index) => renderTetrioLeaderboardRow({
      user,
      index,
      x: contentX,
      y: rowsY + index * rowHeight,
      width: contentWidth,
      height: rowHeight,
      digits: view.cfg.digits,
    }))
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}">
  <defs>
    <style>
      text {
        font-family: ${leaderboardCardFontFamily};
        letter-spacing: 0;
      }
      .outerBox {
        fill: #1f2026;
        stroke: #30313a;
        stroke-width: 2;
      }
      .headerBox {
        fill: #24252b;
      }
      .title {
        fill: #f0f0f3;
        font-size: 27px;
        font-weight: 900;
      }
      .subtitle {
        fill: #aeb0b8;
        font-size: 12px;
        font-weight: 750;
      }
      .columnHeader {
        fill: #1b1c21;
      }
      .columnLabel {
        fill: #c7c8ce;
        font-size: 12px;
        font-weight: 850;
      }
      .rowOdd {
        fill: #24252b;
      }
      .rowEven {
        fill: #292a31;
      }
      .place {
        fill: #aeb0b8;
        font-size: 14px;
        font-weight: 850;
      }
      .username {
        fill: #f2f2f4;
        font-size: 16px;
        font-weight: 900;
      }
      .rowMeta {
        fill: #bec0c7;
        font-size: 13px;
        font-weight: 700;
      }
      .metric {
        fill: #f7f7f8;
        font-size: 17px;
        font-weight: 900;
      }
      .separator {
        stroke: #33343d;
        stroke-width: 1;
      }
      .footer {
        fill: #aeb0b8;
        font-size: 11px;
        font-weight: 700;
      }
    </style>
  </defs>

  <rect x="1" y="1" width="${viewBoxWidth - 2}" height="${viewBoxHeight - 2}" class="outerBox"/>
  <rect x="${contentX}" y="${contentY}" width="${contentWidth}" height="${headerHeight}" class="headerBox"/>
  <text x="${contentX + 18}" y="${contentY + 35}" class="title">${escapeXml(`${direction}${view.cfg.label}${titleRank} LEADERBOARD`)}</text>
  <text x="${contentX + 18}" y="${contentY + 59}" class="subtitle">${escapeXml(`${mode}  /  PAGE ${view.page}  /  ${view.userCount.toLocaleString('en-US')} USERS`)}</text>

  <rect x="${contentX}" y="${contentY + headerHeight}" width="${contentWidth}" height="${columnHeaderHeight}" class="columnHeader"/>
  <text x="${contentX + 20}" y="${contentY + headerHeight + 22}" class="columnLabel">#</text>
  <text x="${contentX + 78}" y="${contentY + headerHeight + 22}" class="columnLabel">PLAYER</text>
  <text x="${contentX + 452}" y="${contentY + headerHeight + 22}" text-anchor="end" class="columnLabel">TL</text>
  <text x="${contentX + 532}" y="${contentY + headerHeight + 22}" text-anchor="middle" class="columnLabel">RANK</text>
  <text x="${contentX + contentWidth - 20}" y="${contentY + headerHeight + 22}" text-anchor="end" class="columnLabel">${escapeXml(view.cfg.label.toUpperCase())}</text>

  ${rowMarkup}

  <rect x="${contentX}" y="${rowsY + view.rows.length * rowHeight}" width="${contentWidth}" height="${footerHeight}" class="headerBox"/>
  <text x="${contentX + 18}" y="${rowsY + view.rows.length * rowHeight + 23}" class="footer">${escapeXml(`UPDATED ${formatUpdatedAt(view.generatedAt)}`)}</text>
  <text x="${contentX + contentWidth - 18}" y="${rowsY + view.rows.length * rowHeight + 23}" text-anchor="end" class="footer">TETRA LEAGUE</text>
</svg>`;
}

function renderTetrioLeaderboardRow({ user, index, x, y, width, height, digits }) {
  const rank = String(user.rank ?? '?').toUpperCase();
  const baseline = y + 27;
  const rowClass = index % 2 === 0 ? 'rowOdd' : 'rowEven';

  return `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" class="${rowClass}"/>
  <line x1="${x + 16}" y1="${y + height}" x2="${x + width - 16}" y2="${y + height}" class="separator"/>
  <text x="${x + 20}" y="${baseline}" class="place">#${user.place}</text>
  <text x="${x + 78}" y="${baseline}" class="username">${escapeXml(String(user.username ?? '').toUpperCase())}</text>
  <text x="${x + 452}" y="${baseline}" text-anchor="end" class="rowMeta">#${user.tlRank}</text>
  <text x="${x + 532}" y="${baseline}" text-anchor="middle" class="rowMeta">${escapeXml(rank)}</text>
  <text x="${x + width - 20}" y="${baseline}" text-anchor="end" class="metric">${user.value.toFixed(digits)}</text>`;
}

function formatUpdatedAt(value) {
  if (!value) return 'UNKNOWN';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute} KST`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
