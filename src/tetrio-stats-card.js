import {
  bundledSvgFontFamily,
  renderSvgToPng,
} from './svg-renderer.js';

const statsCardFontFamily = bundledSvgFontFamily;
const statsCardRenderScale = 1.35;
const previewStats = {
  apm: 114.21,
  pps: 2.51,
  vs: 226.35,
  dsPiece: 0.1434,
  app: 0.7584,
  appDsPiece: 0.9018,
  rank: 'U',
  dsSecond: 0.3600,
  vsApm: 1.9819,
  garbageEffi: 0.2175,
  cheeseIndex: 0.8119,
  weightedApp: 0.6735,
  area: 664.0240,
  tr: 22100.31,
  estimatedTr: 21853.76,
  glicko: 2602.75,
  rd: 65.45,
  playstyle: {
    opener: 0.8041,
    plonk: 0.522,
    stride: 0.23,
    infiniteDs: 0.1693,
  },
};

export async function createTetrioStatsPreviewCard(username = 'NICKNAME') {
  return createTetrioStatsCard({
    username,
    stats: previewStats,
  });
}

export async function createTetrioStatsCard({ username = 'NICKNAME', stats = {} } = {}) {
  const svg = renderTetrioStatsCardSvg(username, stats);
  return renderSvgToPng(svg);
}

