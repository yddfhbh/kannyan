import {
  getTetrioHunDinFontDataUri,
  renderTetrioHunDinFontFace,
  renderTetrioNumericTextMarkup,
  renderTetrioSvgToPng,
  renderTetrioTextMarkup,
  renderTetrioTextWeightCss,
  shouldUseArialFallbackForHunDin,
  tetrioFontFamily,
  tetrioPhraseWordSpacing,
} from './tetrio-font.js';

const tetrioApiBaseUrl = 'https://ch.tetr.io/api';
const tetrioHeaders = {
  'User-Agent': 'discord-bot/1.0 TETR.IO record history',
};
const chartWidth = 1600;
const chartHeight = 1120;
const graphMargin = {
  left: 92,
  right: 52,
  top: 520,
  bottom: 132,
};
const historyFontFamily = tetrioFontFamily;
const modeConfigs = {
  '40l': {
    code: '40l',
    shortLabel: '40L',
    title: '40 LINES',
    accent: '#ef8f2f',
    accentSoft: '#ffcc8e',
    accentDim: '#6d3a12',
    metricKind: 'time',
    getMetricValue: (record) => Number(record?.results?.stats?.finaltime),
    getScoreflowValue: (rawValue) => Math.abs(Number(rawValue)),
    formatMainValue: formatTimeText,
    formatAxisValue: formatAxisTimeText,
    formatSummaryValue: formatTimeText,
    buildStats: buildFortyLinesStats,
  },
  blitz: {
    code: 'blitz',
    shortLabel: 'BLITZ',
    title: 'BLITZ',
    accent: '#f0b43a',
    accentSoft: '#ffe29b',
    accentDim: '#694e0f',
    metricKind: 'score',
    getMetricValue: (record) => Number(record?.results?.stats?.score),
    getScoreflowValue: (rawValue) => Number(rawValue),
    formatMainValue: formatInteger,
    formatAxisValue: formatCompactAxisNumber,
    formatSummaryValue: formatInteger,
    buildStats: buildBlitzStats,
  },
  zenith: {
    code: 'zenith',
    shortLabel: 'QP',
    title: 'QUICK PLAY',
    accent: '#69db73',
    accentSoft: '#bff8bc',
    accentDim: '#1f5a2b',
    metricKind: 'altitude',
    getMetricValue: (record) => Number(record?.results?.stats?.zenith?.altitude),
    getScoreflowValue: (rawValue) => Number(rawValue),
    formatMainValue: formatAltitudeText,
    formatAxisValue: formatAxisAltitudeText,
    formatSummaryValue: formatAltitudeText,
    buildStats: buildQuickPlayHistoryStats,
  },
  zenithex: {
    code: 'zenithex',
    shortLabel: 'EXQP',
    title: 'EXPERT QUICK PLAY',
    accent: '#49d3ff',
    accentSoft: '#b1f0ff',
    accentDim: '#0f5268',
    metricKind: 'altitude',
    getMetricValue: (record) => Number(record?.results?.stats?.zenith?.altitude),
    getScoreflowValue: (rawValue) => Number(rawValue),
    formatMainValue: formatAltitudeText,
    formatAxisValue: formatAxisAltitudeText,
    formatSummaryValue: formatAltitudeText,
    buildStats: buildQuickPlayHistoryStats,
  },
};

export async function createTetrioRecordHistoryCard(username, mode = '40l') {
  const normalizedUsername = normalizeTetrioUsername(username);
  const config = modeConfigs[mode] ?? modeConfigs['40l'];

  if (!normalizedUsername) {
    const error = new Error('TETR.IO username is required');
    error.status = 400;
    throw error;
  }

  const data = await fetchTetrioRecordHistoryData(normalizedUsername, config);
  const svg = renderTetrioRecordHistorySvg(data, config);
  const image = renderTetrioSvgToPng(svg);

  return {
    image,
    mode: config.code,
    username: data.username,
  };
}

