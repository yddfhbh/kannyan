import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  getTetrioHunDinFontDataUri,
  renderTetrioHunDinFontFace,
  renderTetrioTextWeightCss,
  renderTetrioSvgToPng,
  tetrioFontFamily,
  tetrioPhraseWordSpacing,
} from './tetrio-font.js';

const tetrioApiBaseUrl = 'https://ch.tetr.io/api';
const tetrioHeaders = {
  'User-Agent': 'discord-bot/1.0 TETR.IO quick play altitude',
  'X-Session-ID': 'discord-bot-tetrio-quickplay',
};
const tetrioRecordPageSize = 100;
const quickPlayFontFamily = tetrioFontFamily;
const tetrioQuickPlayModes = {
  zenith: {
    code: 'zenith',
    title: 'FINAL ALTITUDE',
    unit: 'M',
    getMainValue: getQuickPlayAltitude,
    formatMainValue: formatAltitudeText,
    buildStatsRows: buildQuickPlayStatsRows,
    valueKey: 'altitude',
    textKey: 'altitudeText',
    notFoundMessage: 'No quick play record found for the requested position',
    unavailableMessage: 'Quick play altitude is unavailable',
  },
  zenithex: {
    code: 'zenithex',
    title: 'FINAL ALTITUDE',
    unit: 'M',
    getMainValue: getQuickPlayAltitude,
    formatMainValue: formatAltitudeText,
    buildStatsRows: buildQuickPlayStatsRows,
    valueKey: 'altitude',
    textKey: 'altitudeText',
    notFoundMessage: 'No expert quick play record found for the requested position',
    unavailableMessage: 'Expert quick play altitude is unavailable',
  },
  '40l': {
    code: '40l',
    title: 'FINAL TIME',
    unit: '',
    getMainValue: getFortyLinesFinalTime,
    formatMainValue: formatQuickPlayTime,
    buildStatsRows: buildFortyLinesStatsRows,
    mainValueFormat: 'timeSplitDecimal',
    valueKey: 'finalTime',
    textKey: 'finalTimeText',
    notFoundMessage: 'No 40 Lines record found for the requested position',
    unavailableMessage: '40 Lines final time is unavailable',
  },
  blitz: {
    code: 'blitz',
    title: 'FINAL SCORE',
    unit: '',
    getMainValue: getBlitzScore,
    formatMainValue: formatInteger,
    buildStatsRows: buildBlitzStatsRows,
    valueKey: 'score',
    textKey: 'scoreText',
    notFoundMessage: 'No Blitz record found for the requested position',
    unavailableMessage: 'Blitz score is unavailable',
  },
};
const quickPlayFloorNames = [
  'Hall of Beginnings',
  'The Hotel',
  'The Casino',
  'The Arena',
  'The Museum',
  'Abondoned Office',
  'The Laboratory',
  'The Core',
  'Corruption',
  'Platform of the Gods',
];
const localQuickPlayModIconPaths = {
  allspin: fileURLToPath(new URL('../assets/zenith-mods/allspin.png', import.meta.url)),
  allspin_reversed: fileURLToPath(new URL('../assets/zenith-mods/allspin_reversed.png', import.meta.url)),
  doublehole: fileURLToPath(new URL('../assets/zenith-mods/doublehole.png', import.meta.url)),
  doublehole_reversed: fileURLToPath(new URL('../assets/zenith-mods/doublehole_reversed.png', import.meta.url)),
  expert: fileURLToPath(new URL('../assets/zenith-mods/expert.png', import.meta.url)),
  expert_reversed: fileURLToPath(new URL('../assets/zenith-mods/expert_reversed.png', import.meta.url)),
  gravity: fileURLToPath(new URL('../assets/zenith-mods/gravity.png', import.meta.url)),
  gravity_reversed: fileURLToPath(new URL('../assets/zenith-mods/gravity_reversed.png', import.meta.url)),
  invisible: fileURLToPath(new URL('../assets/zenith-mods/invisible.png', import.meta.url)),
  invisible_reversed: fileURLToPath(new URL('../assets/zenith-mods/invisible_reversed.png', import.meta.url)),
  messy: fileURLToPath(new URL('../assets/zenith-mods/messy.png', import.meta.url)),
  messy_reversed: fileURLToPath(new URL('../assets/zenith-mods/messy_reversed.png', import.meta.url)),
  nohold: fileURLToPath(new URL('../assets/zenith-mods/nohold.png', import.meta.url)),
  nohold_reversed: fileURLToPath(new URL('../assets/zenith-mods/nohold_reversed.png', import.meta.url)),
  volatile: fileURLToPath(new URL('../assets/zenith-mods/volatile.png', import.meta.url)),
  volatile_reversed: fileURLToPath(new URL('../assets/zenith-mods/volatile_reversed.png', import.meta.url)),
};
let tetrioHunFontDataUriPromise = null;
const localImageDataUriCache = new Map();

