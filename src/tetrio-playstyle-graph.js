import sharp from 'sharp';

const graphWidth = 600;
const graphHeight = 400;
const graphOutputScale = 1.2;
const graphOutputWidth = Math.round(graphWidth * graphOutputScale);
const graphOutputHeight = Math.round(graphHeight * graphOutputScale);
const maxGraphValue = 1.5;
const graphStep = 0.25;
const outerRadius = 124;
const centerX = graphWidth / 2;
const centerY = 208;
const graphFontFamily = '"Noto Sans CJK KR", "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", Arial, sans-serif';

const graphAxes = [
  { key: 'opener', label: 'OPENER', dx: 0, dy: -1, labelX: centerX, labelY: centerY - outerRadius - 16, anchor: 'middle' },
  { key: 'stride', label: 'STRIDE', dx: 1, dy: 0, labelX: centerX + outerRadius + 16, labelY: centerY + 4, anchor: 'start' },
  { key: 'infiniteDs', label: 'INF DS', dx: 0, dy: 1, labelX: centerX, labelY: centerY + outerRadius + 28, anchor: 'middle' },
  { key: 'plonk', label: 'PLONK', dx: -1, dy: 0, labelX: centerX - outerRadius - 16, labelY: centerY + 4, anchor: 'end' },
];

const graphSeriesPalette = [
  { fill: '#9cc8b2', stroke: '#69a6ff', marker: '#b8d3c4', text: '#72a8ff' },
  { fill: '#35b9c8', stroke: '#d52ee8', marker: '#8de2ea', text: '#c184ff' },
  { fill: '#f2cf69', stroke: '#ffbf3f', marker: '#ffe99e', text: '#ffd572' },
  { fill: '#77d082', stroke: '#36df65', marker: '#b5efb9', text: '#8feea0' },
  { fill: '#f09a9a', stroke: '#ff6f91', marker: '#ffd0d0', text: '#ff99b2' },
];

export async function createTetrioPlaystyleGraph(input = {}) {
  const svg = renderTetrioPlaystyleGraphSvg(input);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function renderTetrioPlaystyleGraphSvg(input) {
  const series = normalizeGraphSeries(input);
  const ringValues = Array.from({ length: maxGraphValue / graphStep }, (_, index) => (index + 1) * graphStep);
  const gridMarkup = ringValues
    .map((value) => renderRing(value))
    .join('\n');
  const axisMarkup = graphAxes
    .map((axis) => renderAxis(axis))
    .join('\n');
  const labelMarkup = graphAxes
    .map((axis) => `<text x="${axis.labelX}" y="${axis.labelY}" text-anchor="${axis.anchor}" class="axisLabel">${escapeXml(axis.label)}</text>`)
    .join('\n');
  const dataMarkup = series
    .map((entry, index) => renderDataSeries(entry, index, series.length))
    .join('\n');
  const legendMarkup = renderLegend(series);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${graphOutputWidth}" height="${graphOutputHeight}" viewBox="0 0 ${graphWidth} ${graphHeight}">
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
    playstyle: normalizePlaystyle(entry?.stats),
  }));
}

function normalizePlaystyle(stats) {
  const playstyle = stats?.playstyle ?? {};
  return {
    opener: toFiniteNumber(playstyle.opener) ?? 0,
    stride: toFiniteNumber(playstyle.stride) ?? 0,
    infiniteDs: firstFiniteNumber(playstyle.infiniteDs, playstyle.infDs) ?? 0,
    plonk: toFiniteNumber(playstyle.plonk) ?? 0,
  };
}

function renderRing(value) {
  const points = graphAxes
    .map((axis) => getPoint(axis, value))
    .map(formatPoint)
    .join(' ');
  return `<polygon points="${points}" class="grid"/>`;
}

function renderAxis(axis) {
  const [x, y] = getPoint(axis, maxGraphValue);
  return `<line x1="${centerX}" y1="${centerY}" x2="${roundSvgNumber(x)}" y2="${roundSvgNumber(y)}" class="axis"/>`;
}

function renderDataSeries(entry, index, seriesCount) {
  const color = getSeriesColor(index);
  const dataPoints = graphAxes.map((axis) => getPoint(axis, entry.playstyle[axis.key]));
  const dataPointText = dataPoints.map(formatPoint).join(' ');
  const fillOpacity = seriesCount > 1 ? 0.58 : 0.84;
  const markerMarkup = dataPoints
    .map(([x, y]) => `<circle cx="${roundSvgNumber(x)}" cy="${roundSvgNumber(y)}" r="4.6" class="markerOuter" fill="${color.fill}" stroke="${color.stroke}"/><circle cx="${roundSvgNumber(x)}" cy="${roundSvgNumber(y)}" r="2.4" fill="${color.marker}"/>`)
    .join('\n');

  return `<polygon points="${dataPointText}" class="dataFill" fill="${color.fill}" fill-opacity="${fillOpacity}" stroke="${color.stroke}"/>
    ${markerMarkup}`;
}

function getPoint(axis, value) {
  const number = toFiniteNumber(value) ?? 0;
  const radius = (number / maxGraphValue) * outerRadius;
  return [
    centerX + axis.dx * radius,
    centerY + axis.dy * radius,
  ];
}

function renderLegend(series) {
  const entries = getLegendLayout(series);
  return entries.map((entry) => `
  <rect x="${entry.boxX}" y="${entry.y}" width="46" height="16" class="legendBox" fill="${entry.color.fill}" stroke="${entry.color.stroke}"/>
  <text x="${entry.textX}" y="${entry.y + 13}" class="legendText" fill="${entry.color.text}">${escapeXml(entry.text)}</text>`).join('\n');
}

function getLegendLayout(series) {
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
  const totalWidth = entries.reduce((sum, entry) => sum + entry.width, 0) - 26;
  let cursorX = Math.max(12, Math.round((graphWidth - totalWidth) / 2));

  return entries.map((entry) => {
    const layout = {
      ...entry,
      boxX: cursorX,
      textX: cursorX + 56,
      y: 18,
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
