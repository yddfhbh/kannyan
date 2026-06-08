import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  getTetrioHunDinFontDataUri,
  renderTetrioHunDinFontFace,
  renderTetrioNumericTextMarkup,
  renderTetrioTextWeightCss,
  renderTetrioSvgToPng,
  tetrioFontFamily,
  tetrioHunDinFontUrl,
} from './tetrio-font.js';

const tetrioApiBaseUrl = 'https://ch.tetr.io/api';
const tetrioGameBaseUrl = 'https://tetr.io';
const tetrioRegularFontUrl = `${tetrioGameBaseUrl}/res/font/cr.ttf`;
const tetrioBoldFontUrl = `${tetrioGameBaseUrl}/res/font/cb.ttf`;
const localRegularFontPath = fileURLToPath(new URL('../assets/fonts/cr.ttf', import.meta.url));
const localBoldFontPath = fileURLToPath(new URL('../assets/fonts/cb.ttf', import.meta.url));
const localRegularFontUrl = pathToFileURL(localRegularFontPath).href;
const localBoldFontUrl = pathToFileURL(localBoldFontPath).href;
const localHunFontUrl = tetrioHunDinFontUrl;
const tetrioHeaders = {
  'User-Agent': 'discord-bot/1.0 TETR.IO league match card',
  'X-Session-ID': 'discord-bot-tetrio-league-match',
};
const tetrioRecordPageSize = 100;
const leagueFontFamily = `${tetrioFontFamily}, "C"`;
const sideThemes = [
  {
    name: 'blue',
    topGradient: 'blueTop',
    rowGradient: 'blueRow',
    rowWinGradient: 'blueRowWin',
    border: '#1684f7',
    mutedBorder: '#124276',
    label: '#4a8be4',
    score: '#ffffff',
  },
  {
    name: 'red',
    topGradient: 'redTop',
    rowGradient: 'redRow',
    rowWinGradient: 'redRowWin',
    border: '#f5232a',
    mutedBorder: '#6e1216',
    label: '#d83a3f',
    score: '#ffffff',
  },
];

let tetrioFontDataUrisPromise = null;

export async function createTetrioLeagueMatchCard(username, matchIndex = 1) {
  const card = await createTetrioLeagueMatchCardSvg(username, matchIndex);
  const image = renderTetrioSvgToPng(card.svg);

  return {
    image,
    matchIndex: card.matchIndex,
    opponent: card.opponent,
    replayId: card.replayId,
    ts: card.ts,
    username: card.username,
  };
}

export async function createTetrioLeagueMatchCardSvg(username, matchIndex = 1) {
  const normalizedUsername = normalizeTetrioUsername(username);
  const normalizedMatchIndex = normalizeRecordIndex(matchIndex);

  if (!normalizedUsername) {
    const error = new Error('TETR.IO username is required');
    error.status = 400;
    throw error;
  }

  const record = await fetchNthLeagueRecord(normalizedUsername, normalizedMatchIndex);
  if (!record) {
    const error = new Error('No TETRA LEAGUE match found for the requested position');
    error.code = 'NO_RECORD';
    error.status = 404;
    throw error;
  }

  const match = buildLeagueMatchView(record, normalizedUsername, normalizedMatchIndex);
  const fontDataUris = await fetchTetrioFontDataUris();
  const svg = renderLeagueMatchSvg(match, fontDataUris);

  return {
    svg,
    matchIndex: normalizedMatchIndex,
    opponent: match.opponent?.username ?? null,
    replayId: record.replayid ?? null,
    ts: record.ts ?? null,
    username: match.target?.username ?? normalizedUsername,
  };
}