export async function createQuickPlayAltitudeCard(username, recordIndex = 1) {
  return createTetrioAltitudeCard(username, recordIndex, 'zenith');
}

export async function createExpertQuickPlayAltitudeCard(username, recordIndex = 1) {
  return createTetrioAltitudeCard(username, recordIndex, 'zenithex');
}

export async function createQuickPlayRecentAltitudeCard(username, recordIndex = 1) {
  return createTetrioAltitudeCard(username, recordIndex, 'zenith', 'recent');
}

export async function createExpertQuickPlayRecentAltitudeCard(username, recordIndex = 1) {
  return createTetrioAltitudeCard(username, recordIndex, 'zenithex', 'recent');
}

export async function createFortyLinesTimeCard(username, recordIndex = 1) {
  return createTetrioAltitudeCard(username, recordIndex, '40l');
}

export async function createFortyLinesRecentTimeCard(username, recordIndex = 1) {
  return createTetrioAltitudeCard(username, recordIndex, '40l', 'recent');
}

export async function createBlitzScoreCard(username, recordIndex = 1) {
  return createTetrioAltitudeCard(username, recordIndex, 'blitz');
}

export async function createBlitzRecentScoreCard(username, recordIndex = 1) {
  return createTetrioAltitudeCard(username, recordIndex, 'blitz', 'recent');
}

async function createTetrioAltitudeCard(username, recordIndex = 1, mode = 'zenith', leaderboard = 'top') {
  const normalizedUsername = normalizeTetrioUsername(username);
  const normalizedRecordIndex = normalizeRecordIndex(recordIndex);
  const modeInfo = tetrioQuickPlayModes[mode] ?? tetrioQuickPlayModes.zenith;
  const normalizedLeaderboard = normalizePersonalRecordLeaderboard(leaderboard);

  if (!normalizedUsername) {
    const error = new Error('TETR.IO username is required');
    error.status = 400;
    throw error;
  }

  const record = await fetchNthPersonalRecord(
    normalizedUsername,
    normalizedRecordIndex,
    modeInfo,
    normalizedLeaderboard
  );

  if (!record) {
    const error = new Error(modeInfo.notFoundMessage);
    error.code = 'NO_RECORD';
    error.status = 404;
    throw error;
  }

  const mainValue = modeInfo.getMainValue(record);
  if (!Number.isFinite(mainValue) || mainValue < 0) {
    const error = new Error(modeInfo.unavailableMessage);
    error.code = 'NO_RECORD';
    error.status = 404;
    throw error;
  }

  const mainText = modeInfo.formatMainValue(mainValue);
  const statsRows = modeInfo.buildStatsRows(record);
  const [modIcons, hunFont] = await Promise.all([
    fetchQuickPlayModIcons(record),
    fetchTetrioHunFontDataUri(),
  ]);
  const svg = renderQuickPlayAltitudeSvg(record, normalizedUsername, mainText, modIcons, hunFont, {
    mainValueFormat: modeInfo.mainValueFormat,
    statsRows,
    title: modeInfo.title,
    unit: modeInfo.unit,
  });
  const image = renderTetrioSvgToPng(svg);

  return {
    image,
    [modeInfo.valueKey]: mainValue,
    [modeInfo.textKey]: mainText,
    leaderboard: normalizedLeaderboard,
    mode: modeInfo.code,
    username: normalizedUsername,
  };
}

function normalizePersonalRecordLeaderboard(value) {
  return value === 'recent' ? 'recent' : 'top';
}

async function fetchNthPersonalRecord(username, recordIndex, modeInfo, leaderboard) {
  let remaining = recordIndex;
  let after = null;

  while (remaining > 0) {
    const limit = Math.min(tetrioRecordPageSize, remaining);
    const searchParams = new URLSearchParams({ limit: String(limit) });
    if (after) {
      searchParams.set('after', after);
    }

    const response = await fetchTetrioJson(
      `/users/${encodeURIComponent(username)}/records/${modeInfo.code}/${leaderboard}?${searchParams.toString()}`
    );
    const entries = Array.isArray(response.data?.entries)
      ? response.data.entries
      : [];

    if (entries.length === 0) {
      return null;
    }

    if (entries.length >= remaining) {
      return entries[remaining - 1];
    }

    remaining -= entries.length;
    if (entries.length < limit) {
      return null;
    }

    after = formatPrisecter(entries.at(-1)?.p);
    if (!after) {
      return null;
    }
  }

  return null;
}

function formatPrisecter(prisecter) {
  const pri = Number(prisecter?.pri);
  const sec = Number(prisecter?.sec);
  const ter = Number(prisecter?.ter);

  if (![pri, sec, ter].every(Number.isFinite)) {
    return null;
  }

  return `${pri}:${sec}:${ter}`;
}

function normalizeRecordIndex(value) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 1 ? index : 1;
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

