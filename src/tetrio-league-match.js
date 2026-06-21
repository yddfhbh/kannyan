import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  getTetrioHunDinFontDataUri,
  renderTetrioHunDinFontFace,
  renderTetrioNumericTextMarkup,
  shouldUseArialFallbackForHunDin,
  renderTetrioTextWeightCss,
  renderTetrioSvgToPng,
  tetrioFontFamily,
  tetrioHunDinFontUrl,
} from './tetrio-font.js';
import { calculateApp } from './tetrio-stats-calculations.js';

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
const recentLeagueListRenderScale = 2;
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

const leagueMatchCardRenderScale = 2;

export async function createTetrioLeagueMatchCard(username, matchIndex = 1) {
  const card = await createTetrioLeagueMatchCardSvg(username, matchIndex);
  const image = renderTetrioSvgToPng(card.svg, leagueMatchCardRenderScale);

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

export async function createTetrioLeagueRecentListCard(username, recentCount = 10) {
  const normalizedUsername = normalizeTetrioUsername(username);
  const normalizedRecentCount = normalizeRecentRecordCount(recentCount);

  if (!normalizedUsername) {
    const error = new Error('TETR.IO username is required');
    error.status = 400;
    throw error;
  }

  const records = await fetchRecentLeagueRecords(normalizedUsername, normalizedRecentCount);
  if (records.length === 0) {
    const error = new Error('No TETRA LEAGUE matches found for the requested user');
    error.code = 'NO_RECORD';
    error.status = 404;
    throw error;
  }

  const rows = records
    .map((record, index) => buildRecentLeagueMatchRow(record, normalizedUsername, index + 1))
    .filter(Boolean);

  if (rows.length === 0) {
    const error = new Error('No TETRA LEAGUE matches found for the requested user');
    error.code = 'NO_RECORD';
    error.status = 404;
    throw error;
  }

  const usernameLabel = rows[0]?.targetUsername ?? normalizedUsername;
  const totalTrDelta = sumRecentLeagueDisplayedTrDelta(rows);
  const fontDataUris = await fetchTetrioFontDataUris();
  const svg = renderRecentLeagueListSvg({
    totalTrDelta: formatSignedDecimal(totalTrDelta, 2),
    username: usernameLabel,
    requestedCount: normalizedRecentCount,
    rowCount: rows.length,
    rows,
  }, fontDataUris);
  const image = renderTetrioSvgToPng(svg, recentLeagueListRenderScale);

  return {
    image,
    recentCount: rows.length,
    rows,
    username: usernameLabel,
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

async function fetchRecentLeagueRecords(username, recentCount) {
  const limit = normalizeRecentRecordCount(recentCount);
  const searchParams = new URLSearchParams({ limit: String(limit) });
  const response = await fetchTetrioJson(
    `/users/${encodeURIComponent(username)}/records/league/recent?${searchParams.toString()}`
  );

  return Array.isArray(response.data?.entries)
    ? response.data.entries.slice(0, limit)
    : [];
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
  font-size: 17px;
  font-weight: 950;
  stroke: rgba(246,242,239,0.68);
  stroke-width: 0.62px;
  paint-order: stroke fill;
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
  font-size: 10.2px;
  font-weight: 950;
  stroke: rgba(255,255,255,0.55);
  stroke-width: 0.5px;
  paint-order: stroke fill;
}

.roundValue {
  fill: #f0f3fa;
  font-size: 13px;
  font-weight: 950;
  stroke: rgba(255,255,255,0.82);
  stroke-width: 0.85px;
  paint-order: stroke fill;
}

.blueLabel {
  fill: #b7ddff;
  stroke: rgba(16,42,80,0.64);
  stroke-width: 0.52px;
  font-size: 12.1px;
  font-weight: 950;
  paint-order: stroke fill;
}

.redLabel {
  fill: #ff6a6a;
  stroke: rgba(120,20,24,0.65);
  stroke-width: 0.48px;
  font-size: 11.8px;
  font-weight: 950;
  paint-order: stroke fill;
  opacity: 1;
}

.summaryBlueLabel {
  fill: #afd7ff;
  stroke: rgba(16,42,80,0.58);
  stroke-width: 0.42px;
  font-size: 9.5px;
  font-weight: 950;
  paint-order: stroke fill;
  opacity: 1;
}

.summaryRedLabel {
  fill: #ff6a6a;
  stroke: rgba(120,20,24,0.65);
  stroke-width: 0.36px;
  font-size: 9.3px;
  font-weight: 950;
  paint-order: stroke fill;
  opacity: 1;
}
.time {
  fill: #ffffff;
  font-size: 13.5px;
  font-weight: 950;
  stroke: rgba(255,255,255,0.75);
  stroke-width: 0.65px;
  paint-order: stroke fill;
}

.timeColon {
  fill: #ffffff;
  font-family: Arial;
  font-size: 1.22em;
  font-weight: 900;
  stroke: rgba(255,255,255,0.75);
  stroke-width: 0.45px;
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
.footerTime {
  fill: #b8e7b8;
  stroke: rgba(184,231,184,0.86);
  stroke-width: 0.58px;
  font-size: 14px;
  font-weight: 950;
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
${renderFooterLineMarkup(match.footerText, 24, footerY + footerHeight / 2 + 1)}
</svg>`;
}

function renderRoundTimeMarkup(value) {
  return String(value ?? '-')
    .split('')
    .map((char) => {
      if (char === ':') {
        return '<tspan class="timeColon">:</tspan>';
      }

      return escapeXml(char);
    })
    .join('');
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
 <text x="${roundCenterX}" y="${y + height / 2 + 1}" text-anchor="middle" dominant-baseline="middle" class="time">${renderRoundTimeMarkup(round.timeText)}</text>
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
  const isLeft = sideIndex === 0;
  const blockWidth = 188;
  const blockX = isLeft ? x + width - blockWidth - 16 : x - 8;

  const blueLabelNudge = -4;
  const redValueNudge = 3;

  const blueSep1Nudge = -8;
  const blueSep2Nudge = -10;
  const redSep1Nudge = -6;
  const redSep2Nudge = -8;

  const labelNudge = isLeft ? blueLabelNudge : 0;
  const valueNudge = isLeft ? 0 : redValueNudge;
  const sep1Nudge = isLeft ? blueSep1Nudge : redSep1Nudge;
  const sep2Nudge = isLeft ? blueSep2Nudge : redSep2Nudge;

  const separatorFontSize = 7.2;
  const separatorYOffset = -0.1;

  const columns = [
    {
      valueX: 42 + valueNudge,
      labelX: 50 + labelNudge,
      label: 'APM',
      value: formatDecimal(stats?.apm, 2),
    },
    {
      separatorX: 85 + sep1Nudge,
      separator: '&#9635;',
      separatorClass: labelClass,
      fontSize: separatorFontSize,
      yOffset: separatorYOffset,
    },

    {
      valueX: 108 + valueNudge,
      labelX: 115 + labelNudge,
      label: 'PPS',
      value: formatDecimal(stats?.pps, 2),
    },
    {
      separatorX: 151 + sep2Nudge,
      separator: '&#9635;',
      separatorClass: labelClass,
      fontSize: separatorFontSize,
      yOffset: separatorYOffset,
    },

    {
      valueX: 182 + valueNudge,
      labelX: 187 + labelNudge,
      label: 'VS',
      value: formatDecimal(stats?.vsscore, 2),
    },
  ];

  return renderStatsColumns(columns, blockX, baselineY, valueClass, labelClass);
}

function renderRoundStatsMarkup(stats, x, width, baselineY, sideIndex, valueClass, labelClass) {
  const isLeft = sideIndex === 0;

  const apmText = formatDecimal(stats?.apm, 2);
  const ppsText = formatDecimal(stats?.pps, 2);
  const vsText = formatDecimal(stats?.vsscore, 2);

  if (isLeft) {
    const vsEndX = x + width - 64;
    return renderRelativeRoundStatsMarkup({
      anchorX: vsEndX,
      anchor: 'end',
      baselineY,
      valueClass,
      labelClass,
      statsText: {
        apm: apmText,
        pps: ppsText,
        vs: vsText,
      },
    });
  }

  const redRoundNudge = -8;
  const redApmValueX = x + 18 + redRoundNudge;

  return renderRelativeRoundStatsMarkup({
    anchorX: redApmValueX,
    anchor: 'start',
    baselineY,
    valueClass,
    labelClass,
    statsText: {
      apm: apmText,
      pps: ppsText,
      vs: vsText,
    },
  });
}

function renderRelativeRoundStatsMarkup(options = {}) {
  const {
    anchorX = 0,
    anchor = 'start',
    baselineY = 0,
    valueClass = 'roundValue',
    labelClass = 'blueLabel',
    statsText = {},
  } = options;
  const labelGap = 6.2;
  const separatorGap = 8.4;
  const valueGap = 8.4;

  return `<text x="${roundSvgNumber(anchorX)}" y="${baselineY}" text-anchor="${anchor}" dominant-baseline="middle">
    <tspan class="${valueClass}">${renderLeagueRoundNumberMarkup(statsText.apm ?? '-')}</tspan><tspan class="${labelClass}" dx="${labelGap}">APM</tspan><tspan class="${valueClass}" dx="${separatorGap}">-</tspan><tspan class="${valueClass}" dx="${valueGap}">${renderLeagueRoundNumberMarkup(statsText.pps ?? '-')}</tspan><tspan class="${labelClass}" dx="${labelGap}">PPS</tspan><tspan class="${valueClass}" dx="${separatorGap}">-</tspan><tspan class="${valueClass}" dx="${valueGap}">${renderLeagueRoundNumberMarkup(statsText.vs ?? '-')}</tspan><tspan class="${labelClass}" dx="${labelGap}">VS</tspan>
  </text>`;
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

  const dateMatch = match[3].match(/^(\d{1,2}\/\d{1,2}\/\d{4})(,)?\s+(.+?)\s+(AM|PM)$/i);
  const dateMarkup = dateMatch
    ? `<tspan dx="7" class="footerDate">${escapeXml(`${dateMatch[1]}${dateMatch[2] ?? ''}`)}</tspan><tspan dx="7" class="footerTime">${escapeXml(dateMatch[3])}</tspan><tspan dx="5" class="footerDate">${escapeXml(dateMatch[4].toUpperCase())}</tspan>`
    : `<tspan dx="7" class="footerDate">${escapeXml(match[3])}</tspan>`;

  return `<tspan class="footerName">${renderLeagueUsernameMarkup(match[1])}</tspan><tspan dx="8" class="footerKeyword">VERSUS</tspan><tspan dx="8" class="footerName">${renderLeagueUsernameMarkup(match[2])}</tspan><tspan dx="8" class="footerKeyword">PLAYED</tspan><tspan dx="5" class="footerKeyword">ON</tspan>${dateMarkup}`;}


function estimateFooterCharWidth(char, fontSize = 14) {
  if (char === ' ') return fontSize * 0.34;
  if (char === 'I' || char === '1' || char === 'L') return fontSize * 0.34;
  if (char === 'M' || char === 'W') return fontSize * 0.88;

  // 추가
  if (char === ':') return fontSize * 0.24;
  if (char === '/') return fontSize * 0.34;
  if (char === ',') return fontSize * 0.22;
  if (char === '.') return fontSize * 0.22;

  if (/[0-9]/.test(char)) return fontSize * 0.58;
  return fontSize * 0.62;
}

function measureFooterTextWidth(text, fontSize = 14) {
  return [...String(text ?? '')].reduce((sum, char) => {
    if (char === '_') return sum + 8.8;
    return sum + estimateFooterCharWidth(char, fontSize);
  }, 0);
}

function renderFooterPlainText(text, x, y, className, fontSize = 14) {
  const value = String(text ?? '');

  return {
    markup: `<text x="${roundSvgNumber(x)}" y="${roundSvgNumber(y)}" dominant-baseline="middle" class="footer ${className}">${escapeXml(value)}</text>`,
    width: measureFooterTextWidth(value, fontSize),
  };
}

function renderFooterNameText(text, x, y) {
  const raw = String(text ?? '').toUpperCase();

  let cursorX = x;
  let markup = '';

  for (const char of raw) {
    if (char === '_') {
      const metrics = getFooterUnderscoreMetrics();

      markup += `<text x="${roundSvgNumber(cursorX + metrics.beforeGap)}" y="${roundSvgNumber(y + metrics.yOffset)}" dominant-baseline="middle" class="footer footerName" style="font-family: Arial !important;" font-size="13">${escapeXml(char)}</text>`;
      cursorX += metrics.advance;
      continue;
    }

    const fontFamilyAttr = shouldUseArialFallbackForHunDin(char)
      ? ' font-family="Arial"'
      : '';
    markup += `<text x="${roundSvgNumber(cursorX)}" y="${roundSvgNumber(y)}" dominant-baseline="middle" class="footer footerName"${fontFamilyAttr}>${escapeXml(char)}</text>`;
    cursorX += estimateFooterNameCharWidth(char);
  }

  return {
    markup: `<g>${markup}</g>`,
    width: cursorX - x,
  };
}

function estimateFooterNameCharWidth(char, fontSize = 14) {
  if (char === ' ') return fontSize * 0.34;
  if (char === 'I' || char === '1') return fontSize * 0.46;
  if (char === 'L') return fontSize * 0.38;
  if (char === 'M' || char === 'W') return fontSize * 0.88;
  return fontSize * 0.62;
}

function measureFooterNameTextWidth(text, fontSize = 14) {
  let width = 0;

  for (const char of String(text ?? '').toUpperCase()) {
    if (char === '_') {
      width += getFooterUnderscoreMetrics().advance;
    } else {
      width += estimateFooterNameCharWidth(char, fontSize);
    }
  }

  return width;
}

function getFooterUnderscoreMetrics() {
  const beforeGap = 2.6;
  const width = 8.8;
  const afterGap = 2.4;

  return {
    beforeGap,
    width,
    afterGap,
    advance: beforeGap + width + afterGap,
    height: 1.7,
    yOffset: 0.8,
  };
}


function renderFooterLineMarkup(text, x, y) {
  return `<text x="${roundSvgNumber(x)}" y="${roundSvgNumber(y)}" dominant-baseline="middle" class="footer" xml:space="preserve">${renderFooterTextMarkup(text)}</text>`;
}

function estimateLeagueUsernameCharWidth(char, fontSize = 18) {
  if (char === ' ') return fontSize * 0.33;

  if (char === 'I' || char === '1') return fontSize * 0.44;
  if (char === 'L') return fontSize * 0.46;

  if (char === 'M' || char === 'W') return fontSize * 0.72;

  return fontSize * 0.60;
}

function measureLeagueUsernameWidth(text, fontSize = 17) {
  return [...String(text ?? '')].reduce((sum, char) => {
    if (char === '_') return sum;
    return sum + estimateLeagueUsernameCharWidth(char, fontSize);
  }, 0);
}

function renderLeagueUsernameLabel(text, x, y, anchor = 'start') {
  const raw = String(text ?? '').toUpperCase();
  const fontSize = 17;

  if (!raw.includes('_')) {
    return `<text x="${roundSvgNumber(x)}" y="${y}" text-anchor="${anchor}" class="username">${escapeXml(raw)}</text>`;
  }

  const totalWidth = measureLeagueUsernameRenderedWidth(raw, fontSize);
  const startX = anchor === 'end'
    ? x - totalWidth
    : x;

  let cursorX = startX;
  let markup = '';

  for (const char of raw) {
    if (char === '_') {
      const metrics = getLeagueUsernameUnderscoreMetrics(fontSize);

      markup += `<text x="${roundSvgNumber(cursorX + metrics.beforeGap)}" y="${roundSvgNumber(y + metrics.yOffset)}" class="username" style="font-family: Arial !important;" font-size="15">${escapeXml(char)}</text>`;
      cursorX += metrics.advance;
      continue;
    }

    const fontFamilyAttr = shouldUseArialFallbackForHunDin(char)
      ? ' font-family="Arial"'
      : '';
    markup += `<text x="${roundSvgNumber(cursorX)}" y="${y}" class="username"${fontFamilyAttr}>${escapeXml(char)}</text>`;
    cursorX += estimateLeagueUsernameCharWidth(char, fontSize);
  }

  return `<g>${markup}</g>`;
}

function measureLeagueUsernameRenderedWidth(text, fontSize = 17) {
  let width = 0;

  for (const char of String(text ?? '').toUpperCase()) {
    if (char === '_') {
      width += getLeagueUsernameUnderscoreMetrics(fontSize).advance;
      continue;
    }

    width += estimateLeagueUsernameCharWidth(char, fontSize);
  }

  return width;
}

function getLeagueUsernameUnderscoreMetrics(fontSize = 17) {
  const beforeGap = fontSize * 0.18;
  const width = fontSize * 0.58;
  const afterGap = fontSize * 0.16;

  return {
    beforeGap,
    width,
    afterGap,
    advance: beforeGap + width + afterGap,
    height: 2.0,
    yOffset: -0.12,
  };
}

function getLeagueUsernameUnderscoreNudge(previousChar) {
  const char = String(previousChar ?? '').toUpperCase();

  // I 뒤는 너무 오른쪽으로 밀면 밖으로 나가기 쉬움
  if (char === 'I' || char === '1' || char === 'L') {
    return 3;
  }

  return 5.6;
}

function renderLeagueUsernameMarkup(value, options = {}) {
  const text = String(value ?? '');
  const underscoreOffsetEm = Number.isFinite(options.underscoreOffsetEm)
    ? Number(options.underscoreOffsetEm)
    : -0.08;
  let markup = '';

  for (const char of text) {
    if (shouldUseArialFallbackForHunDin(char)) {
      const fontSizeAttr = char === '_' ? ' font-size="1.05em"' : '';
      const styleAttr = char === '_' && Math.abs(underscoreOffsetEm) > 0.0001
        ? ` style="baseline-shift: ${roundSvgNumber(underscoreOffsetEm)}em;"`
        : '';
      markup += `<tspan font-family="Arial"${fontSizeAttr} font-weight="900" stroke="none"${styleAttr}>${escapeXml(char)}</tspan>`;
    } else {
      markup += escapeXml(char);
    }
  }

  return markup;
}

function renderRecentLeagueHeaderTitleMarkup(username) {
  const raw = String(username ?? '').toUpperCase();
  const headerWordGap = 22;
  const headerDotGap = 14;
  const headerUnderscoreOffsetEm = -0.03;
  if (!raw) {
    return `<tspan class="headerWord">LEAGUE</tspan><tspan dx="${headerWordGap}" class="headerWord">RECENT</tspan>`;
  }

  return `<tspan class="headerName">${renderLeagueUsernameMarkup(raw, { underscoreOffsetEm: headerUnderscoreOffsetEm })}</tspan><tspan dx="${headerDotGap}" class="headerDot">&#8226;</tspan><tspan dx="${headerDotGap}" class="headerWord">LEAGUE</tspan><tspan dx="${headerWordGap}" class="headerWord">RECENT</tspan>`;
}

function renderRecentLeagueVsTextMarkup(opponent) {
  const raw = String(opponent ?? '').toUpperCase();
  const labelGap = 7;
  if (!raw) {
    return `<tspan class="vsLabel">VS</tspan><tspan dx="${labelGap}">-</tspan>`;
  }

  return `<tspan class="vsLabel">VS</tspan><tspan dx="${labelGap}">&#8203;</tspan><tspan class="vsName">${renderLeagueUsernameMarkup(raw)}</tspan>`;
}

function renderRecentLeagueHashMarkup(value) {
  return Array.from(String(value ?? ''))
    .map((char) => (char === '#'
      ? '<tspan font-family="Arial" font-weight="900">#</tspan>'
      : escapeXml(char)))
    .join('');
}

function renderLeagueNumberMarkup(value) {
  const text = String(value ?? '-');
  if (!text.includes('.')) {
    return renderTetrioNumericTextMarkup(text);
  }

  const dotMarkup = '<tspan font-family="Arial" font-size="1.16em" font-weight="900" stroke="none" style="baseline-shift: -0.08em;">.</tspan>';
  return text
    .split('.')
    .map((segment, index) => {
      const prefix = index === 0 ? '' : dotMarkup;
      return `${prefix}${renderTetrioNumericTextMarkup(segment)}`;
    })
    .join('');
}

function renderRecentLeagueResultMarkup(value) {
  const tokens = String(value ?? '')
    .toUpperCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const tokenGap = 6;

  if (tokens.length === 0) {
    return '-';
  }

  return tokens
    .map((token, index) => {
      const content = renderTetrioNumericTextMarkup(token);
      return index === 0
        ? `<tspan>${content}</tspan>`
        : `<tspan dx="${tokenGap}">${content}</tspan>`;
    })
    .join('');
}

function renderLeagueRoundNumberMarkup(value) {
  const text = String(value ?? '-');
  let markup = '';
  const dotFontSize = '1.38em';
  const dotShiftEm = '-0.26em';

  for (const char of text) {
    if (char === '.') {
      markup += `<tspan font-family="Arial" font-size="${dotFontSize}" stroke="none" style="baseline-shift: ${dotShiftEm};">.</tspan>`;
      continue;
    }

    markup += escapeXml(char);
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

function buildRecentLeagueMatchRow(record, requestedUsername, rowIndex) {
  const leaderboard = Array.isArray(record?.results?.leaderboard)
    ? record.results.leaderboard
    : [];

  if (leaderboard.length < 2) {
    return null;
  }

  const requestedUsernameLower = String(requestedUsername ?? '').toLowerCase();
  const otherUsers = Array.isArray(record?.otherusers) ? record.otherusers : [];
  const otherUserIds = new Set(otherUsers.map((user) => user?.id).filter(Boolean));
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
  const opponentSide = sortedPlayers.find((player) => player.id !== targetSide.id) ?? null;

  if (!opponentSide) {
    return null;
  }

  const resultType = String(record?.extras?.result ?? '').toLowerCase();
  const targetWins = Number(targetSide.wins);
  const opponentWins = Number(opponentSide.wins);
  const hasWins = Number.isFinite(targetWins) && Number.isFinite(opponentWins);
  const isWin = hasWins
    ? targetWins > opponentWins
    : resultType.includes('victory');
  const isDq = resultType.includes('dq');
  const opponentMeta = otherUsers.find((user) => user?.id === opponentSide.id)
    ?? otherUsers.find((user) => String(user?.username ?? '').toLowerCase() === opponentSide.username.toLowerCase())
    ?? null;
  const resultLabel = isDq
    ? `${isWin ? 'VICTORY' : 'DEFEAT'} BY DQ`
    : `${isWin ? 'VICTORY' : 'DEFEAT'} ${formatRecentMatchScore(targetWins, opponentWins)}`;

  return {
    apm: formatDecimal(targetSide.stats?.apm, 2),
    app: formatDecimal(calculateApp(targetSide.stats?.apm, targetSide.stats?.pps), 2),
    index: rowIndex,
    isDq,
    isWin,
    opponent: opponentSide.username,
    playedAtText: formatPlayedAtKorea(record?.ts),
    pps: formatDecimal(targetSide.stats?.pps, 2),
    replayId: record?.replayid ?? null,
    resultLabel,
    targetUsername: targetSide.username,
    trDelta: formatSignedDecimal(extractLeagueTrDelta(record, targetSide.id), 2),
    vs: formatDecimal(targetSide.stats?.vsscore, 2),
  };
}

function getRecentLeagueRowLayout(x, width) {
  const resultWidth = 238;
  const slant = 18;
  const resultCenterX = x + 118;
  const vsTextX = x + 252;
  const apmX = x + 540;
  const ppsX = x + 624;
  const vsValueX = x + 708;
  const appX = x + 792;
  const deltaX = x + width - 28;
  const dateX = deltaX - 92;
  const dateLabelX = dateX - 84;

  return {
    apmX,
    appX,
    dateLabelX,
    dateX,
    deltaX,
    ppsX,
    resultCenterX,
    resultWidth,
    slant,
    vsTextX,
    vsValueX,
  };
}

function renderRecentLeagueListSvg(card, fontDataUris = {}) {
  const width = 1300;
  const sidePadding = 22;
  const headerHeight = 64;
  const headerY = 18;
  const columnHeaderHeight = 28;
  const columnHeaderGap = 8;
  const rowHeight = 50;
  const rowGap = 4;
  const columnHeaderY = headerY + headerHeight + columnHeaderGap;
  const rowsY = columnHeaderY + columnHeaderHeight + 8;
  const bottomPadding = 10;
  const contentWidth = width - sidePadding * 2;
  const layout = getRecentLeagueRowLayout(sidePadding, contentWidth);
  const totalDeltaClass = getRecentLeagueDeltaClass(card.totalTrDelta, 'headerDeltaValue');
  const height = rowsY + card.rows.length * rowHeight + Math.max(0, card.rows.length - 1) * rowGap + bottomPadding;

  const rowsMarkup = card.rows
    .map((row, index) => renderRecentLeagueRow(row, sidePadding, rowsY + index * (rowHeight + rowGap), contentWidth, rowHeight))
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      ${renderTetrioFontFace(fontDataUris)}
      text {
        font-family: ${leagueFontFamily};
        letter-spacing: 0;
        ${renderTetrioTextWeightCss()}
        stroke-width: 0.38px;
      }
      .bg {
        fill: #081108;
      }
      .panel {
        fill: #0d1b0e;
        stroke: #274629;
        stroke-width: 1;
      }
      .headerTitle {
        font-size: 40px;
        font-weight: 950;
      }
      .headerDeltaValue {
        font-size: 29px;
        font-weight: 1000;
        stroke-width: 0.5px;
      }
      .headerName {
        fill: #A7E08D;
      }
      .headerWord {
        fill: #6F9153;
      }
      .headerDot {
        fill: #f7faf1;
        font-family: Arial;
        font-size: 0.92em;
        font-weight: 900;
      }
      .columnPanel {
        fill: #0d170d;
        stroke: #223421;
        stroke-width: 1;
      }
      .columnLabel {
        fill: #6f9153;
        font-size: 14px;
        font-weight: 900;
      }
      .columnLabelStrong {
        fill: #d8f6d3;
      }
      .rowBody {
        fill: #10210f;
        stroke: #213920;
        stroke-width: 1;
      }
      .rowDivider {
        stroke: rgba(255,255,255,0.08);
        stroke-width: 1;
      }
      .resultWin {
        fill: #ffae45;
      }
      .resultLoss {
        fill: #867dff;
      }
      .resultText {
        fill: #0d1208;
        font-size: 20px;
        font-weight: 1000;
        stroke: rgba(13,18,8,0.5);
        stroke-width: 0.8px;
        paint-order: stroke fill;
      }
      .resultTextLoss {
        fill: #0a0b15;
        stroke: rgba(10,11,21,0.54);
        stroke-width: 0.8px;
        paint-order: stroke fill;
      }
      .vsText {
        fill: #edf8df;
        font-size: 16px;
        font-weight: 980;
        stroke: rgba(237,248,223,0.12);
        stroke-width: 0.34px;
        paint-order: stroke fill;
      }
      .vsLabel {
        fill: #A7E08D;
      }
      .vsName {
        font-size: 19.5px;
        font-weight: 1000;
        stroke: rgba(237,248,223,0.28);
        stroke-width: 0.56px;
        paint-order: stroke fill;
      }
      .statValue {
        fill: #9df18b;
        font-size: 18px;
        font-weight: 940;
        stroke: rgba(157,241,139,0.12);
        stroke-width: 0.32px;
        paint-order: stroke fill;
      }
      .statDate {
        fill: #99df8a;
        font-size: 15.5px;
        font-weight: 930;
        stroke: rgba(153,223,138,0.12);
        stroke-width: 0.3px;
        paint-order: stroke fill;
      }
      .deltaValue {
        fill: #f1fff1;
        font-size: 18px;
        font-weight: 980;
        stroke: rgba(241,255,241,0.14);
        stroke-width: 0.32px;
        paint-order: stroke fill;
      }
      .deltaPositive {
        fill: #ffd84d;
      }
      .deltaNegative {
        fill: #8ec5ff;
      }
      .deltaNeutral {
        fill: #f1fff1;
      }
      .rowIndex {
        fill: #000000;
        font-size: 15px;
        font-weight: 950;
      }
      .footer {
        fill: #62845f;
        font-size: 14px;
        font-weight: 900;
      }
    </style>
  </defs>
  <rect class="bg" width="${width}" height="${height}"/>
  <rect class="panel" x="${sidePadding}" y="${headerY}" width="${contentWidth}" height="${headerHeight}" rx="12"/>
  <text x="${sidePadding + 22}" y="${headerY + 43}" class="headerTitle" xml:space="preserve">${renderRecentLeagueHeaderTitleMarkup(card.username)}</text>
  <text x="${sidePadding + contentWidth - 24}" y="${headerY + (headerHeight / 2) + 2}" text-anchor="end" dominant-baseline="middle" class="${totalDeltaClass}" xml:space="preserve">${renderLeagueNumberMarkup(card.totalTrDelta === '-' ? '-' : `${card.totalTrDelta} TR`)}</text>
  <rect class="columnPanel" x="${sidePadding}" y="${columnHeaderY}" width="${contentWidth}" height="${columnHeaderHeight}" rx="4"/>
  <text x="${layout.apmX}" y="${columnHeaderY + (columnHeaderHeight / 2) + 0.5}" text-anchor="middle" dominant-baseline="middle" class="columnLabel">APM</text>
  <text x="${layout.ppsX}" y="${columnHeaderY + (columnHeaderHeight / 2) + 0.5}" text-anchor="middle" dominant-baseline="middle" class="columnLabel">PPS</text>
  <text x="${layout.vsValueX}" y="${columnHeaderY + (columnHeaderHeight / 2) + 0.5}" text-anchor="middle" dominant-baseline="middle" class="columnLabel">VS</text>
  <text x="${layout.appX}" y="${columnHeaderY + (columnHeaderHeight / 2) + 0.5}" text-anchor="middle" dominant-baseline="middle" class="columnLabel">APP</text>
  <text x="${layout.dateLabelX}" y="${columnHeaderY + (columnHeaderHeight / 2) + 0.5}" text-anchor="middle" dominant-baseline="middle" class="columnLabel">Date</text>
  <text x="${layout.deltaX}" y="${columnHeaderY + (columnHeaderHeight / 2) + 0.5}" text-anchor="end" dominant-baseline="middle" class="columnLabel columnLabelStrong">Gain/loss</text>
  ${rowsMarkup}
</svg>`;
}

function renderRecentLeagueRow(row, x, y, width, height) {
  const layout = getRecentLeagueRowLayout(x, width);
  const {
    resultWidth,
    slant,
    resultCenterX,
    vsTextX,
    apmX,
    ppsX,
    vsValueX,
    appX,
    deltaX,
    dateX,
  } = layout;
  const resultCenterY = y + (height / 2);
  const contentCenterY = y + (height / 2) + 1;
  const panelClass = row.isWin ? 'resultWin' : 'resultLoss';
  const resultTextClass = row.isWin ? 'resultText' : 'resultText resultTextLoss';
  const deltaClass = getRecentLeagueDeltaClass(row.trDelta, 'deltaValue');
  const dividerInset = 6;

  return `
  <g>
    <rect class="rowBody" x="${x}" y="${y}" width="${width}" height="${height}" rx="4"/>
    <polygon class="${panelClass}" points="${x},${y} ${x + resultWidth},${y} ${x + resultWidth - slant},${y + height} ${x},${y + height}"/>
    <line class="rowDivider" x1="${x + resultWidth}" y1="${y + dividerInset}" x2="${x + resultWidth}" y2="${y + height - dividerInset}"/>
    <text x="${x + 12}" y="${y + 17}" class="rowIndex">${renderRecentLeagueHashMarkup(`#${row.index}`)}</text>
    <text x="${resultCenterX}" y="${resultCenterY}" text-anchor="middle" dominant-baseline="middle" class="${resultTextClass}" xml:space="preserve">${renderRecentLeagueResultMarkup(row.resultLabel)}</text>
    <text x="${vsTextX}" y="${contentCenterY}" dominant-baseline="middle" class="vsText" xml:space="preserve">${renderRecentLeagueVsTextMarkup(row.opponent)}</text>
    <text x="${apmX}" y="${contentCenterY}" text-anchor="middle" dominant-baseline="middle" class="statValue">${renderLeagueNumberMarkup(row.apm)}</text>
    <text x="${ppsX}" y="${contentCenterY}" text-anchor="middle" dominant-baseline="middle" class="statValue">${renderLeagueNumberMarkup(row.pps)}</text>
    <text x="${vsValueX}" y="${contentCenterY}" text-anchor="middle" dominant-baseline="middle" class="statValue">${renderLeagueNumberMarkup(row.vs)}</text>
    <text x="${appX}" y="${contentCenterY}" text-anchor="middle" dominant-baseline="middle" class="statValue">${renderLeagueNumberMarkup(row.app)}</text>
    <text x="${dateX}" y="${contentCenterY}" text-anchor="end" dominant-baseline="middle" class="statDate">${escapeXml(row.playedAtText)}</text>
    <text x="${deltaX}" y="${contentCenterY}" text-anchor="end" dominant-baseline="middle" class="${deltaClass}">${renderLeagueNumberMarkup(row.trDelta === '-' ? '-' : `${row.trDelta} TR`)}</text>
  </g>`;
}

function extractLeagueTrDelta(record, playerId) {
  const entries = record?.extras?.league?.[playerId];
  if (!Array.isArray(entries) || entries.length < 2) {
    return null;
  }

  const before = Number(entries[0]?.tr);
  const after = Number(entries[1]?.tr);
  return Number.isFinite(before) && Number.isFinite(after)
    ? after - before
    : null;
}

function sumRecentLeagueDisplayedTrDelta(rows) {
  let total = 0;
  let hasFinite = false;

  for (const row of rows) {
    const number = Number.parseFloat(row?.trDelta);
    if (!Number.isFinite(number)) {
      continue;
    }

    total += number;
    hasFinite = true;
  }

  return hasFinite
    ? Number(total.toFixed(2))
    : null;
}

function formatRecentMatchScore(targetWins, opponentWins) {
  if (!Number.isFinite(targetWins) || !Number.isFinite(opponentWins)) {
    return '-';
  }

  return `${Math.floor(targetWins)}-${Math.floor(opponentWins)}`;
}

function normalizeRecentRecordCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) {
    return 10;
  }

  return Math.min(count, 20);
}

function formatSignedDecimal(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '-';
  }

  const absText = formatDecimal(Math.abs(number), digits);
  if (number > 0) {
    return `+${absText}`;
  }
  if (number < 0) {
    return `-${absText}`;
  }
  return '-';
}

function getRecentLeagueDeltaClass(formattedValue, baseClass) {
  const normalizedBaseClass = String(baseClass ?? '').trim();
  const classSuffix = formattedValue === '-'
    ? 'deltaNeutral'
    : String(formattedValue).startsWith('-')
      ? 'deltaNegative'
      : 'deltaPositive';

  return normalizedBaseClass
    ? `${normalizedBaseClass} ${classSuffix}`
    : classSuffix;
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
  console.log(`[TETRA MATCH FETCH] ${path}`);

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

function renderModeFooterMarkup(username, playedAtText, x, y) {
  const prefix = 'PLAYED BY ';
  const separator = ' · ';
  const fontSize = 14;

  const prefixWidth = estimateFooterTextWidth(prefix, fontSize);
  const nameWidth = estimateFooterTextWidthWithUnderscore(username, fontSize);
  const separatorWidth = estimateFooterTextWidth(separator, fontSize);

  const nameX = x + prefixWidth;
  const separatorX = nameX + nameWidth;
  const dateX = separatorX + separatorWidth;

  return `
    <g class="footer">
      <text x="${roundSvgNumber(x)}" y="${roundSvgNumber(y)}" class="footerKeyword">${escapeXml(prefix)}</text>
      ${renderFooterUsernameMarkup(username, nameX, y)}
      <text x="${roundSvgNumber(separatorX)}" y="${roundSvgNumber(y)}" class="footerKeyword">${escapeXml(separator)}</text>
      <text x="${roundSvgNumber(dateX)}" y="${roundSvgNumber(y)}" class="footerDate">${escapeXml(playedAtText)}</text>
    </g>
  `;
}

function renderFooterUsernameMarkup(username, startX, baselineY) {
  const text = String(username ?? '').toUpperCase();

  const underscoreWidth = 6.6;
  const underscoreHeight = 1.9;
  const underscoreYOffset = 0.6;
  const underscoreAdvance = 7.2;
  const underscoreNudgeX = 0.3;

  let x = startX;
  let markup = '';

  for (const char of text) {
    if (char === '_') {
      markup += `
        <text
          x="${roundSvgNumber(x + underscoreNudgeX)}"
          y="${roundSvgNumber(baselineY + underscoreYOffset)}"
          class="footerName"
          style="font-family: Arial !important;"
          font-size="13"
        >${escapeXml(char)}</text>`;
      x += underscoreAdvance;
      continue;
    }

    const fontFamilyAttr = shouldUseArialFallbackForHunDin(char)
      ? ' font-family="Arial"'
      : '';
    markup += `
      <text
        x="${roundSvgNumber(x)}"
        y="${roundSvgNumber(baselineY)}"
        class="footerName"
        ${fontFamilyAttr}
      >${escapeXml(char)}</text>`;

    x += estimateFooterCharWidth(char);
  }

  return markup;
}

function estimateFooterTextWidthWithUnderscore(text, fontSize = 14) {
  let width = 0;

  for (const char of String(text ?? '').toUpperCase()) {
    if (char === '_') {
      width += fontSize * 0.52;
    } else {
      width += estimateFooterCharWidth(char, fontSize);
    }
  }

  return width;
}

function estimateFooterTextWidth(text, fontSize = 14) {
  let width = 0;

  for (const char of String(text ?? '')) {
    width += estimateFooterCharWidth(char, fontSize);
  }

  return width;
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

function formatPlayedAtKorea(value) {
  const timestamp = value ? new Date(value) : null;
  if (!timestamp || Number.isNaN(timestamp.getTime())) {
    return '-';
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  const parts = Object.fromEntries(formatter.formatToParts(timestamp).map((part) => [part.type, part.value]));
  const dayPeriod = String(parts.dayPeriod ?? '').toUpperCase() === 'AM'
    ? '오전'
    : '오후';

  return `${parts.year}. ${Number(parts.month)}. ${Number(parts.day)}. ${dayPeriod} ${Number(parts.hour)}:${parts.minute}:${parts.second}`;
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
