import sharp from 'sharp';

const graphWidth = 600;
const graphHeight = 400;
const ringCount = 6;
const outerRadius = 124;
const centerX = graphWidth / 2;
const centerY = 208;
const labelRadius = outerRadius + 30;
const graphFontFamily = '"Noto Sans CJK KR", "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", Arial, sans-serif';

const versusAxes = [
  { key: 'apm', label: 'APM', valueAtRing: 180, referenceRing: 6 },
  { key: 'pps', label: 'PPS', valueAtRing: 4, referenceRing: 6 },
  { key: 'vs', label: 'VS', valueAtRing: 400, referenceRing: 6 },
  { key: 'app', label: 'APP', valueAtRing: 0.96, referenceRing: 6 },
  { key: 'dsSecond', label: 'DS/Second', valueAtRing: 1.02, referenceRing: 6 },
  { key: 'dsPiece', label: 'DS/Piece', valueAtRing: 0.4, referenceRing: 6 },
  { key: 'appDsPiece', label: 'APP+DS/Piece', valueAtRing: 1.28, referenceRing: 6 },
  { key: 'vsApm', label: 'VS/APM', valueAtRing: 3, referenceRing: 6 },
  { key: 'cheeseIndex', label: 'Cheese Index', valueAtRing: 144, referenceRing: 6 },
  { key: 'garbageEffi', label: 'Garbage Effi.', valueAtRing: 0.4766, referenceRing: 5 },
].map((axis, index, axes) => {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / axes.length;
  const labelPoint = getPolarPoint(labelRadius, angle);
  return {
    ...axis,
    angle,
    labelX: labelPoint[0],
    labelY: labelPoint[1],
    anchor: getLabelAnchor(Math.cos(angle)),
  };
});

const graphSeriesPalette = [
  { fill: '#9cc8b2', stroke: '#68a4ff', marker: '#a7d4be', text: '#79a9ff' },
  { fill: '#35b9c8', stroke: '#d52ee8', marker: '#8de2ea', text: '#c184ff' },
  { fill: '#f2cf69', stroke: '#ffbf3f', marker: '#ffe99e', text: '#ffd572' },
  { fill: '#77d082', stroke: '#36df65', marker: '#b5efb9', text: '#8feea0' },
  { fill: '#f09a9a', stroke: '#ff6f91', marker: '#ffd0d0', text: '#ff99b2' },
];