async function fetchTetrioJson(path) {
  const response = await fetch(`${tetrioApiBaseUrl}${path}`, {
    headers: tetrioHeaders,
  });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    const error = new Error(body?.error?.msg ?? `TETR.IO API responded with ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return body;
}

function formatAltitudeText(value) {
  const whole = Math.floor(value);
  const decimal = Math.floor((value % 1) * 10);
  return `${whole.toLocaleString('en-US')}.${decimal}`;
}

function getQuickPlayAltitude(record) {
  return Number(record?.results?.stats?.zenith?.altitude);
}

function getFortyLinesFinalTime(record) {
  return Number(record?.results?.stats?.finaltime);
}

function getBlitzScore(record) {
  return Number(record?.results?.stats?.score);
}

function fetchTetrioHunFontDataUri() {
  tetrioHunFontDataUriPromise ??= getTetrioHunDinFontDataUri();
  return tetrioHunFontDataUriPromise;
}

async function fetchQuickPlayModIcons(record) {
  const mods = Array.isArray(record?.extras?.zenith?.mods)
    ? record.extras.zenith.mods
    : [];

  const entries = await Promise.all(mods.map(async (mod) => {
    const dataUri = await readLocalImageDataUri(localQuickPlayModIconPaths[mod]);
    return dataUri
      ? { mod, dataUri }
      : null;
  }));

  return entries.filter(Boolean);
}

function renderQuickPlayAltitudeSvg(record, username, mainText, modIcons = [], hunFontDataUri = null, options = {}) {
  const mainTitle = options.title ?? 'FINAL ALTITUDE';
  const mainUnit = options.unit === undefined ? 'M' : String(options.unit ?? '');
  const statsRows = options.statsRows ?? buildQuickPlayStatsRows(record);
  const mainValueFormat = options.mainValueFormat ?? 'plain';
  const valueFontSize = 109;
  const unitFontSize = mainUnit ? 68 : 0;
  const valueGroupCenterX = 700;
  const valueGap = mainUnit ? -46 : 0;
  const valueWidth = mainUnit ? estimateQuickPlayValueWidth(mainText, valueFontSize) : 0;
  const unitWidth = mainUnit ? estimateQuickPlayUnitWidth(mainUnit, unitFontSize) : 0;
  const valueGroupWidth = valueWidth + valueGap + unitWidth;
  const valueGroupLeftX = valueGroupCenterX - valueGroupWidth / 2;
  const valueX = valueGroupLeftX + valueWidth;
  const unitX = valueX + valueGap;
  const topPanelY = 8;
  const topPanelHeight = 303;
  const mainTitleShadowY = topPanelY + 61;
  const mainTitleY = topPanelY + 59;
  const mainInnerBoxY = topPanelY + 88;
  const mainTextY = topPanelY + 176;
  const mainValueTextY = mainTextY - 1;
  const modIconY = mainInnerBoxY + 139;
  const statsPanelY = 331;
  const statsInnerBoxX = 18;
  const statsInnerBoxY = statsPanelY + 84;
  const statsInnerBoxWidth = 1364;
  const statsRowHeight = 53;
  const statsInnerBoxHeight = statsRows.length * statsRowHeight;
  const statsRowsBottomY = statsInnerBoxY + statsInnerBoxHeight;
  const statsPanelBottomY = statsRowsBottomY + 16;
  const statsPanelHeight = statsPanelBottomY - statsPanelY;
  const playedAtPanelY = statsPanelBottomY + 8;
  const playedAtPanelHeight = 56;
  const playedAtText = `PLAYED BY ${String(username ?? '').toUpperCase()} \u00B7 ${formatPlayedAtKst(record?.ts)}`;
  const svgHeight = playedAtPanelY + playedAtPanelHeight + 12;
  const modIconMarkup = renderQuickPlayModIcons(modIcons, modIconY);
  const mainValueMarkup = renderQuickPlayMainValueMarkup({
    centerX: valueGroupCenterX,
    fontSize: valueFontSize,
    format: mainValueFormat,
    text: mainText,
    unit: mainUnit,
    unitX,
    unitY: mainTextY,
    valueX,
    valueY: mainValueTextY,
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="${svgHeight}" viewBox="0 0 1400 ${svgHeight}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#294d2a"/>
      <stop offset="1" stop-color="#1d3b1f"/>
    </linearGradient>
    <filter id="valueGlow" x="-20%" y="-40%" width="140%" height="180%">
      <feGaussianBlur stdDeviation="5.5" result="blur"/>
      <feColorMatrix
        in="blur"
        type="matrix"
        values="1 0 0 0 0.66
                0 1 0 0 0.92
                0 0 1 0 0.68
                0 0 0 1 0"
        result="glow"/>
      <feMerge>
        <feMergeNode in="glow"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <style>
      ${renderTetrioFontFace(hunFontDataUri)}
      text {
        font-family: ${quickPlayFontFamily};
        letter-spacing: 0;
        ${renderTetrioTextWeightCss()}
      }
      .title {
        fill: #b0e1af;
        font-size: 52px;
        font-weight: 650;
        letter-spacing: 2px;
        word-spacing: ${tetrioPhraseWordSpacing};
      }
      .value {
        fill: #c9ffc8;
        font-size: ${valueFontSize}px;
        font-weight: 950;
        stroke: rgba(205, 255, 205, 0.78);
        stroke-width: 1.45px;
        stroke-linejoin: round;
        paint-order: stroke fill;
      }
      .unit {
        fill: #9fc79b;
        font-size: ${unitFontSize}px;
        font-weight: 700;
      }
      .unitInline {
        fill: #9fc79b;
        font-size: ${unitFontSize}px;
        font-weight: 850;
        stroke: rgba(159, 199, 155, 0.45);
        stroke-width: 0.75px;
        stroke-linejoin: round;
        paint-order: stroke fill;
      }
      .statsTitle {
        fill: #b0e1af;
        font-size: 50px;
        font-weight: 650;
        letter-spacing: 2px;
        word-spacing: ${tetrioPhraseWordSpacing};
      }
      .statsLabel {
        fill: #95bc92;
        font-size: 30px;
        font-weight: 450;
        letter-spacing: 2px;
        word-spacing: ${tetrioPhraseWordSpacing};
      }
      .statsValue {
        fill: #d6f0d5;
        font-size: 30px;
        font-weight: 650;
        letter-spacing: 0.5px;
        word-spacing: ${tetrioPhraseWordSpacing};
      }
      .metaText {
        fill: #b0e1af;
        font-size: 34px;
        font-weight: 650;
        letter-spacing: 1px;
        word-spacing: ${tetrioPhraseWordSpacing};
      }
    </style>
  </defs>

  <rect width="1400" height="${svgHeight}" rx="3" fill="url(#bg)" stroke="#3d6640" stroke-width="4"/>
  <rect x="8" y="${topPanelY}" width="1384" height="${topPanelHeight}" rx="3" fill="#254726" stroke="#3d6640" stroke-width="4"/>
  <text x="34" y="${mainTitleShadowY}" class="title" fill="#000000" opacity="0.32">${escapeXml(mainTitle)}</text>
  <text x="32" y="${mainTitleY}" class="title">${escapeXml(mainTitle)}</text>
  <rect x="22" y="${mainInnerBoxY}" width="1356" height="180" rx="6" fill="#1b381b" opacity="0.98"/>
  ${mainValueMarkup}
  ${modIconMarkup}

  <rect x="8" y="${statsPanelY}" width="1384" height="${statsPanelHeight}" rx="3" fill="#254726" stroke="#3d6640" stroke-width="4"/>
  <text x="32" y="${statsPanelY + 62}" class="statsTitle">STATS</text>
  <rect x="${statsInnerBoxX}" y="${statsInnerBoxY}" width="${statsInnerBoxWidth}" height="${statsInnerBoxHeight}" rx="4" fill="#1b381b" opacity="0.98"/>
  ${statsRows.map((row, index) => {
    const rowY = statsInnerBoxY + index * statsRowHeight;
    const baselineY = rowY + statsRowHeight / 2;
    const statsValueX = statsInnerBoxX + statsInnerBoxWidth - 12 + getQuickPlayStatsRightCompensation(row.value);
    return `
  ${index < statsRows.length - 1 ? `<line x1="${statsInnerBoxX + 7}" y1="${rowY + statsRowHeight}" x2="${statsInnerBoxX + statsInnerBoxWidth - 7}" y2="${rowY + statsRowHeight}" stroke="#ffffff" stroke-opacity="0.18" stroke-width="2.5"/>` : ''}
  <text x="${statsInnerBoxX + 12}" y="${baselineY}" dominant-baseline="middle" class="statsLabel">${escapeXml(row.label)}</text>
  <text x="${roundSvgNumber(statsValueX)}" y="${baselineY}" text-anchor="end" dominant-baseline="middle" class="statsValue">${renderQuickPlayStatsNumberMarkup(row.value)}</text>`;
  }).join('')}
  <rect x="8" y="${playedAtPanelY}" width="1384" height="${playedAtPanelHeight}" rx="3" fill="#254726" stroke="#3d6640" stroke-width="4"/>
  ${renderQuickPlayMetaLine(playedAtText, 34, playedAtPanelY + playedAtPanelHeight / 2 + 2, {
  fill: '#000000',
  opacity: 0.32,
  })}
  ${renderQuickPlayMetaLine(playedAtText, 32, playedAtPanelY + playedAtPanelHeight / 2)}
</svg>`;
}

function renderQuickPlayMetaLine(value, x, y, options = {}) {
  const text = String(value ?? '');
  const displayText = text
  .replace(/_(?=\s*·)/g, '     ')
  .replaceAll('_', '  ');
  const fontSize = 34;
  const fillAttr = options.fill ? ` fill="${options.fill}"` : '';
  const opacityAttr = options.opacity !== undefined ? ` opacity="${options.opacity}"` : '';

  const baseText = `<text x="${x}" y="${y}" dominant-baseline="middle" class="metaText"${fillAttr}${opacityAttr} xml:space="preserve">${escapeXml(displayText)}</text>`;

  let cursorX = x;
  const underlines = [];

  for (let index = 0; index < text.length; index += 1) {
  const char = text[index];

  if (char === '_') {
    const rectWidth = roundSvgNumber(fontSize * 0.44);
    const rectHeight = roundSvgNumber(Math.max(3.2, fontSize * 0.095));
    const rectX = roundSvgNumber(cursorX + fontSize * 0.26);
    const rectY = roundSvgNumber(y + fontSize * 0.34);

    underlines.push(
      `<rect x="${rectX}" y="${rectY}" width="${rectWidth}" height="${rectHeight}"${fillAttr || ' fill="#b0e1af"'}${opacityAttr}/>`
    );

    const isBeforeSeparator = /^\s*·/.test(text.slice(index + 1));
    const spaceCount = isBeforeSeparator ? 3 : 2;
    cursorX += estimateQuickPlayMetaCharWidth(' ', fontSize) * spaceCount;
    continue;
  }

  cursorX += estimateQuickPlayMetaCharWidth(char, fontSize);
}

  return `<g>${baseText}${underlines.join('')}</g>`;
}

function estimateQuickPlayMetaCharWidth(char, fontSize = 34) {
  if (char === ' ') return fontSize * 0.34 + 10;
  if (char === '·') return fontSize * 0.34;
  if (char === 'I' || char === '1' || char === '.') return fontSize * 0.28;
  if (char === ',') return fontSize * 0.22;
  if (/\d/.test(char)) return fontSize * 0.52;
  return fontSize * 0.58 + 1.5;
}

function renderQuickPlayMainValueMarkup({
  centerX,
  fontSize,
  format,
  text,
  unit,
  unitX,
  unitY,
  valueX,
  valueY,
}) {
  const normalizedText = String(text ?? '');

  if (!unit) {
    if (format === 'timeSplitDecimal') {
      const splitIndex = normalizedText.lastIndexOf('.');
      if (splitIndex > 0 && splitIndex < normalizedText.length - 1) {
        const decimalDotDyEm = 0.10;
        const fractionBaselineDyEm = 0.12;
        const fractionDyEm = fractionBaselineDyEm - decimalDotDyEm;
        return `<g filter="url(#valueGlow)">
    <text x="${centerX}" y="${valueY}" text-anchor="middle" dominant-baseline="middle" class="value">
      <tspan>${renderQuickPlayMainNumberMarkup(normalizedText.slice(0, splitIndex))}</tspan><tspan dy="${decimalDotDyEm}em" font-family="Arial, sans-serif" font-size="0.82em" stroke="none">.</tspan><tspan font-size="${getQuickPlayTimedDecimalFontSize(fontSize)}" dy="${fractionDyEm}em">${renderQuickPlayMainNumberMarkup(normalizedText.slice(splitIndex + 1))}</tspan>
    </text>
  </g>`;
      }
    }

    const adjustedCenterX = centerX + getQuickPlayMainCenterCompensation(normalizedText, fontSize);
    return `<g filter="url(#valueGlow)">
    <text x="${roundSvgNumber(adjustedCenterX)}" y="${valueY}" text-anchor="middle" dominant-baseline="middle" class="value">${renderQuickPlayMainNumberMarkup(normalizedText)}</text>
  </g>`;
  }

  const unitDx = getQuickPlayInlineUnitDx(normalizedText);
  const unitDyEm = getQuickPlayInlineUnitDyEm(normalizedText);
  const unitDy = unitDyEm ? ` dy="${unitDyEm}em"` : '';
  return `<g filter="url(#valueGlow)">
    <text x="${centerX}" y="${valueY}" text-anchor="middle" dominant-baseline="middle" class="value">${renderQuickPlayMainNumberMarkup(normalizedText)}<tspan class="unitInline" dx="${unitDx}"${unitDy}>${escapeXml(unit)}</tspan></text>
  </g>`;
}

function renderQuickPlayMetaTextMarkup(value) {
  return String(value ?? '')
    .split('')
    .map((char) => {
      if (char === '_') {
        return '<tspan style="font-family: Arial, Helvetica, sans-serif !important;" font-size="1em" dy="-0.06em">_</tspan>';
      }

      return escapeXml(char);
    })
    .join('');
}

function renderQuickPlayMainNumberMarkup(value) {
  return renderQuickPlayNumberMarkup(value, {
    decimalDyEm: 0.04,
    decimalFollowingDyEm: 0.00,
    decimalFontSize: '0.92em',
    tightenComma: true,
  });
}

function renderQuickPlayStatsNumberMarkup(value) {
  return renderQuickPlayNumberMarkup(value, {
    decimalDyEm: 0.06,
    decimalFontSize: '1.12em',
    tightenComma: true,
  });
}

function getQuickPlayStatsRightCompensation(value) {
  const commaMatches = String(value ?? '').match(/,(?=\d)/g);
  const commaCount = commaMatches?.length ?? 0;
  return commaCount * 0.42 * 30;
}

function getQuickPlayMainCenterCompensation(value, fontSize) {
  const commaMatches = String(value ?? '').match(/,(?=\d)/g);
  const commaCount = commaMatches?.length ?? 0;
  return commaCount * fontSize * 0.14;
}

function renderQuickPlayNumberMarkup(value, options = {}) {
  const text = String(value ?? '');
  const decimalDyEm = Number(options.decimalDyEm) || 0;
  const decimalFollowingDyEm = Number(options.decimalFollowingDyEm) || 0;
  const decimalFontSize = options.decimalFontSize ?? '1em';
  const tightenComma = options.tightenComma === true;
  let markup = '';
  let resetDyEm = 0;
  let tightenNext = false;

  for (const char of text) {
    const escaped = escapeXml(char);
    if (char === '.') {
      const dy = decimalDyEm ? ` dy="${decimalDyEm}em"` : '';
      markup += `<tspan${dy} font-family="Arial, sans-serif" font-size="${decimalFontSize}" stroke="none">${escaped}</tspan>`;
      resetDyEm = decimalDyEm;
      tightenNext = false;
      continue;
    }

    const commaDx = char === '1' ? '-0.62em' : '-0.42em';
    const dx = tightenNext && /\d/.test(char) ? ` dx="${commaDx}"` : '';
    const dy = resetDyEm ? ` dy="${roundSvgNumber(decimalFollowingDyEm - resetDyEm)}em"` : '';
    markup += dx || dy ? `<tspan${dx}${dy}>${escaped}</tspan>` : escaped;
    resetDyEm = 0;
    tightenNext = tightenComma && char === ',';
  }

  return markup;
}

function getQuickPlayTimedDecimalFontSize(fontSize) {
  return Math.max(1, Math.round(fontSize * 0.7));
}

function getQuickPlayInlineUnitDyEm(value) {
  return /\.\d+$/.test(String(value ?? '')) ? 0.18 : 0.17;
}

function getQuickPlayInlineUnitDx(value) {
  const text = String(value ?? '');
  if (/1$/.test(text)) {
    return -12;
  }
  if (/[0]$/.test(text)) {
    return 4;
  }
  return -4;
}

function getQuickPlayUnitBottomAlignmentOffset(fontSize) {
  return Math.round(fontSize * 0.17);
}

function renderTetrioFontFace(fontDataUri) {
  if (!fontDataUri) {
    return '';
  }

  return renderTetrioHunDinFontFace(fontDataUri);
}

function buildQuickPlayStatsRows(record) {
  const stats = record?.results?.stats ?? {};
  const zenith = stats.zenith ?? {};
  const aggregate = record?.results?.aggregatestats ?? {};
  const extrasZenith = record?.extras?.zenith ?? {};
  const finalTimeSeconds = Number(stats.finaltime) / 1000;
  const averageClimbSpeed = finalTimeSeconds > 0
    ? zenith.avgrankpts / (finalTimeSeconds * 60)
    : null;
  const altitudePerSecond = finalTimeSeconds > 0
    ? zenith.altitude / finalTimeSeconds
    : null;
  const attackPerPiece = resolveQuickPlayAttackPerPiece(aggregate);
  const floorText = formatFloorText(zenith.floor);

  return [
    { label: 'TIME', value: formatQuickPlayTime(stats.finaltime) },
    { label: 'FLOOR', value: floorText },
    { label: "KO'S", value: formatInteger(stats.kills) },
    { label: 'PEAK POSITION', value: formatPositionSummary(extrasZenith.peakPos, extrasZenith.peakCount) },
    { label: 'FINAL POSITION', value: formatPositionSummary(extrasZenith.finalPos, extrasZenith.finalCount) },
    { label: 'AVERAGE CLIMB SPEED', value: formatDecimal(averageClimbSpeed, 2) },
    { label: 'PEAK CLIMB SPEED', value: formatInteger(Math.floor(Number(zenith.peakrank) || 0)) },
    { label: 'ALTITUDE PER SECOND', value: formatDecimal(altitudePerSecond, 2) },
    { label: 'ATTACK PER MINUTE', value: formatDecimal(aggregate.apm, 2) },
    { label: 'PIECES PER SECOND', value: formatDecimal(aggregate.pps, 2) },
    { label: 'VERSUS SCORE', value: formatDecimal(aggregate.vsscore, 2) },
    { label: 'ATTACK PER PIECE', value: formatDecimal(attackPerPiece, 2) },
    { label: 'MAXIMUM COMBO', value: formatInteger(stats.topcombo) },
    { label: 'MAXIMUM BACK-TO-BACK CHAIN', value: formatInteger(Math.max(0, Number(stats.topbtb ?? 0) - 1)) },
  ];
}

function buildFortyLinesStatsRows(record) {
  const stats = record?.results?.stats ?? {};
  const aggregate = record?.results?.aggregatestats ?? {};
  const finalTimeSeconds = Number(stats.finaltime) / 1000;
  const piecesPlaced = Number(stats.piecesplaced);
  const keysPressed = Number(stats.inputs);
  const lines = Number(stats.lines);
  const keysPerPiece = piecesPlaced > 0
    ? keysPressed / piecesPlaced
    : null;
  const keysPerSecond = finalTimeSeconds > 0
    ? keysPressed / finalTimeSeconds
    : null;
  const linesPerMinute = finalTimeSeconds > 0
    ? lines / finalTimeSeconds * 60
    : null;
  const finessePercent = piecesPlaced > 0
    ? Number(stats.finesse?.perfectpieces) / piecesPlaced
    : null;

  return [
    { label: 'PIECES PLACED', value: formatInteger(stats.piecesplaced) },
    { label: 'PIECES PER SECOND', value: formatDecimal(aggregate.pps, 2) },
    { label: 'KEYS PRESSED', value: formatInteger(stats.inputs) },
    { label: 'KEYS PER PIECE', value: formatDecimal(keysPerPiece, 3) },
    { label: 'KEYS PER SECOND', value: formatDecimal(keysPerSecond, 3) },
    { label: 'HOLDS', value: formatInteger(stats.holds) },
    { label: 'SCORE', value: formatInteger(stats.score) },
    { label: 'TIME', value: formatQuickPlayTime(stats.finaltime) },
    { label: 'LINES', value: formatInteger(stats.lines) },
    { label: 'LINES PER MINUTE', value: formatDecimal(linesPerMinute, 2) },
    { label: 'SPINS', value: formatInteger(stats.tspins) },
    { label: 'QUADS', value: formatInteger(stats.clears?.quads) },
    { label: 'MAXIMUM COMBO', value: formatInteger(Math.max(0, Number(stats.topcombo ?? 0) - 1)) },
    { label: 'MAXIMUM BACK-TO-BACK CHAIN', value: formatInteger(Math.max(0, Number(stats.topbtb ?? 0) - 1)) },
    { label: 'ALL CLEARS', value: formatInteger(stats.clears?.allclear) },
    { label: 'FINESSE %', value: formatPercent(finessePercent, 2) },
    { label: 'FINESSE FAULTS', value: formatInteger(stats.finesse?.faults) },
  ];
}

function buildBlitzStatsRows(record) {
  const stats = record?.results?.stats ?? {};
  const aggregate = record?.results?.aggregatestats ?? {};
  const finalTimeSeconds = Number(stats.finaltime) / 1000;
  const piecesPlaced = Number(stats.piecesplaced);
  const keysPressed = Number(stats.inputs);
  const lines = Number(stats.lines);
  const keysPerPiece = piecesPlaced > 0
    ? keysPressed / piecesPlaced
    : null;
  const keysPerSecond = finalTimeSeconds > 0
    ? keysPressed / finalTimeSeconds
    : null;
  const linesPerMinute = finalTimeSeconds > 0
    ? lines / finalTimeSeconds * 60
    : null;
  const finessePercent = piecesPlaced > 0
    ? Number(stats.finesse?.perfectpieces) / piecesPlaced
    : null;

  return [
    { label: 'LEVEL', value: formatInteger(stats.level) },
    { label: 'PIECES PLACED', value: formatInteger(stats.piecesplaced) },
    { label: 'PIECES PER SECOND', value: formatDecimal(aggregate.pps, 2) },
    { label: 'KEYS PRESSED', value: formatInteger(stats.inputs) },
    { label: 'KEYS PER PIECE', value: formatDecimal(keysPerPiece, 3) },
    { label: 'KEYS PER SECOND', value: formatDecimal(keysPerSecond, 3) },
    { label: 'HOLDS', value: formatInteger(stats.holds) },
    { label: 'SCORE', value: formatInteger(stats.score) },
    { label: 'TIME', value: formatQuickPlayTime(stats.finaltime) },
    { label: 'LINES', value: formatInteger(stats.lines) },
    { label: 'LINES PER MINUTE', value: formatDecimal(linesPerMinute, 2) },
    { label: 'T-SPINS', value: formatInteger(stats.tspins) },
    { label: 'MAXIMUM COMBO', value: formatInteger(Math.max(0, Number(stats.topcombo ?? 0) - 1)) },
    { label: 'MAXIMUM BACK-TO-BACK CHAIN', value: formatInteger(Math.max(0, Number(stats.topbtb ?? 0) - 1)) },
    { label: 'ALL CLEARS', value: formatInteger(stats.clears?.allclear) },
    { label: 'FINESSE %', value: formatPercent(finessePercent, 2) },
    { label: 'FINESSE FAULTS', value: formatInteger(stats.finesse?.faults) },
  ];
}

function resolveQuickPlayAttackPerPiece(aggregate) {
  const app = Number(aggregate?.app);
  if (Number.isFinite(app)) {
    return app;
  }

  const attackPerMinute = Number(aggregate?.apm);
  const piecesPerSecond = Number(aggregate?.pps);
  if (!Number.isFinite(attackPerMinute) || !Number.isFinite(piecesPerSecond) || piecesPerSecond <= 0) {
    return null;
  }

  return attackPerMinute / 60 / piecesPerSecond;
}

function formatQuickPlayTime(milliseconds) {
  const totalMilliseconds = Number(milliseconds);
  if (!Number.isFinite(totalMilliseconds) || totalMilliseconds <= 0) {
    return '-';
  }

  const flooredMilliseconds = Math.floor(totalMilliseconds);
  const minutes = Math.floor(flooredMilliseconds / 60_000);
  const seconds = Math.floor((flooredMilliseconds % 60_000) / 1_000);
  const millis = flooredMilliseconds % 1_000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function formatFloorText(value) {
  const floor = Number(value);
  if (!Number.isFinite(floor) || floor <= 0) {
    return '-';
  }

  const floorNumber = Math.floor(floor);
  const floorName = quickPlayFloorNames[floorNumber - 1];
  return floorName
    ? `${floorNumber} : ${floorName}`
    : String(floorNumber);
}

function formatPositionSummary(position, count) {
  const normalizedPosition = Number(position);
  const normalizedCount = Number(count);

  if (!Number.isFinite(normalizedPosition) || !Number.isFinite(normalizedCount) || normalizedPosition <= 0 || normalizedCount <= 0) {
    return '-';
  }

  return `${Math.floor(normalizedPosition)} / ${Math.floor(normalizedCount).toLocaleString('en-US')}`;
}

function formatDecimal(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
    : '-';
}

function formatInteger(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.floor(number).toLocaleString('en-US')
    : '-';
}

function formatPercent(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number)
    ? `${(number * 100).toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })}%`
    : '-';
}

function formatPlayedAtKst(value) {
  const timestamp = value ? new Date(value) : null;
  if (!timestamp || Number.isNaN(timestamp.getTime())) {
    return '-';
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  const parts = formatter.formatToParts(timestamp);
  const getPart = (type) => parts.find((part) => part.type === type)?.value ?? '';
  const year = getPart('year');
  const month = getPart('month');
  const day = getPart('day');
  const dayPeriod = getPart('dayPeriod');
  const hour = getPart('hour');
  const minute = getPart('minute');
  const second = getPart('second');
  const normalizedMonth = String(Number(month));
  const normalizedDay = String(Number(day));

  return `${year}. ${normalizedMonth}. ${normalizedDay}. ${hour}:${minute}:${second} ${String(dayPeriod).toUpperCase()}`;
}

function renderQuickPlayModIcons(modIcons, y = 232) {
  if (!modIcons.length) {
    return '';
  }

  const iconSize = 56;
  const gap = 18;
  const totalWidth = modIcons.length * iconSize + Math.max(0, modIcons.length - 1) * gap;
  const startX = 700 - totalWidth / 2;

  return modIcons.map((icon, index) => {
    const x = startX + index * (iconSize + gap);
    return `<image href="${icon.dataUri}" x="${roundSvgNumber(x)}" y="${y}" width="${iconSize}" height="${iconSize}" preserveAspectRatio="xMidYMid meet"/>`;
  }).join('');
}

async function readLocalImageDataUri(path) {
  if (!path) {
    return null;
  }

  if (localImageDataUriCache.has(path)) {
    return localImageDataUriCache.get(path);
  }

  try {
    const buffer = await readFile(path);
    const dataUri = `data:image/png;base64,${buffer.toString('base64')}`;
    localImageDataUriCache.set(path, dataUri);
    return dataUri;
  } catch {
    return null;
  }
}

function roundSvgNumber(value) {
  return Number(value.toFixed(2));
}

function estimateQuickPlayValueWidth(value, fontSize) {
  const text = String(value ?? '');
  let units = 0;

  for (const char of text) {
    if (/\d/.test(char)) {
      units += 0.6;
    } else if (char === ',') {
      units += 0.2;
    } else if (char === '.') {
      units += 0.24;
    } else if (char === ' ') {
      units += 0.25;
    } else {
      units += 0.52;
    }
  }

  return Math.ceil(units * fontSize);
}

function estimateQuickPlayUnitWidth(value, fontSize) {
  const text = String(value ?? '');
  let units = 0;

  for (const char of text) {
    if (char === 'M') {
      units += 0.78;
    } else if (char === ' ') {
      units += 0.25;
    } else {
      units += 0.62;
    }
  }

  return Math.ceil(units * fontSize);
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
