import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const tetrioApiBaseUrl = 'https://ch.tetr.io/api';
const tetrioGameBaseUrl = 'https://tetr.io';
const tetrioHunFontUrl = `${tetrioGameBaseUrl}/res/font/hun2.ttf?v=6`;
const localHunFontPath = fileURLToPath(new URL('../assets/fonts/hun2.ttf', import.meta.url));
const tetrioHeaders = {
  'User-Agent': 'discord-bot/1.0 TETR.IO league match card',
  'X-Session-ID': 'discord-bot-tetrio-league-match',
};
const tetrioRecordPageSize = 100;
const leagueFontFamily = '"HUN2", "HUN", "Noto Sans CJK KR", "Noto Sans KR", "Noto Sans CJK", "Malgun Gothic", "Apple SD Gothic Neo", Arial, sans-serif';
const sideThemes = [
  {
    name: 'blue',
    topGradient: 'blueTop',
    rowGradient: 'blueRow',
    rowWinGradient: 'blueRowWin',
    border: '#257bff',
    mutedBorder: '#124276',
    label: '#2e82ff',
    score: '#ffffff',
  },
  {
    name: 'red',
    topGradient: 'redTop',
    rowGradient: 'redRow',
    rowWinGradient: 'redRowWin',
    border: '#ff242a',
    mutedBorder: '#6e1216',
    label: '#ff3438',
    score: '#ffffff',
  },
];

let tetrioHunFontDataUriPromise = null;