async function fetchNthLeagueRecord(username, recordIndex) {
  let remaining = recordIndex;
  let after = null;

  while (remaining > 0) {
    const limit = Math.min(tetrioRecordPageSize, remaining);
    const searchParams = new URLSearchParams({ limit: String(limit) });
    if (after) {
      searchParams.set('after', after);
    }

    const response = await fetchTetrioJson(
      `/users/${encodeURIComponent(username)}/records/league/recent?${searchParams.toString()}`
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

function buildLeagueMatchView(record, requestedUsername, matchIndex) {
  const leaderboard = Array.isArray(record?.results?.leaderboard)
    ? record.results.leaderboard
    : [];

  if (leaderboard.length < 2) {
    const error = new Error('TETRA LEAGUE match data is incomplete');
    error.code = 'NO_RECORD';
    error.status = 404;
    throw error;
  }

  const requestedUsernameLower = String(requestedUsername ?? '').toLowerCase();
  const otherUserIds = new Set(
    (Array.isArray(record?.otherusers) ? record.otherusers : [])
      .map((user) => user?.id)
      .filter(Boolean)
  );
  const target = leaderboard.find((player) => String(player?.username ?? '').toLowerCase() === requestedUsernameLower)
    ?? leaderboard.find((player) => player?.id && !otherUserIds.has(player.id))
    ?? leaderboard[0];
  const sortedPlayers = leaderboard
    .slice()
    .sort((first, second) => normalizeNaturalOrder(first) - normalizeNaturalOrder(second))
    .slice(0, 2)
    .map((player, sideIndex) => normalizeMatchPlayer(player, sideIndex));
  const targetSide = sortedPlayers.find((player) => player.id === target?.id)
    ?? sortedPlayers.find((player) => player.username.toLowerCase() === requestedUsernameLower)
    ?? sortedPlayers[0];
  const opponent = sortedPlayers.find((player) => player.id !== targetSide.id) ?? null;
  const rounds = (Array.isArray(record?.results?.rounds) ? record.results.rounds : [])
    .map((round, index) => normalizeRound(round, sortedPlayers, index + 1));

  return {
    footerText: `${sortedPlayers.map((player) => player.username.toUpperCase()).join(' VERSUS ')} PLAYED ON ${formatPlayedAtUtc(record?.ts)}`,
    matchIndex,
    opponent,
    players: sortedPlayers,
    replayId: record?.replayid ?? null,
    rounds,
    target: targetSide,
  };
}

function normalizeMatchPlayer(player, sideIndex) {
  return {
    id: player?.id ?? `side-${sideIndex}`,
    naturalOrder: normalizeNaturalOrder(player),
    sideIndex,
    stats: player?.stats ?? {},
    username: String(player?.username ?? `player${sideIndex + 1}`),
    wins: Number(player?.wins),
  };
}

function normalizeRound(round, players, roundNumber) {
  const entries = Array.isArray(round) ? round : [];
  const maxLifetime = entries.reduce((max, entry) => {
    const lifetime = Number(entry?.lifetime);
    return Number.isFinite(lifetime) ? Math.max(max, lifetime) : max;
  }, 0);

  return {
    roundNumber,
    sides: players.map((player) => {
      const entry = entries.find((candidate) => candidate?.id === player.id)
        ?? entries.find((candidate) => normalizeNaturalOrder(candidate) === player.naturalOrder)
        ?? null;

      return {
        alive: Boolean(entry?.alive),
        lifetime: Number(entry?.lifetime),
        stats: entry?.stats ?? {},
        username: player.username,
      };
    }),
    timeText: formatRoundTime(maxLifetime),
  };
}

function normalizeNaturalOrder(player) {
  const naturalOrder = Number(player?.naturalorder);
  return Number.isFinite(naturalOrder) ? naturalOrder : 0;
}

function renderLeagueMatchSvg(match, fontDataUris = {}) {
  const width = 790;
  const centerX = width / 2;
  const topY = 4;
  const topHeight = 112;
  const rowStartY = 147;
  const rowHeight = 32;
  const rowGap = 10;
  const footerHeight = 36;
  const footerY = rowStartY
    + Math.max(0, match.rounds.length) * rowHeight
    + Math.max(0, match.rounds.length - 1) * rowGap
    + 28;
  const height = footerY + footerHeight + 8;
  const topPanels = match.players.map((player, index) => renderTopPanel(player, index, topY, topHeight, centerX)).join('');
  const rows = match.rounds
    .map((round, index) => renderRoundRow(round, rowStartY + index * (rowHeight + rowGap), rowHeight, centerX))
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="blueTop" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#02070d"/>
      <stop offset="1" stop-color="#122d55"/>
    </linearGradient>
    <linearGradient id="redTop" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#5b1015"/>
      <stop offset="1" stop-color="#090103"/>
    </linearGradient>
    <linearGradient id="blueRow" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="0.35" stop-color="#031224" stop-opacity="0.72"/>
      <stop offset="1" stop-color="#0b2f61" stop-opacity="1"/>
    </linearGradient>
    <linearGradient id="blueRowWin" x1="0" x2="1" y1="0" y2="0">
  <stop offset="0" stop-color="#07101b" stop-opacity="0.92"/>
  <stop offset="0.58" stop-color="#0d376f" stop-opacity="1"/>
  <stop offset="1" stop-color="#3a82ec" stop-opacity="1"/>
</linearGradient>

    <linearGradient id="redRow" x1="0" x2="1" y1="0" y2="0">
  <stop offset="0" stop-color="#641419" stop-opacity="1"/>
  <stop offset="0.65" stop-color="#230507" stop-opacity="0.72"/>
  <stop offset="1" stop-color="#090103" stop-opacity="1"/>
</linearGradient>

<linearGradient id="redRowWin" x1="0" x2="1" y1="0" y2="0">
  <stop offset="0" stop-color="#e22a32" stop-opacity="1"/>
  <stop offset="0.42" stop-color="#7a161b" stop-opacity="1"/>
  <stop offset="1" stop-color="#180305" stop-opacity="0.92"/>
</linearGradient>

    <filter id="textGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="1.8" result="blur"/>
      <feColorMatrix
        in="blur"
        type="matrix"
        values="1 0 0 0 0.85
                0 1 0 0 0.88
                0 0 1 0 1
                0 0 0 0.65 0"
        result="glow"/>
      <feMerge>
        <feMergeNode in="glow"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <filter id="bluePanelGlow" x="-8%" y="-18%" width="116%" height="150%" color-interpolation-filters="sRGB">
  <feDropShadow dx="0" dy="0" stdDeviation="3.2" flood-color="#1684f7" flood-opacity="0.62"/>
</filter>

<filter id="redPanelGlow" x="-8%" y="-18%" width="116%" height="150%" color-interpolation-filters="sRGB">
  <feDropShadow dx="0" dy="0" stdDeviation="3.2" flood-color="#f5232a" flood-opacity="0.62"/>
</filter>
    <style>
      ${renderTetrioFontFace(fontDataUris)}
     text {
      font-family: ${leagueFontFamily};
     letter-spacing: 0;
      ${renderTetrioTextWeightCss()}
      }
      .username {
  fill: #f6f2ef;
  font-size: 18px;
  font-weight: 950;
  stroke: rgba(246,242,239,0.68);
  stroke-width: 0.62px;
  paint-order: stroke fill;
}
  .usernameUnderscore {
  fill: #f6f2ef;
  stroke: rgba(255,255,255,0.55);
  stroke-width: 0.35px;
  opacity: 1;
}

.versus {
  fill: #ffd620;
  font-size: 39px;
  font-weight: 950;
  stroke: rgba(255,214,32,0.72);
  stroke-width: 0.65px;
  paint-order: stroke fill;
}

.score {
  fill: #ffffff;
  font-size: 60px;
  font-weight: 720;
  stroke: rgba(255,255,255,0.72);
  stroke-width: 1.15px;
  paint-order: stroke fill;
}

.summaryValue {
  fill: #f0f3fa;
  font-size: 10px;
  font-weight: 950;
  stroke: rgba(255,255,255,0.55);
  stroke-width: 0.5px;
  paint-order: stroke fill;
}

.roundValue {
  fill: #f0f3fa;
  font-size: 12.2px;
  font-weight: 950;
  stroke: rgba(255,255,255,0.72);
  stroke-width: 0.72px;
  paint-order: stroke fill;
}

.blueLabel {
  fill: ${sideThemes[0].label};
  stroke: rgba(74,139,228,0.86);
  stroke-width: 0.48px;
  font-size: 11.8px;
  font-weight: 950;
  paint-order: stroke fill;
}

.redLabel {
  fill: ${sideThemes[1].label};
  stroke: rgba(216,58,63,0.86);
  stroke-width: 0.48px;
  font-size: 11.8px;
  font-weight: 950;
  paint-order: stroke fill;
}

.summaryBlueLabel {
  fill: ${sideThemes[0].label};
  stroke: rgba(74,139,228,0.86);
  stroke-width: 0.36px;
  font-size: 8.8px;
  font-weight: 950;
  paint-order: stroke fill;
}

.summaryRedLabel {
  fill: ${sideThemes[1].label};
  stroke: rgba(216,58,63,0.86);
  stroke-width: 0.36px;
  font-size: 8.8px;
  font-weight: 950;
  paint-order: stroke fill;
}

.time {
  fill: #ffffff;
  font-size: 12px;
  font-weight: 950;
  stroke: rgba(255,255,255,0.62);
  stroke-width: 0.48px;
  paint-order: stroke fill;
}

.footer {
  font-size: 14px;
  font-weight: 950;
}

.footerName {
  fill: #f1fff0;
  stroke: rgba(241,255,240,0.86);
  stroke-width: 0.58px;
  paint-order: stroke fill;
}

.footerKeyword {
  fill: #82bd86;
  stroke: rgba(130,189,134,0.86);
  stroke-width: 0.52px;
  paint-order: stroke fill;
}

.footerDate {
  fill: #a8d9aa;
  stroke: rgba(168,217,170,0.82);
  stroke-width: 0.5px;
  paint-order: stroke fill;
}
    </style>
  </defs>
  <rect width="${width}" height="${height}" fill="#000000"/>
  ${topPanels}
  <text x="${centerX}" y="73" text-anchor="middle" dominant-baseline="middle" class="versus" filter="url(#textGlow)">VS</text>
  ${rows}
  <rect x="12" y="${footerY}" width="${width - 24}" height="${footerHeight}" fill="#203c27" stroke="#48704d" stroke-width="0.8"/>
  <text x="24" y="${footerY + footerHeight / 2 + 1}" dominant-baseline="middle" class="footer" xml:space="preserve">${renderFooterTextMarkup(match.footerText)}</text>
</svg>`;
}

function renderTopPanel(player, sideIndex, y, height, centerX) {
  const theme = sideThemes[sideIndex] ?? sideThemes[0];
  const isLeft = sideIndex === 0;
  const panelWidth = 350;
  const svgWidth = centerX * 2;
  const sideMargin = 2;
  const x = isLeft ? sideMargin : svgWidth - panelWidth - sideMargin; 
 const namePadding = 4;
const scorePadding = 8;

const textX = isLeft ? x + panelWidth - namePadding : x + namePadding;
const textAnchor = isLeft ? 'end' : 'start';
const scoreX = isLeft ? x + panelWidth - scorePadding : x + scorePadding;
  const statsClass = isLeft ? 'summaryBlueLabel' : 'summaryRedLabel';
  const glowFilter = isLeft ? 'bluePanelGlow' : 'redPanelGlow';

  return `
  <g filter="url(#${glowFilter})">
  <rect x="${x}" y="${y}" width="${panelWidth}" height="${height}" fill="url(#${theme.topGradient})"/>

  <line x1="${x}" y1="${y}" x2="${x + panelWidth}" y2="${y}" stroke="${theme.border}" stroke-width="1.05" opacity="0.9"/>
  <line x1="${x}" y1="${y + height - 1}" x2="${x + panelWidth}" y2="${y + height - 1}" stroke="${theme.border}" stroke-width="1.5" opacity="0.85"/>

  ${isLeft
    ? `<line x1="${x + panelWidth}" y1="${y}" x2="${x + panelWidth}" y2="${y + height}" stroke="${theme.border}" stroke-width="1.05" opacity="0.9"/>`
    : `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + height}" stroke="${theme.border}" stroke-width="1.05" opacity="0.9"/>`
  }
</g>
 ${renderLeagueUsernameLabel(player.username, textX, y + 20, textAnchor)}
  <text x="${scoreX}" y="${y + 53}" text-anchor="${textAnchor}" dominant-baseline="middle" class="score" filter="url(#textGlow)">${renderTetrioNumericTextMarkup(formatInteger(player.wins))}</text>
  ${renderSummaryStatsMarkup(player.stats, x, panelWidth, y + height - 14, sideIndex, 'summaryValue', statsClass)}`;
}

function renderRoundRow(round, y, height, centerX) {
  const left = round.sides[0] ?? {};
  const right = round.sides[1] ?? {};

  // 라운드 전체 가로 위치 보정
  const roundCenterX = centerX + 5;

  return `
  ${renderRoundSide(left, 0, y, height, roundCenterX)}
  <text x="${roundCenterX}" y="${y + height / 2 + 1}" text-anchor="middle" dominant-baseline="middle" class="time">${escapeXml(round.timeText)}</text>
  ${renderRoundSide(right, 1, y, height, roundCenterX)}`;
}

function renderRoundSide(side, sideIndex, y, height, centerX) {
  const theme = sideThemes[sideIndex] ?? sideThemes[0];
  const isLeft = sideIndex === 0;

  // 원래 구조에 가까운 안정값
  const width = 276;
  const gapFromCenter = 19;
  const x = isLeft ? centerX - gapFromCenter - width : centerX + gapFromCenter;

  const fill = side.alive ? theme.rowWinGradient : theme.rowGradient;
  const labelClass = sideIndex === 0 ? 'blueLabel' : 'redLabel';

  const stripeX = isLeft ? x + width - 3 : x;
  const stripeColor = side.alive ? '#ffffff' : theme.border;
  const stripeOpacity = side.alive ? 0.9 : 0.32;

  return `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="url(#${fill})" opacity="${side.alive ? 1 : 0.9}"/>
  <rect x="${roundSvgNumber(stripeX)}" y="${y}" width="3" height="${height}" fill="${stripeColor}" opacity="${stripeOpacity}"/>
  ${renderRoundStatsMarkup(side.stats, x, width, y + height / 2 + 1, sideIndex, 'roundValue', labelClass)}`;
}

function renderSummaryStatsMarkup(stats, x, width, baselineY, sideIndex, valueClass, labelClass) {
  const blockWidth = 166;
  const blockX = sideIndex === 0 ? x + width - blockWidth - 20 : x - 12 ;

  const columns = [
    { valueX: 42, labelX: 49, label: 'APM', value: formatDecimal(stats?.apm, 2) },
    { separatorX: 73, separator: '&#9635;', separatorClass: labelClass, fontSize: 6.5, yOffset: -1.2 },

    { valueX: 96, labelX: 103, label: 'PPS', value: formatDecimal(stats?.pps, 2) },
    { separatorX: 125, separator: '&#9635;', separatorClass: labelClass, fontSize: 6.5, yOffset: -1.2 },

    { valueX: 160, labelX: 167, label: 'VS', value: formatDecimal(stats?.vsscore, 2) },
  ];

  return renderStatsColumns(columns, blockX, baselineY, valueClass, labelClass);
}

function renderRoundStatsMarkup(stats, x, width, baselineY, sideIndex, valueClass, labelClass) {
  const isLeft = sideIndex === 0;

  const apmText = formatDecimal(stats?.apm, 2);
  const ppsText = formatDecimal(stats?.pps, 2);
  const vsText = formatDecimal(stats?.vsscore, 2);

  const renderItem = (item) => {
    const className = item.className ?? valueClass;
    const anchor = item.anchor ?? 'start';
    const content = item.numeric
    ? renderLeagueNumberMarkup(item.text)
    : escapeXml(item.text);

    return `<text x="${roundSvgNumber(item.x)}" y="${baselineY}" text-anchor="${anchor}" dominant-baseline="middle" class="${className}">${content}</text>`;
  };

  if (isLeft) {
    // 파란쪽: 마지막 "VS"의 S 끝을 기준으로 정렬
    const vsEndX = x + width - 12;

    const items = [
  { x: vsEndX - 178, anchor: 'end', className: valueClass, text: apmText, numeric: true },
  { x: vsEndX - 169, anchor: 'start', className: labelClass, text: 'APM' },
  { x: vsEndX - 133, anchor: 'middle', className: valueClass, text: '-' },

  { x: vsEndX - 106, anchor: 'end', className: valueClass, text: ppsText, numeric: true },
  { x: vsEndX - 97, anchor: 'start', className: labelClass, text: 'PPS' },
  { x: vsEndX - 68, anchor: 'middle', className: valueClass, text: '-' },

  { x: vsEndX - 25, anchor: 'end', className: valueClass, text: vsText, numeric: true },
  { x: vsEndX, anchor: 'end', className: labelClass, text: 'VS' },
];

    return items.map(renderItem).join('\n  ');
  }

  // 빨간쪽: "APM" 글자 시작 위치를 기준으로 정렬
    // 빨간쪽: APM 숫자 시작 위치를 기준으로 정렬

  const redRoundNudge = -8;
const redApmValueX = x + 18 + redRoundNudge;

const items = [
  { x: redApmValueX, anchor: 'start', className: valueClass, text: apmText, numeric: true },
  { x: x + 60 + redRoundNudge, anchor: 'start', className: labelClass, text: 'APM' },
  { x: x + 96 + redRoundNudge, anchor: 'middle', className: valueClass, text: '-' },

  { x: x + 107 + redRoundNudge, anchor: 'start', className: valueClass, text: ppsText, numeric: true },
  { x: x + 141 + redRoundNudge, anchor: 'start', className: labelClass, text: 'PPS' },
  { x: x + 176 + redRoundNudge, anchor: 'middle', className: valueClass, text: '-' },

  { x: x + 188 + redRoundNudge, anchor: 'start', className: valueClass, text: vsText, numeric: true },
  { x: x + 238 + redRoundNudge, anchor: 'start', className: labelClass, text: 'VS' },
];

  return items.map(renderItem).join('\n  ');

}

function renderStatsColumns(columns, blockX, baselineY, valueClass, labelClass) {
  return columns.map((column) => {
    if (Number.isFinite(column.separatorX)) {
      const fontSize = Number.isFinite(column.fontSize) ? ` font-size="${column.fontSize}"` : '';
      const separatorY = baselineY + (Number(column.yOffset) || 0);

return `<text x="${blockX + column.separatorX}" y="${separatorY}" text-anchor="middle" dominant-baseline="middle" class="${column.separatorClass ?? valueClass}"${fontSize}>${column.separator ?? '-'}</text>`;
    }

    return `<text x="${blockX + column.valueX}" y="${baselineY}" text-anchor="end" dominant-baseline="middle" class="${valueClass}">${renderLeagueNumberMarkup(column.value)}</text>
  <text x="${blockX + column.labelX}" y="${baselineY}" text-anchor="start" dominant-baseline="middle" class="${labelClass}">${column.label}</text>`;
  }).join('\n  ');
}

function renderFooterTextMarkup(text) {
  const match = String(text ?? '').match(/^(.+?) VERSUS (.+?) PLAYED ON (.+)$/);
  if (!match) {
    return `<tspan class="footerName">${renderLeagueUsernameMarkup(text)}</tspan>`;
  }

  const dateMatch = match[3].match(/^(.+?),\s+(.+?)\s+(AM|PM)$/i);
  const dateMarkup = dateMatch
    ? `<tspan dx="7" class="footerDate">${escapeXml(dateMatch[1])},</tspan><tspan dx="7" class="footerDate">${escapeXml(dateMatch[2])}</tspan><tspan dx="5" class="footerDate">${escapeXml(dateMatch[3].toUpperCase())}</tspan>`
    : `<tspan dx="7" class="footerDate">${escapeXml(match[3])}</tspan>`;

  return `<tspan class="footerName">${renderLeagueUsernameMarkup(match[1])}</tspan><tspan dx="8" class="footerKeyword">VERSUS</tspan><tspan dx="8" class="footerName">${renderLeagueUsernameMarkup(match[2])}</tspan><tspan dx="8" class="footerKeyword">PLAYED</tspan><tspan dx="5" class="footerKeyword">ON</tspan>${dateMarkup}`;}


function estimateLeagueUsernameCharWidth(char, fontSize = 17) {
  if (char === ' ') return fontSize * 0.33;
  if (char === 'I' || char === '1' || char === 'L') return fontSize * 0.34;
  if (char === 'M' || char === 'W') return fontSize * 0.9;
  return fontSize * 0.64;
}

function measureLeagueUsernameWidth(text, fontSize = 17) {
  return [...String(text ?? '')].reduce((sum, char) => {
    if (char === '_') return sum;
    return sum + estimateLeagueUsernameCharWidth(char, fontSize);
  }, 0);
}

function renderLeagueUsernameLabel(text, x, y, anchor = 'start') {
  const raw = String(text ?? '').toUpperCase();
  const displayText = raw.replaceAll('_', '');
  const fontSize = 17;
  const totalWidth = measureLeagueUsernameWidth(displayText, fontSize);

  const textMarkup = `<text x="${x}" y="${y}" text-anchor="${anchor}" class="username">${escapeXml(displayText)}</text>`;

  const rects = [];

  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] !== '_') continue;

    const prefixText = raw.slice(0, i).replaceAll('_', '');
    const prefixWidth = measureLeagueUsernameWidth(prefixText, fontSize);

    const rectWidth = 10.5;
    const rectHeight = 2.2;
    const rectY = y + 2.2;

    const rectX = anchor === 'end'
      ? x - totalWidth + prefixWidth + 1.2
      : x + prefixWidth + 1.2;

    rects.push(
      `<rect x="${roundSvgNumber(rectX)}" y="${roundSvgNumber(rectY)}" width="${rectWidth}" height="${rectHeight}" class="usernameUnderscore"/>`
    );
  }

  return `<g>${textMarkup}${rects.join('')}</g>`;
}

function renderLeagueUsernameMarkup(value) {
  const text = String(value ?? '');
  let markup = '';
  let currentOffsetEm = 0;

  for (const char of text) {
    const targetOffsetEm = char === '_' ? -0.08 : 0;
    const deltaEm = targetOffsetEm - currentOffsetEm;
    const dy = Math.abs(deltaEm) > 0.0001
      ? ` dy="${roundSvgNumber(deltaEm)}em"`
      : '';

    if (char === '_') {
      markup += `<tspan${dy} font-family="Arial, Helvetica, sans-serif" font-size="1.05em" font-weight="900" stroke="none">_</tspan>`;
    } else {
      markup += dy
        ? `<tspan${dy}>${escapeXml(char)}</tspan>`
        : escapeXml(char);
    }

    currentOffsetEm = targetOffsetEm;
  }

  return markup;
}

function renderLeagueNumberMarkup(value) {
  const text = String(value ?? '-');
  let markup = '';
  let resetDyEm = 0;

  for (const char of text) {
    if (char === '.') {
      const dy = resetDyEm ? ` dy="${roundSvgNumber(-resetDyEm)}em"` : '';
      markup += `<tspan${dy} font-family="Arial, Helvetica, sans-serif" font-size="1.18em" stroke="none">.</tspan>`;
      resetDyEm = 0.03;
      continue;
    }

    const dy = resetDyEm ? ` dy="${roundSvgNumber(-resetDyEm)}em"` : '';
    markup += dy
      ? `<tspan${dy}>${escapeXml(char)}</tspan>`
      : escapeXml(char);

    resetDyEm = 0;
  }

  return markup;
}

function renderInlineStats(stats, valueClass, labelClass, options = {}) {
  const labelGap = options.compact ? 2.5 : 5;
  const separatorGap = options.compact ? 4.5 : 7;
  const valueGap = options.compact ? 4.5 : 7;
  const separator = options.compact
    ? `<tspan class="${labelClass}" dx="${separatorGap}" font-size="7" font-weight="900">&#9635;</tspan>`
    : `<tspan class="${valueClass}" dx="${separatorGap}">-</tspan>`;
  return `<tspan class="${valueClass}">${renderTetrioNumericTextMarkup(formatDecimal(stats?.apm, 2))}</tspan><tspan class="${labelClass}" dx="${labelGap}">APM</tspan>${separator}<tspan class="${valueClass}" dx="${valueGap}">${renderTetrioNumericTextMarkup(formatDecimal(stats?.pps, 2))}</tspan><tspan class="${labelClass}" dx="${labelGap}">PPS</tspan>${separator}<tspan class="${valueClass}" dx="${valueGap}">${renderTetrioNumericTextMarkup(formatDecimal(stats?.vsscore, 2))}</tspan><tspan class="${labelClass}" dx="${labelGap}">VS</tspan>`;
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

function formatPrisecter(prisecter) {
  const pri = Number(prisecter?.pri);
  const sec = Number(prisecter?.sec);
  const ter = Number(prisecter?.ter);

  if (![pri, sec, ter].every(Number.isFinite)) {
    return null;
  }

  return `${pri}:${sec}:${ter}`;
}

function fetchTetrioFontDataUris() {
  tetrioFontDataUrisPromise ??= Promise.all([
    readLocalFontDataUri(localRegularFontPath)
      .then((localFont) => localFont ?? fetchFontDataUri(tetrioRegularFontUrl)),
    readLocalFontDataUri(localBoldFontPath)
      .then((localFont) => localFont ?? fetchFontDataUri(tetrioBoldFontUrl)),
    getTetrioHunDinFontDataUri(),
  ]).then(([regular, bold, hun]) => ({
    bold,
    boldFileUrl: localBoldFontUrl,
    hun,
    hunFileUrl: localHunFontUrl,
    regular,
    regularFileUrl: localRegularFontUrl,
  }));
  return tetrioFontDataUrisPromise;
}

async function readLocalFontDataUri(path) {
  try {
    const buffer = await readFile(path);
    return `data:font/ttf;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

async function fetchFontDataUri(url) {
  try {
    const response = await fetch(url, { headers: tetrioHeaders });
    if (!response.ok) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:font/ttf;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

function formatRoundTime(milliseconds) {
  const totalSeconds = Math.floor(Number(milliseconds) / 1000);
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '-';
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatPlayedAtUtc(value) {
  const timestamp = value ? new Date(value) : null;
  if (!timestamp || Number.isNaN(timestamp.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(timestamp);
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

function renderTetrioFontFace(fontDataUris = {}) {
  const rules = [];

  if (fontDataUris.regular || fontDataUris.regularFileUrl) {
    rules.push(`@font-face {
        font-family: "C";
        src: ${renderFontSources(fontDataUris.regularFileUrl, fontDataUris.regular)};
        font-weight: 500;
        font-style: normal;
      }`);
  }

  if (fontDataUris.bold || fontDataUris.boldFileUrl) {
    rules.push(`@font-face {
        font-family: "C";
        src: ${renderFontSources(fontDataUris.boldFileUrl, fontDataUris.bold)};
        font-weight: 900;
        font-style: normal;
      }`);
  }

  if (fontDataUris.hun || fontDataUris.hunFileUrl) {
    rules.push(renderTetrioHunDinFontFace(fontDataUris.hun ?? fontDataUris.hunFileUrl));
  }

  return rules.join('\n      ');
}

function renderFontSources(fileUrl, dataUri) {
  return [fileUrl, dataUri]
    .filter(Boolean)
    .map((source) => `url("${source}") format("truetype")`)
    .join(', ');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function roundSvgNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