function renderTetrioStatsCardSvg(username, stats) {
  const contentWidth = 480;
  const outerPadding = 8;
  const viewBoxWidth = contentWidth + outerPadding * 2;
  const contentX = outerPadding;
  const contentY = outerPadding;
  const nicknameBoxHeight = 50;
  const gap = 7;
  const statsBoxY = contentY + nicknameBoxHeight + gap;
  const statsBoxHeight = 261;
  const viewBoxHeight = statsBoxY + statsBoxHeight + outerPadding;
  const width = Math.round(viewBoxWidth * statsCardRenderScale);
  const height = Math.round(viewBoxHeight * statsCardRenderScale);
  const nicknameTextX = contentX + 3;
  const lowerSectionY = statsBoxY + 150;
  const lowerSectionXs = [2, 166, 342].map((x) => contentX + x);
  const normalizedUsername = String(username ?? '').trim() || 'NICKNAME';
  const values = normalizeStats(stats);
  const topRows = [
    [
      { label: 'APM', value: formatDecimal(values.apm, 2) },
      { label: 'PPS', value: formatDecimal(values.pps, 2) },
      { label: 'VS', value: formatDecimal(values.vs, 2) },
    ],
    [
      { label: 'DS/Piece', value: formatDecimal(values.dsPiece, 4) },
      { label: 'APP', value: formatDecimal(values.app, 4) },
      { label: 'APP+DS/Piece', value: formatDecimal(values.appDsPiece, 4) },
    ],
    [
      { label: 'Rank', value: values.rank },
      { label: 'Promote', value: values.promote },
      { label: 'Demote', value: values.demote },
    ],
  ];
  const advancedRows = [
    ['DS/Second', formatDecimal(values.dsSecond, 4)],
    ['VS/APM', formatDecimal(values.vsApm, 4)],
    ['Garbage Effi.', formatDecimal(values.garbageEffi, 4)],
    ['Cheese Index', formatDecimal(values.cheeseIndex, 4)],
    ['Weighted APP', formatDecimal(values.weightedApp, 4)],
  ];
  const rankingRows = [
    ['Area', formatDecimal(values.area, 4)],
    ['TR', formatDecimal(values.tr, 2)],
    ['Est. TR', formatDecimal(values.estimatedTr, 2)],
    ['Acc. of TR Est.', formatDecimal(values.trEstimateAccuracy, 2)],
    ['Glicko', `${formatDecimal(values.glicko, 2)}&#177;${formatDecimal(values.rd, 2)}`],
  ];
  const playstyleRows = [
    ['Opener', formatDecimal(values.playstyle.opener, 4)],
    ['Plonk', formatDecimal(values.playstyle.plonk, 4)],
    ['Stride', formatDecimal(values.playstyle.stride, 4)],
    ['Inf DS', formatDecimal(values.playstyle.infiniteDs, 4)],
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}">
  <defs>
    <style>
      text {
        font-family: ${statsCardFontFamily};
        letter-spacing: 0;
      }
      .box {
        fill: #24252b;
      }
      .outerBox {
        fill: #1f2026;
        stroke: #30313a;
        stroke-width: 2;
      }
      .nicknameLabel {
        fill: #c7c8ce;
        font-size: 11px;
        font-weight: 800;
      }
      .nickname {
        fill: #f0f0f3;
        font-size: 30px;
        font-weight: 900;
      }
      .label {
        fill: #f0f0f2;
        font-size: 13px;
        font-weight: 800;
      }
      .metricLabel {
        fill: #f0f0f2;
        font-size: 14.5px;
        font-weight: 850;
      }
      .value {
        fill: #f5f5f7;
        font-size: 13px;
        font-weight: 500;
      }
      .section {
        fill: #f1f1f3;
        font-size: 14.5px;
        font-weight: 850;
      }
      .listLabel {
        fill: #f1f1f3;
        font-size: 13px;
        font-weight: 600;
      }
      .listValue {
        fill: #f7f7f8;
        font-size: 13px;
        font-weight: 800;
      }
      .arrow {
        fill: #f1f1f3;
      }
    </style>
  </defs>

  <rect x="1" y="1" width="${viewBoxWidth - 2}" height="${viewBoxHeight - 2}" class="outerBox"/>
  <rect x="${contentX}" y="${contentY}" width="${contentWidth}" height="${nicknameBoxHeight}" class="box"/>
  <text x="${nicknameTextX}" y="${contentY + 37}" class="nickname">${renderStatsNicknameMarkup(normalizedUsername)}</text>

  <rect x="${contentX}" y="${statsBoxY}" width="${contentWidth}" height="${statsBoxHeight}" class="box"/>
  ${renderTopRows(topRows, statsBoxY, contentX)}
  ${renderSection(lowerSectionXs[0], lowerSectionY, 'Advanced:', advancedRows)}
  ${renderSection(lowerSectionXs[1], lowerSectionY, 'Ranking:', rankingRows)}
  ${renderSection(lowerSectionXs[2], lowerSectionY, 'Playstyle:', playstyleRows)}
</svg>`;
}

function renderTopRows(rows, yOffset, xOffset = 0) {
  const columns = [3, 171, 347].map((x) => xOffset + x);
  const rowYs = [8, 56, 104];

  return rows.map((row, rowIndex) =>
    row.map((item, columnIndex) => {
      if (!item) {
        return '';
      }

      const x = columns[columnIndex];
      const y = yOffset + rowYs[rowIndex];
      return `
  <text x="${x}" y="${y + 10}" class="metricLabel">${escapeXml(item.label)}</text>
  <text x="${x}" y="${y + 27}" class="value">${escapeXml(item.value)}</text>`;
    }).join('')
  ).join('');
}

function renderSection(x, y, title, rows) {
  const lineHeight = 18;
  const rowsMarkup = rows.map(([label, value], index) => {
    const baseline = y + 27 + index * lineHeight;
    return `
  <path d="M ${x} ${baseline - 10} L ${x} ${baseline + 1} L ${x + 9} ${baseline - 4.5} Z" class="arrow"/>
  <text x="${x + 11}" y="${baseline}" class="listLabel">${escapeXml(label)}: <tspan class="listValue">${value}</tspan></text>`;
  }).join('');

  return `
  <text x="${x}" y="${y + 10}" class="section">${escapeXml(title)}</text>${rowsMarkup}`;
}

function renderStatsNicknameMarkup(value) {
  const text = String(value ?? '').toUpperCase();
  let markup = '';
  let currentOffsetEm = 0;

  for (const char of text) {
    const targetOffsetEm = char === '_' ? -0.18 : 0;
    const deltaEm = targetOffsetEm - currentOffsetEm;
    const dy = Math.abs(deltaEm) > 0.0001
      ? ` dy="${deltaEm}em"`
      : '';

    if (char === '_') {
      markup += `<tspan${dy} dx="0.04em" font-family="Arial" font-size="0.68em" font-weight="900" stroke="#f0f0f3" stroke-width="1.5" paint-order="stroke fill">_</tspan>`;
    } else {
      markup += dy
        ? `<tspan${dy}>${escapeXml(char)}</tspan>`
        : escapeXml(char);
    }

    currentOffsetEm = targetOffsetEm;
  }

  return markup;
}

function normalizeStats(stats) {
  const tr = toFiniteNumber(stats.tr);
  const estimatedTr = toFiniteNumber(stats.estimatedTr);
  const trEstimateAccuracy = firstFiniteNumber(
    stats.trEstimateAccuracy,
    Number.isFinite(tr) && Number.isFinite(estimatedTr) ? estimatedTr - tr : null,
  );

  return {
    apm: toFiniteNumber(stats.apm),
    pps: toFiniteNumber(stats.pps),
    vs: toFiniteNumber(stats.vs),
    dsPiece: firstFiniteNumber(stats.dsPiece, stats.dspiece),
    app: toFiniteNumber(stats.app),
    appDsPiece: firstFiniteNumber(stats.appDsPiece, stats.appdspiece),
    rank: (String(stats.rank ?? '-').trim() || '-').toUpperCase(),
    promote: formatPlaceholderText(stats.promote),
    demote: formatPlaceholderText(stats.demote),
    currentGlicko: toFiniteNumber(stats.currentGlicko),
    currentRd: toFiniteNumber(stats.currentRd),
    currentTr: toFiniteNumber(stats.currentTr),
    currentStanding: toFiniteNumber(stats.currentStanding),
    nextRank: normalizeOptionalRank(stats.nextRank),
    previousRank: normalizeOptionalRank(stats.previousRank),
    nextRankGlickoCutoff: toFiniteNumber(stats.nextRankGlickoCutoff),
    previousRankGlickoCutoff: toFiniteNumber(stats.previousRankGlickoCutoff),
    nextRankTrCutoff: toFiniteNumber(stats.nextRankTrCutoff),
    previousRankTrCutoff: toFiniteNumber(stats.previousRankTrCutoff),
    dsSecond: firstFiniteNumber(stats.dsSecond, stats.dssecond),
    vsApm: firstFiniteNumber(stats.vsApm, stats.vsapm),
    garbageEffi: firstFiniteNumber(stats.garbageEffi, stats.garbageeffi),
    cheeseIndex: toFiniteNumber(stats.cheeseIndex),
    weightedApp: toFiniteNumber(stats.weightedApp),
    area: toFiniteNumber(stats.area),
    tr,
    estimatedTr,
    trEstimateAccuracy,
    glicko: toFiniteNumber(stats.glicko),
    rd: toFiniteNumber(stats.rd),
    playstyle: {
      opener: toFiniteNumber(stats.playstyle?.opener),
      plonk: toFiniteNumber(stats.playstyle?.plonk),
      stride: toFiniteNumber(stats.playstyle?.stride),
      infiniteDs: firstFiniteNumber(stats.playstyle?.infiniteDs, stats.playstyle?.infDs),
    },
  };
}

function formatPlaceholderText(value) {
  const text = String(value ?? '').trim();
  return text || '-';
}

function normalizeOptionalRank(value) {
  const text = String(value ?? '').trim();
  return text ? text.toUpperCase() : null;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = toFiniteNumber(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }

  return null;
}

function formatDecimal(value, digits) {
  const number = toFiniteNumber(value);
  return Number.isFinite(number)
    ? number.toFixed(digits)
    : '-';
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