export async function createTetrioLeagueMatchCard(username, matchIndex = 1) {
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
  const hunFont = await fetchTetrioHunFontDataUri();
  const svg = renderLeagueMatchSvg(match, hunFont);
  const image = await sharp(Buffer.from(svg)).png().toBuffer();

  return {
    image,
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

function renderLeagueMatchSvg(match, hunFontDataUri = null) {
  const width = 790;
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
  const topPanels = match.players.map((player, index) => renderTopPanel(player, index, topY, topHeight)).join('');
  const rows = match.rounds
    .map((round, index) => renderRoundRow(round, rowStartY + index * (rowHeight + rowGap), rowHeight))
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="blueTop" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#06101d"/>
      <stop offset="1" stop-color="#173968"/>
    </linearGradient>
    <linearGradient id="redTop" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#611317"/>
      <stop offset="1" stop-color="#100205"/>
    </linearGradient>
    <linearGradient id="blueRow" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#010407"/>
      <stop offset="1" stop-color="#0b2e5d"/>
    </linearGradient>
    <linearGradient id="blueRowWin" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#07101b"/>
      <stop offset="1" stop-color="#2b74dd"/>
    </linearGradient>
    <linearGradient id="redRow" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#571116"/>
      <stop offset="1" stop-color="#050101"/>
    </linearGradient>
    <linearGradient id="redRowWin" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#cf272e"/>
      <stop offset="1" stop-color="#220407"/>
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
    <style>
      ${renderTetrioFontFace(hunFontDataUri)}
      text {
        font-family: ${leagueFontFamily};
        letter-spacing: 0;
      }
      .username {
        fill: #f6f2ef;
        font-size: 17px;
        font-weight: 800;
      }
      .score {
        fill: #ffffff;
        font-size: 55px;
        font-weight: 650;
      }
      .summaryValue {
        fill: #fbf4f2;
        font-size: 11.5px;
        font-weight: 700;
      }
      .roundValue {
        fill: #fbf4f2;
        font-size: 13.6px;
        font-weight: 700;
      }
      .blueLabel {
        fill: ${sideThemes[0].label};
        font-size: 13.6px;
        font-weight: 700;
      }
      .redLabel {
        fill: ${sideThemes[1].label};
        font-size: 13.6px;
        font-weight: 700;
      }
      .summaryBlueLabel {
        fill: ${sideThemes[0].label};
        font-size: 11.5px;
        font-weight: 700;
      }
      .summaryRedLabel {
        fill: ${sideThemes[1].label};
        font-size: 11.5px;
        font-weight: 700;
      }
      .time {
        fill: #ffffff;
        font-size: 14px;
        font-weight: 650;
      }
      .versus {
        fill: #ffd620;
        font-size: 42px;
        font-weight: 800;
      }
      .footer {
        fill: #d9e6d5;
        font-size: 16px;
        font-weight: 800;
      }
    </style>
  </defs>
  <rect width="${width}" height="${height}" fill="#000000"/>
  ${topPanels}
  <text x="395" y="77" text-anchor="middle" dominant-baseline="middle" class="versus" filter="url(#textGlow)">VS</text>
  ${rows}
  <rect x="2" y="${footerY}" width="${width - 4}" height="${footerHeight}" fill="#233f29" stroke="#3d6244" stroke-width="2"/>
  <text x="12" y="${footerY + footerHeight / 2 + 1}" dominant-baseline="middle" class="footer">${escapeXml(match.footerText)}</text>
</svg>`;
}

function renderTopPanel(player, sideIndex, y, height) {
  const theme = sideThemes[sideIndex] ?? sideThemes[0];
  const isLeft = sideIndex === 0;
  const x = isLeft ? 2 : 436;
  const width = 350;
  const textX = isLeft ? x + width - 10 : x + 10;
  const textAnchor = isLeft ? 'end' : 'start';
  const scoreX = isLeft ? x + width - 13 : x + 12;
  const statsClass = isLeft ? 'summaryBlueLabel' : 'summaryRedLabel';

  return `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="url(#${theme.topGradient})" stroke="${theme.border}" stroke-width="2"/>
  <text x="${textX}" y="${y + 22}" text-anchor="${textAnchor}" class="username">${escapeXml(player.username.toUpperCase())}</text>
  <text x="${scoreX}" y="${y + 56}" text-anchor="${textAnchor}" dominant-baseline="middle" class="score" filter="url(#textGlow)">${formatInteger(player.wins)}</text>
  <text x="${textX}" y="${y + height - 12}" text-anchor="${textAnchor}">
    ${renderInlineStats(player.stats, 'summaryValue', statsClass)}
  </text>`;
}

function renderRoundRow(round, y, height) {
  const left = round.sides[0] ?? {};
  const right = round.sides[1] ?? {};

  return `
  ${renderRoundSide(left, 0, y, height)}
  <text x="395" y="${y + height / 2 + 1}" text-anchor="middle" dominant-baseline="middle" class="time">${escapeXml(round.timeText)}</text>
  ${renderRoundSide(right, 1, y, height)}`;
}

function renderRoundSide(side, sideIndex, y, height) {
  const theme = sideThemes[sideIndex] ?? sideThemes[0];
  const isLeft = sideIndex === 0;
  const x = isLeft ? 82 : 414;
  const width = 292;
  const textX = isLeft ? x + width - 10 : x + 10;
  const textAnchor = isLeft ? 'end' : 'start';
  const fill = side.alive ? theme.rowWinGradient : theme.rowGradient;
  const border = side.alive ? theme.border : theme.mutedBorder;
  const opacity = side.alive ? 1 : 0.76;
  const labelClass = sideIndex === 0 ? 'blueLabel' : 'redLabel';
  const innerLineX = isLeft ? x + width : x;
  const innerLineColor = side.alive ? '#ffffff' : theme.border;

  return `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="url(#${fill})" stroke="${border}" stroke-width="1.4" opacity="${opacity}"/>
  <line x1="${innerLineX}" y1="${y}" x2="${innerLineX}" y2="${y + height}" stroke="${innerLineColor}" stroke-width="2.4" opacity="${opacity}"/>
  <text x="${textX}" y="${y + height / 2 + 1}" text-anchor="${textAnchor}" dominant-baseline="middle">
    ${renderInlineStats(side.stats, 'roundValue', labelClass)}
  </text>`;
}

function renderInlineStats(stats, valueClass, labelClass) {
  return `<tspan class="${valueClass}">${escapeXml(formatDecimal(stats?.apm, 2))}</tspan><tspan class="${labelClass}" dx="3">APM</tspan><tspan class="${valueClass}" dx="8">&#183;</tspan><tspan class="${valueClass}" dx="8">${escapeXml(formatDecimal(stats?.pps, 2))}</tspan><tspan class="${labelClass}" dx="3">PPS</tspan><tspan class="${valueClass}" dx="8">&#183;</tspan><tspan class="${valueClass}" dx="8">${escapeXml(formatDecimal(stats?.vsscore, 2))}</tspan><tspan class="${labelClass}" dx="3">VS</tspan>`;
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

function fetchTetrioHunFontDataUri() {
  tetrioHunFontDataUriPromise ??= readLocalFontDataUri(localHunFontPath)
    .then((localFont) => localFont ?? fetchFontDataUri(tetrioHunFontUrl));
  return tetrioHunFontDataUriPromise;
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

function renderTetrioFontFace(fontDataUri) {
  if (!fontDataUri) {
    return '';
  }

  return `@font-face {
        font-family: "HUN2";
        src: url("${fontDataUri}") format("truetype");
        font-weight: 400 900;
        font-style: normal;
      }
      @font-face {
        font-family: "HUN";
        src: url("${fontDataUri}") format("truetype");
        font-weight: 400 900;
        font-style: normal;
      }`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
