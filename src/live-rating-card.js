import sharp from 'sharp';

const liveRatingCardRenderScale = 1.35;
const liveRatingCardFontFamily = '"Noto Sans CJK KR", "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", Arial, sans-serif';

export async function renderLiveRatingCard(view) {
  const svg = renderLiveRatingCardSvg(view);
  return sharp(Buffer.from(svg))
    .png()
    .toBuffer();
}

export function renderLiveRatingCardSvg(view) {
  const contentWidth = 680;
  const outerPadding = 8;
  const headerHeight = 82;
  const columnHeaderHeight = 34;
  const rowHeight = 43;
  const footerHeight = 36;
  const rows = Array.isArray(view.rows) ? view.rows : [];
  const contentHeight = headerHeight
    + columnHeaderHeight
    + rows.length * rowHeight
    + footerHeight;
  const viewBoxWidth = contentWidth + outerPadding * 2;
  const viewBoxHeight = contentHeight + outerPadding * 2;
  const width = Math.round(viewBoxWidth * liveRatingCardRenderScale);
  const height = Math.round(viewBoxHeight * liveRatingCardRenderScale);
  const contentX = outerPadding;
  const contentY = outerPadding;
  const rowsY = contentY + headerHeight + columnHeaderHeight;
  const rowMarkup = rows
    .map((entry, index) => renderLiveRatingRow({
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
        font-family: ${liveRatingCardFontFamily};
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
      .player {
        fill: #f2f2f4;
        font-size: 16px;
        font-weight: 900;
      }
      .rating {
        fill: #f7f7f8;
        font-size: 17px;
        font-weight: 900;
      }
      .changeUp {
        fill: #79d99a;
        font-size: 14px;
        font-weight: 850;
      }
      .changeDown {
        fill: #ef8585;
        font-size: 14px;
        font-weight: 850;
      }
      .changeEven {
        fill: #bec0c7;
        font-size: 14px;
        font-weight: 800;
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
  <text x="${contentX + 18}" y="${contentY + 35}" class="title">${escapeXml(`${view.label} LIVE RATING`)}</text>
  <text x="${contentX + 18}" y="${contentY + 59}" class="subtitle">${escapeXml(`TOP ${rows.length}  /  LIVE WORLD RANKING`)}</text>

  <rect x="${contentX}" y="${contentY + headerHeight}" width="${contentWidth}" height="${columnHeaderHeight}" class="columnHeader"/>
  <text x="${contentX + 20}" y="${contentY + headerHeight + 22}" class="columnLabel">#</text>
  <text x="${contentX + 78}" y="${contentY + headerHeight + 22}" class="columnLabel">PLAYER</text>
  <text x="${contentX + 558}" y="${contentY + headerHeight + 22}" text-anchor="end" class="columnLabel">RATING</text>
  <text x="${contentX + contentWidth - 20}" y="${contentY + headerHeight + 22}" text-anchor="end" class="columnLabel">+/-</text>

  ${rowMarkup}

  <rect x="${contentX}" y="${rowsY + rows.length * rowHeight}" width="${contentWidth}" height="${footerHeight}" class="headerBox"/>
  <text x="${contentX + 18}" y="${rowsY + rows.length * rowHeight + 23}" class="footer">${escapeXml(`GENERATED ${formatGeneratedAt(view.generatedAt)}`)}</text>
  <text x="${contentX + contentWidth - 18}" y="${rowsY + rows.length * rowHeight + 23}" text-anchor="end" class="footer">2700CHESS.LIVE</text>
</svg>`;
}

function renderLiveRatingRow({ entry, index, x, y, width, height }) {
  const baseline = y + 27;
  const rowClass = index % 2 === 0 ? 'rowOdd' : 'rowEven';
  const change = normalizeChange(entry.change);

  return `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" class="${rowClass}"/>
  <line x1="${x + 16}" y1="${y + height}" x2="${x + width - 16}" y2="${y + height}" class="separator"/>
  <text x="${x + 20}" y="${baseline}" class="place">#${escapeXml(entry.rank)}</text>
  <text x="${x + 78}" y="${baseline}" class="player">${escapeXml(truncatePlayerName(entry.name))}</text>
  <text x="${x + 558}" y="${baseline}" text-anchor="end" class="rating">${escapeXml(formatRating(entry.rating))}</text>
  <text x="${x + width - 20}" y="${baseline}" text-anchor="end" class="${change.className}">${escapeXml(change.text)}</text>`;
}

function normalizeChange(value) {
  const text = String(value ?? '-').trim() || '-';
  const numericValue = Number.parseFloat(text.replace(',', '.'));

  if (Number.isFinite(numericValue) && numericValue > 0) {
    return {
      text: text.startsWith('+') ? text : `+${text}`,
      className: 'changeUp',
    };
  }

  if (Number.isFinite(numericValue) && numericValue < 0) {
    return {
      text,
      className: 'changeDown',
    };
  }

  return {
    text,
    className: 'changeEven',
  };
}

function truncatePlayerName(value) {
  const text = String(value ?? '').trim();
  return text.length > 34 ? `${text.slice(0, 33)}…` : text;
}

function formatRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating)
    ? rating.toFixed(1)
    : '-';
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