export async function createTetrioVersusGraph(input = {}) {
  const svg = renderTetrioVersusGraphSvg(input);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function renderTetrioVersusGraphSvg(input) {
  const series = normalizeGraphSeries(input);
  const gridMarkup = Array.from({ length: ringCount }, (_, index) => renderRing(index + 1)).join('\n');
  const axisMarkup = versusAxes.map(renderAxis).join('\n');
  const labelMarkup = versusAxes.map(renderAxisLabel).join('\n');
  const dataMarkup = series
    .map((entry, index) => renderDataSeries(entry, index, series.length))
    .join('\n');
  const legendMarkup = renderLegend(series);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${graphWidth}" height="${graphHeight}" viewBox="0 0 ${graphWidth} ${graphHeight}">
  <defs>
    <style>
      text {
        font-family: ${graphFontFamily};
        letter-spacing: 0;
      }
      .page {
        fill: #020304;
      }
      .grid {
        fill: none;
        stroke: #aaaeb6;
        stroke-width: 1.65;
        opacity: 0.86;
      }
      .axis {
        stroke: #c7cbd2;
        stroke-width: 1.75;
        opacity: 0.78;
      }
      .axisLabel {
        fill: #72a8ff;
        font-size: 18px;
        font-weight: 800;
      }
      .legendText {
        font-size: 18px;
        font-weight: 900;
      }
      .dataFill {
        stroke-width: 4.4;
        stroke-linejoin: round;
      }
      .markerOuter {
        stroke-width: 2.8;
      }
      .legendBox {
        fill-opacity: 0.88;
        stroke-width: 4;
      }
    </style>
  </defs>
  <rect width="${graphWidth}" height="${graphHeight}" class="page"/>
  ${legendMarkup}
  <g>
    ${gridMarkup}
    ${axisMarkup}
    ${dataMarkup}
    ${labelMarkup}
  </g>
</svg>`;
}

function normalizeGraphSeries(input) {
  const entries = Array.isArray(input.players)
    ? input.players
    : Array.isArray(input.series)
      ? input.series
      : [{ username: input.username, stats: input.stats }];

  return entries.map((entry) => ({
    username: String(entry?.username ?? 'NICKNAME').trim() || 'NICKNAME',
    stats: normalizeStats(entry?.stats),
  }));
}

function normalizeStats(stats = {}) {
  return {
    ...Object.fromEntries(
      versusAxes.map((axis) => [axis.key, firstFiniteNumber(stats[axis.key], stats[getLowerKey(axis.key)]) ?? 0])
    ),
  };
}

function getLowerKey(value) {
  return String(value).toLowerCase();
}

function renderRing(ring) {
  const radius = (ring / ringCount) * outerRadius;
  const points = versusAxes
    .map((axis) => getPolarPoint(radius, axis.angle))
    .map(formatPoint)
    .join(' ');
  return `<polygon points="${points}" class="grid"/>`;
}

function renderAxis(axis) {
  const [x, y] = getPolarPoint(outerRadius, axis.angle);
  return `<line x1="${centerX}" y1="${centerY}" x2="${roundSvgNumber(x)}" y2="${roundSvgNumber(y)}" class="axis"/>`;
}

function renderAxisLabel(axis) {
  return `<text x="${roundSvgNumber(axis.labelX)}" y="${roundSvgNumber(axis.labelY)}" text-anchor="${axis.anchor}" dominant-baseline="middle" class="axisLabel">${escapeXml(axis.label)}</text>`;
}

function renderDataSeries(entry, index, seriesCount) {
  const color = getSeriesColor(index);
  const dataPoints = versusAxes.map((axis) => getStatPoint(axis, entry.stats[axis.key]));
  const dataPointText = dataPoints.map(formatPoint).join(' ');
  const fillOpacity = seriesCount > 1 ? 0.58 : 0.84;
  const markerMarkup = dataPoints
    .map(([x, y]) => `<circle cx="${roundSvgNumber(x)}" cy="${roundSvgNumber(y)}" r="4.6" class="markerOuter" fill="${color.fill}" stroke="${color.stroke}"/><circle cx="${roundSvgNumber(x)}" cy="${roundSvgNumber(y)}" r="2.4" fill="${color.marker}"/>`)
    .join('\n');

  return `<polygon points="${dataPointText}" class="dataFill" fill="${color.fill}" fill-opacity="${fillOpacity}" stroke="${color.stroke}"/>
    ${markerMarkup}`;
}

function getStatPoint(axis, value) {
  const number = Math.max(0, toFiniteNumber(value) ?? 0);
  const interval = axis.valueAtRing / axis.referenceRing;
  const ringValue = interval > 0 ? number / interval : 0;
  const radius = (ringValue / ringCount) * outerRadius;
  return getPolarPoint(radius, axis.angle);
}

function getPolarPoint(radius, angle) {
  return [
    centerX + Math.cos(angle) * radius,
    centerY + Math.sin(angle) * radius,
  ];
}

function getLabelAnchor(cosine) {
  if (cosine > 0.25) {
    return 'start';
  }

  if (cosine < -0.25) {
    return 'end';
  }

  return 'middle';
}

function renderLegend(series, y = 18) {
  const entries = getLegendLayout(series, y);
  return entries.map((entry) => `
  <rect x="${entry.boxX}" y="${entry.y}" width="46" height="16" class="legendBox" fill="${entry.color.fill}" stroke="${entry.color.stroke}"/>
  <text x="${entry.textX}" y="${entry.y + 13}" class="legendText" fill="${entry.color.text}">${escapeXml(entry.text)}</text>`).join('\n');
}

function getLegendLayout(series, y = 18) {
  const maxNameLength = series.length > 2 ? 12 : 18;
  const entries = series.map((entry, index) => {
    const text = truncateText(entry.username.toUpperCase(), maxNameLength);
    const width = 46 + 10 + estimateLegendTextWidth(text) + 26;
    return {
      text,
      width,
      color: getSeriesColor(index),
    };
  });
  const totalWidth = entries.reduce((sum, entry) => sum + entry.width, 0) - 24;
  let cursorX = Math.max(16, Math.round((graphWidth - totalWidth) / 2));

  return entries.map((entry) => {
    const layout = {
      ...entry,
      boxX: cursorX,
      textX: cursorX + 56,
      y,
    };
    cursorX += entry.width;
    return layout;
  });
}

function getSeriesColor(index) {
  return graphSeriesPalette[index % graphSeriesPalette.length];
}

function estimateLegendTextWidth(text) {
  return text.length * 10.3;
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

function truncateText(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function formatPoint(point) {
  return point.map(roundSvgNumber).join(',');
}

function roundSvgNumber(value) {
  return Math.round(value * 1000) / 1000;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