async function fetchTetrioRecordHistoryData(username, config) {
  const sessionId = `discord-bot-tetrio-record-history-${config.code}`;
  const [userResult, summariesResult, scoreflowResult, progressionResult] = await Promise.allSettled([
    fetchTetrioJson(`/users/${encodeURIComponent(username)}`, sessionId),
    fetchTetrioJson(`/users/${encodeURIComponent(username)}/summaries`, sessionId),
    fetchTetrioJson(`/labs/scoreflow/${encodeURIComponent(username)}/${config.code}`, sessionId),
    fetchTetrioJson(`/users/${encodeURIComponent(username)}/records/${config.code}/progression?limit=100`, sessionId),
  ]);

  const userBody = unwrapSettledResult(userResult, true);
  const summariesBody = unwrapSettledResult(summariesResult, false);
  const scoreflowBody = unwrapSettledResult(scoreflowResult, false);
  const progressionBody = unwrapSettledResult(progressionResult, false);
  const canonicalUsername = String(userBody?.data?.username ?? username).trim() || username;
  const summary = summariesBody?.data?.[config.code] ?? null;
  const bestRecord = getBestRecord(summary, progressionBody?.data?.entries, config);
  const allPoints = normalizeScoreflowPoints(scoreflowBody?.data, config);
  const progressionPoints = normalizeProgressionPoints(progressionBody?.data?.entries, config);
  const pbPoints = progressionPoints.length > 0
    ? progressionPoints
    : allPoints.filter((point) => point.isPb);
  const latestPoint = getLatestPoint(allPoints, pbPoints, bestRecord, config);

  if (!bestRecord && allPoints.length === 0 && pbPoints.length === 0) {
    const error = new Error('No record history found for the requested user');
    error.code = 'NO_RECORD';
    error.status = 404;
    throw error;
  }

  const statsSourceRecord = bestRecord ?? progressionBody?.data?.entries?.[0] ?? null;
  const [hunFontDataUri] = await Promise.all([
    getTetrioHunDinFontDataUri(),
  ]);

  return {
    username: canonicalUsername,
    updatedAt: new Date(),
    bestRecord,
    summary,
    statsRows: config.buildStats(statsSourceRecord),
    allPoints,
    pbPoints,
    latestPoint,
    globalRank: Number(summary?.rank),
    countryRank: Number(summary?.rank_local),
    hunFontDataUri,
    modeLabel: config.shortLabel,
    modeTitle: config.title,
  };
}

function unwrapSettledResult(result, required) {
  if (result.status === 'fulfilled') {
    return result.value;
  }

  if (required || result.reason?.status === 404) {
    throw result.reason;
  }

  return null;
}

function getBestRecord(summary, progressionEntries, config) {
  const summaryRecord = isRecordLike(summary?.record, config)
    ? summary.record
    : null;
  if (summaryRecord) {
    return summaryRecord;
  }

  const entries = Array.isArray(progressionEntries)
    ? progressionEntries
    : [];
  return entries.find((entry) => isRecordLike(entry, config)) ?? null;
}

function isRecordLike(record, config) {
  const metricValue = config.getMetricValue(record);
  return Number.isFinite(metricValue) && metricValue > 0;
}

function normalizeScoreflowPoints(data, config) {
  const startTime = Number(data?.startTime);
  const rawPoints = Array.isArray(data?.points)
    ? data.points
    : [];

  if (!Number.isFinite(startTime) || startTime <= 0) {
    return [];
  }

  return rawPoints
    .map((entry) => {
      if (!Array.isArray(entry) || entry.length < 3) {
        return null;
      }

      const offset = Number(entry[0]);
      const pbFlag = Number(entry[1]);
      const rawValue = entry[2];
      const metricValue = config.getScoreflowValue(rawValue);

      if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(metricValue) || metricValue <= 0) {
        return null;
      }

      return {
        ts: startTime + offset,
        metricValue,
        isPb: pbFlag === 1,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.ts - right.ts || left.metricValue - right.metricValue);
}

function normalizeProgressionPoints(entries, config) {
  const records = Array.isArray(entries)
    ? entries
    : [];

  return records
    .map((record) => {
      const ts = Date.parse(record?.ts ?? '');
      const metricValue = config.getMetricValue(record);
      if (!Number.isFinite(ts) || !Number.isFinite(metricValue) || metricValue <= 0) {
        return null;
      }

      return {
        ts,
        metricValue,
        isPb: true,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.ts - right.ts || left.metricValue - right.metricValue);
}

function getLatestPoint(allPoints, pbPoints, bestRecord, config) {
  if (allPoints.length > 0) {
    return allPoints.at(-1);
  }

  if (pbPoints.length > 0) {
    return pbPoints.at(-1);
  }

  const ts = Date.parse(bestRecord?.ts ?? '');
  const metricValue = config.getMetricValue(bestRecord);
  if (!Number.isFinite(ts) || !Number.isFinite(metricValue) || metricValue <= 0) {
    return null;
  }

  return {
    ts,
    metricValue,
    isPb: true,
  };
}

async function fetchTetrioJson(path, sessionId) {
  const response = await fetch(`${tetrioApiBaseUrl}${path}`, {
    headers: {
      ...tetrioHeaders,
      'X-Session-ID': sessionId,
    },
  });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    const error = new Error(body?.error?.msg ?? `TETR.IO API responded with ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return body;
}

function normalizeTetrioUsername(input) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/^\/u\/([^/]+)/i);
    if (match) {
      return decodeURIComponent(match[1]).trim().toLowerCase();
    }
  } catch {
    // Plain usernames are expected most of the time.
  }

  return trimmed.replace(/^@+/, '').toLowerCase();
}

function renderTetrioRecordHistorySvg(data, config) {
  const topPanelY = 24;
  const topPanelHeight = 464;
  const topStatsLayout = {
    leftX: 58,
    rightX: 820,
    rowTop: 338,
    columnWidth: 642,
    rowHeight: 34,
    separatorLeft: 54,
    separatorRight: chartWidth - 54,
    dividerX: 794,
  };
  const graphPanelX = 26;
  const graphPanelY = 508;
  const graphPanelWidth = chartWidth - 52;
  const graphPanelHeight = chartHeight - graphPanelY - 28;
  const graphPanelBottom = graphPanelY + graphPanelHeight;
  const graphTitleX = 58;
  const graphTitleY = graphPanelY + 38;
  const graphLeft = 110;
  const graphTop = graphPanelY + 72;
  const graphRight = chartWidth - 50;
  const graphBottom = graphPanelBottom - 88;
  const graphInnerWidth = graphRight - graphLeft;
  const graphInnerHeight = graphBottom - graphTop;
  const allGraphPoints = data.allPoints.length > 0
    ? data.allPoints
    : data.pbPoints;
  const graphDomain = getGraphDomain(allGraphPoints, data.pbPoints, data.bestRecord, config);
  const scatterMarkup = renderScatterPoints(allGraphPoints, graphDomain, config, graphLeft, graphTop, graphInnerWidth, graphInnerHeight);
  const pbPathMarkup = renderProgressionPath(data.pbPoints, graphDomain, config, graphLeft, graphTop, graphInnerWidth, graphInnerHeight);
  const pbMarkersMarkup = renderPbMarkers(data.pbPoints, graphDomain, config, graphLeft, graphTop, graphInnerWidth, graphInnerHeight);
  const gridMarkup = renderGrid(graphDomain, config, graphLeft, graphTop, graphInnerWidth, graphInnerHeight);
  const xLabelsMarkup = renderXAxisLabels(graphDomain, graphLeft, graphTop, graphInnerWidth, graphInnerHeight);
  const yLabelsMarkup = renderYAxisLabels(graphDomain, config, graphLeft, graphTop, graphInnerWidth, graphInnerHeight);
  const mainValue = config.formatMainValue(config.getMetricValue(data.bestRecord) || data.latestPoint?.metricValue || 0);
  const mainValueMarkup = renderHistoryNumberMarkup(mainValue, {
    dotFontSize: '1.22em',
    dotDyEm: 0.02,
    commaDxEm: -0.4,
  });
  const bestTs = data.bestRecord?.ts ?? (data.pbPoints.at(-1)?.ts ? new Date(data.pbPoints.at(-1).ts).toISOString() : null);
  const lastPlayedText = data.latestPoint?.ts
    ? formatKstDateTime(data.latestPoint.ts)
    : '-';
  const footerMarkup = renderHistoryFooterMarkup(allGraphPoints.length, data.pbPoints.length);
  const summaryText = bestTs
    ? `PB ACHIEVED ${formatKstDateTime(bestTs)}`
    : 'PB ACHIEVED -';
  const globalRankText = Number.isFinite(data.globalRank) && data.globalRank > 0
    ? `#${formatInteger(data.globalRank)}`
    : '-';
  const countryRankText = Number.isFinite(data.countryRank) && data.countryRank > 0
    ? `#${formatInteger(data.countryRank)}`
    : '-';
  const statsMarkup = renderStatsGrid(data.statsRows, config, topStatsLayout);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${chartWidth}" height="${chartHeight}" viewBox="0 0 ${chartWidth} ${chartHeight}">
  <defs>
    <linearGradient id="pageBg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#0d130d"/>
      <stop offset="1" stop-color="#101610"/>
    </linearGradient>
    <linearGradient id="panelBg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#1a2919"/>
      <stop offset="1" stop-color="#121d12"/>
    </linearGradient>
    <linearGradient id="chartGlow" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${config.accent}" stop-opacity="0.40"/>
      <stop offset="1" stop-color="${config.accent}" stop-opacity="0"/>
    </linearGradient>
    <filter id="mainGlow" x="-20%" y="-35%" width="140%" height="170%">
      <feGaussianBlur stdDeviation="7" result="blur"/>
      <feColorMatrix
        in="blur"
        type="matrix"
        values="1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 1 0"
        result="colored"/>
      <feMerge>
        <feMergeNode in="colored"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <style>
      ${renderTetrioHunDinFontFace(data.hunFontDataUri)}
      text {
        font-family: ${historyFontFamily};
        letter-spacing: 0;
        ${renderTetrioTextWeightCss()}
      }
      .eyebrow { fill: ${config.accentSoft}; font-size: 26px; font-weight: 700; letter-spacing: 2px; word-spacing: ${tetrioPhraseWordSpacing}; }
      .modeTag { fill: #fff4e4; font-size: 48px; font-weight: 900; letter-spacing: 1px; }
      .username { fill: #e7ffe4; font-size: 48px; font-weight: 850; }
      .mainValue { fill: #e7ffe1; font-size: 86px; font-weight: 950; stroke: rgba(235, 255, 230, 0.55); stroke-width: 1.05px; paint-order: stroke fill; }
      .summary { fill: #c8d9c2; font-size: 27px; font-weight: 650; letter-spacing: 1px; word-spacing: ${tetrioPhraseWordSpacing}; }
      .boxLabel { fill: #b7c5b2; font-size: 22px; font-weight: 700; letter-spacing: 1.5px; }
      .boxValue { fill: #f6fff0; font-size: 48px; font-weight: 900; }
      .statsLabel { fill: #8eaf88; font-size: 24px; font-weight: 650; letter-spacing: 1.5px; word-spacing: ${tetrioPhraseWordSpacing}; }
      .statsValue { fill: #eef7ea; font-size: 29px; font-weight: 750; }
      .graphTitle { fill: #cbe3c6; font-size: 28px; font-weight: 760; letter-spacing: 1.8px; word-spacing: ${tetrioPhraseWordSpacing}; }
      .axisLabel { fill: ${config.accentSoft}; font-size: 22px; font-weight: 700; }
      .footer { fill: #9bb395; font-size: 22px; font-weight: 650; letter-spacing: 1px; }
    </style>
  </defs>

  <rect width="${chartWidth}" height="${chartHeight}" fill="url(#pageBg)"/>
  <rect x="26" y="${topPanelY}" width="${chartWidth - 52}" height="${topPanelHeight}" rx="6" fill="url(#panelBg)" stroke="${config.accentDim}" stroke-width="4"/>
  <path d="M 26 ${topPanelY} L 320 ${topPanelY} L 358 70 L 26 70 Z" fill="${config.accent}"/>
  <text x="48" y="62" class="modeTag">${escapeXml(data.modeLabel)}</text>
  <text x="${chartWidth - 54}" y="76" text-anchor="end" class="username">${renderTetrioTextMarkup(String(data.username ?? '').toUpperCase())}</text>

  <text x="58" y="138" class="eyebrow">PERSONAL BEST</text>
  <text x="58" y="222" class="mainValue" filter="url(#mainGlow)">${mainValueMarkup}</text>
  <text x="58" y="276" class="summary">${escapeXml(summaryText)}</text>
  <text x="58" y="316" class="summary">LAST PLAYED ${escapeXml(lastPlayedText)}</text>

  <rect x="${chartWidth - 444}" y="112" width="196" height="124" fill="#0c120c" stroke="${config.accentDim}" stroke-width="3"/>
  <text x="${chartWidth - 346}" y="153" text-anchor="middle" class="boxLabel">GLOBAL</text>
  <text x="${chartWidth - 346}" y="208" text-anchor="middle" class="boxValue">${renderTetrioNumericTextMarkup(globalRankText)}</text>

  <rect x="${chartWidth - 252}" y="112" width="196" height="124" fill="#151b15" stroke="${config.accentSoft}" stroke-width="4"/>
  <text x="${chartWidth - 154}" y="153" text-anchor="middle" class="boxLabel">COUNTRY</text>
  <text x="${chartWidth - 154}" y="208" text-anchor="middle" class="boxValue">${renderTetrioNumericTextMarkup(countryRankText)}</text>

  ${statsMarkup}

  <rect x="${graphPanelX}" y="${graphPanelY}" width="${graphPanelWidth}" height="${graphPanelHeight}" rx="6" fill="#0c110c" stroke="${config.accentDim}" stroke-width="4"/>
  <rect x="${graphLeft}" y="${graphTop}" width="${graphInnerWidth}" height="${graphInnerHeight}" fill="url(#chartGlow)" opacity="0.45"/>
  <text x="${graphTitleX}" y="${graphTitleY}" class="graphTitle">${escapeXml(`${data.modeTitle} HISTORY`)}</text>
  ${gridMarkup}
  ${scatterMarkup}
  ${pbPathMarkup}
  ${pbMarkersMarkup}
  ${xLabelsMarkup}
  ${yLabelsMarkup}

  <text x="${graphTitleX}" y="${graphPanelBottom - 18}" class="footer">${footerMarkup}</text>
</svg>`;
}

function renderStatsGrid(rows, config, layout = {}) {
  const visibleRows = rows.slice(0, 8);
  const leftX = layout.leftX ?? 58;
  const rightX = layout.rightX ?? 814;
  const rowTop = layout.rowTop ?? 338;
  const columnWidth = layout.columnWidth ?? 660;
  const rowHeight = layout.rowHeight ?? 34;
  const separatorLeft = layout.separatorLeft ?? leftX;
  const separatorRight = layout.separatorRight ?? (rightX + columnWidth);
  const dividerX = layout.dividerX ?? 794;
  const rowCount = Math.ceil(visibleRows.length / 2);
  const horizontalLinesMarkup = Array.from({ length: rowCount + 1 }, (_, index) => {
    const lineY = rowTop + rowHeight * index;
    const isEdge = index === 0 || index === rowCount;
    return `
  <line x1="${separatorLeft}" y1="${roundSvgNumber(lineY)}" x2="${separatorRight}" y2="${roundSvgNumber(lineY)}" stroke="${isEdge ? '#d0e4cc' : config.accentSoft}" stroke-opacity="${isEdge ? '0.48' : '0.24'}" stroke-width="${isEdge ? '2.2' : '1.8'}"/>`;
  }).join('');
  const verticalDividerMarkup = `
  <line x1="${dividerX}" y1="${roundSvgNumber(rowTop + 8)}" x2="${dividerX}" y2="${roundSvgNumber(rowTop + rowHeight * rowCount - 8)}" stroke="${config.accentSoft}" stroke-opacity="0.14" stroke-width="1.6"/>`;

  const rowsMarkup = visibleRows.map((row, index) => {
    const column = index % 2;
    const rowIndex = Math.floor(index / 2);
    const x = column === 0 ? leftX : rightX;
    const y = rowTop + rowHeight * rowIndex + rowHeight / 2;
    const valueX = x + columnWidth;
    const valueWidth = estimateStatWidth(row.value);
    const lineStartX = x + 144;
    const lineEndX = valueX - valueWidth;

    return `
  <text x="${x}" y="${roundSvgNumber(y)}" dominant-baseline="middle" class="statsLabel">${escapeXml(row.label)}</text>
  <line x1="${roundSvgNumber(lineStartX)}" y1="${roundSvgNumber(y)}" x2="${roundSvgNumber(Math.max(lineStartX + 18, lineEndX - 16))}" y2="${roundSvgNumber(y)}" stroke="${config.accentSoft}" stroke-opacity="0.20" stroke-width="1.6" stroke-dasharray="2 4"/>
  <text x="${roundSvgNumber(valueX)}" y="${roundSvgNumber(y)}" text-anchor="end" dominant-baseline="middle" class="statsValue">${renderHistoryStatsValueMarkup(row.value)}</text>`;
  }).join('');

  return `${horizontalLinesMarkup}${verticalDividerMarkup}${rowsMarkup}`;
}

function renderHistoryStatsValueMarkup(value) {
  const text = String(value ?? '');
  return /[.,]/.test(text)
    ? renderHistoryNumberMarkup(text, {
      dotFontSize: '1.08em',
      dotDyEm: 0.01,
      commaDxEm: -0.4,
    })
    : renderTetrioNumericTextMarkup(text);
}

function renderHistoryFooterMarkup(runCount, pbCount) {
  return `${renderTetrioNumericTextMarkup(formatInteger(runCount))} RUNS / ${renderTetrioNumericTextMarkup(formatInteger(pbCount))} PBS`;
}

function renderHistoryAxisLabelMarkup(value) {
  const text = String(value ?? '');
  return /[.,]/.test(text)
    ? renderHistoryNumberMarkup(text, {
      dotFontSize: '1.06em',
      dotDyEm: 0.01,
      commaDxEm: -0.4,
    })
    : escapeXml(text);
}

function renderHistoryNumberMarkup(value, options = {}) {
  const text = String(value ?? '');
  const dotFontSize = options.dotFontSize ?? '1.12em';
  const dotDyEm = Number(options.dotDyEm) || 0;
  const commaDxEm = Number(options.commaDxEm) || -0.4;
  let markup = '';
  let tightenNext = false;
  let resetDyEm = 0;

  for (const char of text) {
    if (char === '.') {
      const dy = dotDyEm ? ` dy="${dotDyEm}em"` : '';
      markup += `<tspan${dy} font-family="Arial" font-size="${dotFontSize}" stroke="none">.</tspan>`;
      tightenNext = false;
      resetDyEm = dotDyEm;
      continue;
    }

    const dx = tightenNext && /\d/.test(char)
      ? ` dx="${roundSvgNumber(commaDxEm)}em"`
      : '';
    const dy = resetDyEm
      ? ` dy="${roundSvgNumber(-resetDyEm)}em"`
      : '';
    const fontFamilyAttr = shouldUseArialFallbackForHunDin(char)
      ? ' font-family="Arial"'
      : '';
    const escaped = escapeXml(char);

    if (dx || dy || fontFamilyAttr) {
      markup += `<tspan${fontFamilyAttr}${dx}${dy}>${escaped}</tspan>`;
    } else {
      markup += escaped;
    }

    tightenNext = char === ',';
    resetDyEm = 0;
  }

  return markup;
}

function getGraphDomain(points, pbPoints, bestRecord, config) {
  const allSeries = [...points, ...pbPoints];
  if (allSeries.length === 0) {
    const bestTs = Date.parse(bestRecord?.ts ?? '') || Date.now();
    const bestMetric = config.getMetricValue(bestRecord) || 1;
    return {
      minTs: bestTs - 86_400_000,
      maxTs: bestTs + 86_400_000,
      minValue: Math.max(0.1, bestMetric * 0.96),
      maxValue: bestMetric * 1.04,
    };
  }

  const timestamps = allSeries.map((point) => point.ts);
  const values = allSeries.map((point) => point.metricValue);
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valuePadding = Math.max(0.1, (maxValue - minValue) * 0.08, maxValue * 0.02);
  const safeMaxTs = maxTs > minTs ? maxTs : minTs + 86_400_000;

  return {
    minTs,
    maxTs: safeMaxTs,
    minValue: Math.max(0.1, minValue - valuePadding),
    maxValue: maxValue + valuePadding,
  };
}

function renderGrid(domain, config, x, y, width, height) {
  const horizontalLines = [];
  const verticalLines = [];

  for (let index = 0; index < 6; index += 1) {
    const t = index / 5;
    const lineY = y + t * height;
    horizontalLines.push(
      `<line x1="${x}" y1="${roundSvgNumber(lineY)}" x2="${x + width}" y2="${roundSvgNumber(lineY)}" stroke="${config.accentSoft}" stroke-opacity="${index === 5 ? '0.30' : '0.16'}" stroke-width="${index === 5 ? '2.2' : '1.4'}"/>`
    );
    const lineX = x + t * width;
    verticalLines.push(
      `<line x1="${roundSvgNumber(lineX)}" y1="${y}" x2="${roundSvgNumber(lineX)}" y2="${y + height}" stroke="${config.accentSoft}" stroke-opacity="0.12" stroke-width="1.2"/>`
    );
  }

  return [...horizontalLines, ...verticalLines].join('');
}

function renderScatterPoints(points, domain, config, x, y, width, height) {
  if (points.length === 0) {
    return '';
  }

  const dotRadius = points.length > 2500 ? 2.5 : 3.1;

  return points.map((point) => {
    const cx = mapGraphX(point.ts, domain, x, width);
    const cy = mapGraphY(point.metricValue, domain, y, height);
    return `<circle cx="${roundSvgNumber(cx)}" cy="${roundSvgNumber(cy)}" r="${dotRadius}" fill="${config.accent}" fill-opacity="0.52"/>`;
  }).join('');
}

function renderProgressionPath(points, domain, config, x, y, width, height) {
  if (points.length === 0) {
    return '';
  }

  const commands = [];
  points.forEach((point, index) => {
    const px = mapGraphX(point.ts, domain, x, width);
    const py = mapGraphY(point.metricValue, domain, y, height);
    if (index === 0) {
      commands.push(`M ${roundSvgNumber(px)} ${roundSvgNumber(py)}`);
      return;
    }

    commands.push(`H ${roundSvgNumber(px)}`);
    commands.push(`V ${roundSvgNumber(py)}`);
  });

  const lastPoint = points.at(-1);
  const lastY = mapGraphY(lastPoint.metricValue, domain, y, height);
  const lastX = mapGraphX(lastPoint.ts, domain, x, width);
  const bottomY = y + height;
  const areaPath = [
    ...commands,
    `H ${roundSvgNumber(x + width)}`,
    `L ${roundSvgNumber(x + width)} ${roundSvgNumber(bottomY)}`,
    `L ${roundSvgNumber(x)} ${roundSvgNumber(bottomY)}`,
    `L ${roundSvgNumber(x)} ${roundSvgNumber(mapGraphY(points[0].metricValue, domain, y, height))}`,
    'Z',
  ].join(' ');

  return `
  <path d="${areaPath}" fill="${config.accent}" fill-opacity="0.20"/>
  <path d="${commands.join(' ')} H ${roundSvgNumber(x + width)}" fill="none" stroke="${config.accent}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
}

function renderPbMarkers(points, domain, config, x, y, width, height) {
  if (points.length === 0) {
    return '';
  }

  return points.map((point) => {
    const cx = mapGraphX(point.ts, domain, x, width);
    const cy = mapGraphY(point.metricValue, domain, y, height);
    const size = 6.4;
    return `<rect x="${roundSvgNumber(cx - size)}" y="${roundSvgNumber(cy - size)}" width="${size * 2}" height="${size * 2}" fill="#ffffff" stroke="${config.accent}" stroke-width="2" transform="rotate(45 ${roundSvgNumber(cx)} ${roundSvgNumber(cy)})"/>`;
  }).join('');
}

function renderXAxisLabels(domain, x, y, width, height) {
  const labels = [];
  for (let index = 0; index < 6; index += 1) {
    const t = index / 5;
    const ts = domain.minTs + (domain.maxTs - domain.minTs) * t;
    const labelX = x + width * t;
    labels.push(
      `<text x="${roundSvgNumber(labelX)}" y="${y + height + 42}" text-anchor="${index === 0 ? 'start' : index === 5 ? 'end' : 'middle'}" class="axisLabel">${escapeXml(formatShortKstDate(ts))}</text>`
    );
  }
  return labels.join('');
}

function renderYAxisLabels(domain, config, x, y, width, height) {
  const labels = [];
  for (let index = 0; index < 6; index += 1) {
    const t = index / 5;
    const value = domain.maxValue - (domain.maxValue - domain.minValue) * t;
    const labelY = y + height * t + 8;
    const labelText = config.formatAxisValue(value);
    labels.push(
      `<text x="${x - 14}" y="${roundSvgNumber(labelY)}" text-anchor="end" class="axisLabel">${renderHistoryAxisLabelMarkup(labelText)}</text>`
    );
  }
  return labels.join('');
}

function mapGraphX(ts, domain, graphX, graphWidth) {
  if (domain.maxTs === domain.minTs) {
    return graphX + graphWidth / 2;
  }

  return graphX + ((ts - domain.minTs) / (domain.maxTs - domain.minTs)) * graphWidth;
}

function mapGraphY(value, domain, graphY, graphHeight) {
  if (domain.maxValue === domain.minValue) {
    return graphY + graphHeight / 2;
  }

  return graphY + ((domain.maxValue - value) / (domain.maxValue - domain.minValue)) * graphHeight;
}

function buildFortyLinesStats(record) {
  const stats = record?.results?.stats ?? {};
  const pieces = Number(stats.piecesplaced);
  const inputs = Number(stats.inputs);
  const finalTimeMs = Number(stats.finaltime);
  const pps = Number(record?.results?.aggregatestats?.pps);
  const quads = Number(stats?.clears?.quads);

  return [
    { label: 'PIECES', value: formatInteger(pieces) },
    { label: 'KPP', value: formatFixed(inputs / pieces, 2) },
    { label: 'PPS', value: formatFixed(pps, 2) },
    { label: 'KPS', value: formatFixed(inputs / (finalTimeMs / 1000), 2) },
    { label: 'FINESSE', value: formatFinesseText(stats) },
    { label: 'QUADS', value: formatInteger(quads) },
  ].filter((row) => row.value !== '-');
}

function buildBlitzStats(record) {
  const stats = record?.results?.stats ?? {};
  const pieces = Number(stats.piecesplaced);
  const pps = Number(record?.results?.aggregatestats?.pps);
  const score = Number(stats.score);

  return [
    { label: 'PIECES', value: formatInteger(pieces) },
    { label: 'SPP', value: formatFixed(score / pieces, 1) },
    { label: 'PPS', value: formatFixed(pps, 2) },
    { label: 'LEVEL', value: formatInteger(stats.level) },
    { label: 'FINESSE', value: formatFinesseText(stats) },
    { label: 'QUADS', value: formatInteger(stats?.clears?.quads) },
    { label: 'T-SPINS', value: formatInteger(stats.tspins) },
    { label: 'ALL CLEARS', value: formatInteger(stats?.clears?.allclear) },
  ].filter((row) => row.value !== '-');
}

function buildQuickPlayHistoryStats(record) {
  const stats = record?.results?.stats ?? {};
  const zenith = stats.zenith ?? {};
  const extrasZenith = record?.extras?.zenith ?? {};
  const pps = Number(record?.results?.aggregatestats?.pps);
  const apm = Number(record?.results?.aggregatestats?.apm);
  const vs = Number(record?.results?.aggregatestats?.vsscore);
  const mods = Array.isArray(extrasZenith.mods) && extrasZenith.mods.length > 0
    ? extrasZenith.mods.join(', ').toUpperCase()
    : 'NORMAL';

  return [
    { label: 'PIECES', value: formatInteger(stats.piecesplaced) },
    { label: 'FLOOR', value: formatInteger(zenith.floor) },
    { label: 'PPS', value: formatFixed(pps, 2) },
    { label: 'APM', value: formatFixed(apm, 1) },
    { label: 'FINESSE', value: formatFinesseText(stats) },
    { label: 'VS', value: formatFixed(vs, 1) },
    { label: 'KILLS', value: formatInteger(stats.kills) },
    { label: 'MODS', value: mods },
  ].filter((row) => row.value !== '-');
}

function formatFinesseText(stats) {
  const faults = Number(stats?.finesse?.faults);
  const perfectPieces = Number(stats?.finesse?.perfectpieces);
  const pieces = Number(stats?.piecesplaced);
  const accuracy = perfectPieces > 0 && pieces > 0
    ? `${formatFixed((perfectPieces / pieces) * 100, 2)}%`
    : null;

  if (!Number.isFinite(faults) && !accuracy) {
    return '-';
  }

  if (Number.isFinite(faults) && accuracy) {
    return `${formatInteger(faults)}F (${accuracy})`;
  }

  return Number.isFinite(faults)
    ? `${formatInteger(faults)}F`
    : accuracy;
}

function formatTimeText(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return '-';
  }

  const totalMilliseconds = Math.round(milliseconds);
  const minutes = Math.floor(totalMilliseconds / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const remainder = Math.abs(totalMilliseconds % 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(remainder).padStart(3, '0')}`;
}

function formatAxisTimeText(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return '-';
  }

  return formatFixed(milliseconds / 1000, 1);
}

function formatAltitudeText(value) {
  const altitude = Number(value);
  if (!Number.isFinite(altitude) || altitude <= 0) {
    return '-';
  }

  return `${formatFixed(altitude, 1)}M`;
}

function formatAxisAltitudeText(value) {
  const altitude = Number(value);
  if (!Number.isFinite(altitude) || altitude <= 0) {
    return '-';
  }

  return formatFixed(altitude, 0);
}

function formatCompactAxisNumber(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return '-';
  }

  if (numericValue >= 1_000_000) {
    return `${formatFixed(numericValue / 1_000_000, 1)}M`;
  }

  if (numericValue >= 1_000) {
    return `${formatFixed(numericValue / 1_000, 0)}K`;
  }

  return formatInteger(numericValue);
}

function formatInteger(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return '-';
  }

  return Math.round(numericValue).toLocaleString('en-US');
}

function formatFixed(value, digits) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return '-';
  }

  return numericValue.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatShortKstDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '0';
  const day = parts.find((part) => part.type === 'day')?.value ?? '0';
  return `${year}. ${month}. ${day}.`;
}

function formatKstDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '00';
  const day = parts.find((part) => part.type === 'day')?.value ?? '00';
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${year}.${month}.${day} ${hour}:${minute} KST`;
}

function estimateStatWidth(value) {
  const text = String(value ?? '');
  return text.length * 14.4;
}

function roundSvgNumber(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, '');
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

