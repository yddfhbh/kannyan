import {
  bundledSvgFontFamily,
  renderSvgToPng,
} from './svg-renderer.js';
import {
  buildVArchiveSongPageUrl,
  formatVArchiveSongDlc,
} from './varchive-song.js';
import { normalizeVArchiveNickname } from './varchive-link-store.js';

const varchiveBaseUrl = 'https://v-archive.net';
const varchiveJacketBaseUrl = `${varchiveBaseUrl}/s3/images/jackets`;
const varchiveRequestTimeoutMs = 15_000;
const varchivePerformanceCardWidth = 1400;
const varchivePerformanceCardHeight = 806;
const varchivePerformanceCardOuterPadding = 24;
const varchivePerformanceCardRenderScale = 1;
const varchiveBoardPageCount = 17;
const varchiveBoardPageCacheTtlMs = 10 * 60 * 1000;
const varchiveKeyOrder = ['4B', '5B', '6B', '8B'];
const varchiveDifficultyOrder = ['NM', 'HD', 'MX', 'SC'];
const varchiveHeaderTitleYOffset = 6;
const keyBackgroundUrls = {
  '4B': `${varchiveBaseUrl}/images/bg/4B-BG.png?v=knzjg`,
  '5B': `${varchiveBaseUrl}/images/bg/5B-BG.png?v=knzjg`,
  '6B': `${varchiveBaseUrl}/images/bg/6B-BG.png?v=knzjg`,
  '8B': `${varchiveBaseUrl}/images/bg/8B-BG.png?v=knzjg`,
};
const iconAssetUrls = {
  yellow: `${varchiveBaseUrl}/images/yellow_star.png?v=knzjg`,
  orange: `${varchiveBaseUrl}/images/orange_star.png?v=knzjg`,
  red: `${varchiveBaseUrl}/images/red_star.png?v=knzjg`,
  sc5: `${varchiveBaseUrl}/images/sc_5_star.png?v=knzjg`,
  sc10: `${varchiveBaseUrl}/images/sc_10_star.png?v=knzjg`,
  sc15: `${varchiveBaseUrl}/images/sc_15_star.png?v=knzjg`,
};
const difficultyDisplayLabels = {
  NM: 'NORMAL',
  HD: 'HARD',
  MX: 'MAXIMUM',
  SC: 'SC',
};
const difficultyPalette = {
  NM: { label: '#ffb000', value: '#ff7a18' },
  HD: { label: '#ff8a00', value: '#ff5b7d' },
  MX: { label: '#ff3366', value: '#ff3e72' },
  SC: { label: '#6c63ff', value: '#4b74ff' },
};
const scorePaletteByKind = {
  perfect: {
    fill: '#ffd84d',
    text: '#3f2a00',
  },
  maxcombo: {
    fill: '#cfd8e6',
    text: '#223447',
  },
  clear: {
    fill: '#77daf2',
    text: '#10364a',
  },
  score: {
    fill: '#cfd8e6',
    text: '#223447',
  },
  none: {
    fill: 'transparent',
    text: '#8d8694',
  },
};

const assetDataUrlCache = new Map();
const boardPageHtmlCache = new Map();
const tierBoardApiCache = new Map();

export async function createVArchivePerformanceCard(nickname, song, options = {}) {
  const normalizedNickname = normalizeVArchiveNickname(nickname);
  const fetchImpl = resolveFetch(options.fetchImpl);
  const performance = await fetchVArchiveSongPerformance(normalizedNickname, song, { fetchImpl });
  const assets = await resolvePerformanceCardAssets(song, fetchImpl);
  const svg = renderVArchivePerformanceCardSvg({
    nickname: normalizedNickname,
    song,
    performance,
    jacketDataUrl: assets.jacketDataUrl,
    keyBackgroundDataUrls: assets.keyBackgroundDataUrls,
    difficultyIconDataUrls: assets.difficultyIconDataUrls,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  });
  const image = renderSvgToPng(svg, { scale: varchivePerformanceCardRenderScale });
  const focusUrl = buildPreferredFocusUrl(normalizedNickname, song, performance);

  return {
    image,
    imageFormat: 'png',
    imageContentType: 'image/png',
    nickname: normalizedNickname,
    pageUrl: buildVArchiveSongPageUrl(song),
    focusUrl,
    titleId: String(song?.title ?? ''),
    songName: String(song?.name ?? 'song'),
    performance,
  };
}

export async function fetchVArchiveSongPerformance(nickname, song, options = {}) {
  const normalizedNickname = normalizeVArchiveNickname(nickname);
  const fetchImpl = resolveFetch(options.fetchImpl);
  const titleId = String(song?.title ?? '').trim();

  if (!titleId) {
    const error = new Error('곡 정보를 찾지 못했다냥.');
    error.code = 'INVALID_VARCHIVE_SONG';
    throw error;
  }

  const cells = {};
  const patternGroups = groupSongPatternsByButton(song);

  for (const key of varchiveKeyOrder) {
    const button = Number(key.replace('B', ''));
    const patterns = patternGroups.get(button) ?? [];
    const resolvedEntries = patterns.length > 0
      ? await resolveVArchiveBoardEntriesForButton(normalizedNickname, titleId, button, patterns, { fetchImpl })
      : {};
    const buttonCells = Object.fromEntries(
      varchiveDifficultyOrder.map((difficulty) => {
        const pattern = song?.patterns?.[key]?.[difficulty] ?? null;
        const entry = resolvedEntries[difficulty] ?? null;
        return [
          difficulty,
          buildPerformanceCell(pattern, entry),
        ];
      })
    );
    await applyTierMaxComboFlags({
      nickname: normalizedNickname,
      titleId,
      button,
      buttonCells,
      fetchImpl,
    });
    cells[key] = buttonCells;
  }

  return {
    nickname: normalizedNickname,
    titleId,
    cells,
  };
}

export function renderVArchivePerformanceCardSvg({
  nickname,
  song,
  performance,
  jacketDataUrl = null,
  keyBackgroundDataUrls = {},
  difficultyIconDataUrls = {},
  generatedAt = new Date().toISOString(),
}) {
  performanceCardRenderContext = {
    keyBackgroundDataUrls,
    difficultyIconDataUrls,
  };

  const width = varchivePerformanceCardWidth;
  const height = varchivePerformanceCardHeight;
  const contentWidth = width - varchivePerformanceCardOuterPadding * 2;
  const contentX = varchivePerformanceCardOuterPadding;
  const contentY = varchivePerformanceCardOuterPadding;
  const headerHeight = 130;
  const tableY = contentY + headerHeight;
  const tableWidth = contentWidth;
  const keyColumnWidth = 214;
  const diffColumnWidth = Math.floor((tableWidth - keyColumnWidth) / 4);
  const diffStartX = contentX + keyColumnWidth;
  const tableHeaderHeight = 72;
  const rowHeight = 128;
  const footerY = tableY + tableHeaderHeight + rowHeight * 4 + 36;
  const songName = String(song?.name ?? 'Unknown Song');
  const composer = String(song?.composer ?? 'Unknown Composer');
  const dlcLabel = formatVArchiveSongDlc(song);
  const dlcAccent = getVArchiveDlcAccent(song?.dlcCode);
  const pageUrl = buildVArchiveSongPageUrl(song);
  const playerLabel = `PLAYER ${nickname}`;
  const titleId = String(song?.title ?? '-');

  const rowMarkup = varchiveKeyOrder
    .map((key, index) => renderKeyRow({
      song,
      performance,
      key,
      index,
      x: contentX,
      y: tableY + tableHeaderHeight + rowHeight * index,
      keyColumnWidth,
      diffColumnWidth,
      diffStartX,
      rowHeight,
    }))
    .join('');

  const diffHeaderMarkup = varchiveDifficultyOrder
    .map((difficulty, index) => renderDifficultyHeader({
      difficulty,
      x: diffStartX + diffColumnWidth * index,
      y: tableY,
      width: diffColumnWidth,
      height: tableHeaderHeight,
    }))
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      text {
        font-family: ${bundledSvgFontFamily};
        letter-spacing: 0;
      }
      .title {
        fill: #12111a;
        font-size: 42px;
        font-weight: 900;
      }
      .subtitle {
        fill: #644f63;
        font-size: 26px;
        font-weight: 700;
      }
      .player {
        fill: #557089;
        font-size: 22px;
        font-weight: 800;
      }
      .dlcBadgeText {
        fill: #ffffff;
        font-size: 20px;
        font-weight: 900;
      }
      .footer {
        fill: #7e7484;
        font-size: 18px;
        font-weight: 700;
      }
      .keyLabel {
        fill: #ffffff;
        font-size: 60px;
        font-weight: 900;
        stroke: #23314e;
        stroke-width: 2.2;
        paint-order: stroke fill;
      }
      .cellLevel {
        font-size: 46px;
        font-weight: 900;
      }
      .cellFloor {
        font-size: 23px;
        font-weight: 800;
      }
      .cellScore {
        font-size: 34px;
        font-weight: 900;
      }
      .cellScoreKind {
        font-size: 18px;
        font-weight: 800;
      }
      .cellDash {
        fill: #8d8694;
        font-size: 38px;
        font-weight: 800;
      }
      .titleId {
        fill: #5f5967;
        font-size: 22px;
        font-weight: 700;
      }
    </style>
    <linearGradient id="pageBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff7fb"/>
      <stop offset="1" stop-color="#f2eef6"/>
    </linearGradient>
    <linearGradient id="headerBg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#f3e8ee"/>
      <stop offset="1" stop-color="#ede8ee"/>
    </linearGradient>
    <linearGradient id="headerGlow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="jacketClip">
      <rect x="${contentX + 10}" y="${contentY + 10}" width="92" height="92" rx="14" ry="14"/>
    </clipPath>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#pageBg)"/>
  <rect x="${contentX}" y="${contentY}" width="${contentWidth}" height="${headerHeight}" fill="url(#headerBg)" stroke="${dlcAccent.gridColor}" stroke-width="2"/>
  <rect x="${contentX + 1}" y="${contentY + 1}" width="${contentWidth - 2}" height="${headerHeight - 2}" fill="url(#headerGlow)" opacity="0.65"/>
  ${renderHeaderJacket({ contentX, contentY, jacketDataUrl })}
  <rect x="${contentX + 124}" y="${contentY + 14}" width="156" height="30" rx="8" ry="8" fill="${dlcAccent.badgeFill}"/>
  <text x="${contentX + 142}" y="${contentY + 36}" class="dlcBadgeText">${escapeXml(dlcLabel)}</text>
  <text x="${contentX + 124}" y="${contentY + 78 + varchiveHeaderTitleYOffset}" class="title">${escapeXml(songName)}</text>
  <text x="${contentX + 124}" y="${contentY + 110 + varchiveHeaderTitleYOffset}" class="subtitle">${escapeXml(composer)}</text>
  <text x="${contentX + contentWidth - 12}" y="${contentY + 34}" text-anchor="end" class="player">${escapeXml(playerLabel)}</text>

  <rect x="${contentX}" y="${tableY}" width="${tableWidth}" height="${tableHeaderHeight + rowHeight * 4}" fill="#f6f3f7" stroke="${dlcAccent.gridColor}" stroke-width="2"/>
  ${diffHeaderMarkup}
  ${rowMarkup}
  ${renderTableGridLines({
    x: contentX,
    y: tableY,
    keyColumnWidth,
    diffStartX,
    diffColumnWidth,
    tableWidth,
    tableHeaderHeight,
    rowHeight,
    rowCount: 4,
    diffCount: 4,
    color: dlcAccent.gridColor,
    strokeWidth: 2,
  })}

  <text x="${contentX + 6}" y="${footerY}" class="footer">${escapeXml(`V-ARCHIVE title ID: ${titleId}`)}</text>
  <text x="${contentX + contentWidth}" y="${footerY}" text-anchor="end" class="footer">${escapeXml(`Generated ${formatGeneratedAt(generatedAt)} · V-ARCHIVE`)}</text>
</svg>`;
}

function groupSongPatternsByButton(song) {
  const groups = new Map();

  for (const key of varchiveKeyOrder) {
    const button = Number(key.replace('B', ''));
    const patterns = varchiveDifficultyOrder
      .map((difficulty) => ({
        difficulty,
        pattern: song?.patterns?.[key]?.[difficulty] ?? null,
      }))
      .filter((entry) => Number.isFinite(Number(entry.pattern?.level)));

    groups.set(button, patterns);
  }

  return groups;
}

async function resolveVArchiveBoardEntriesForButton(nickname, titleId, button, patterns, options = {}) {
  const fetchImpl = resolveFetch(options.fetchImpl);
  const pageEntries = await Promise.all(
    Array.from({ length: varchiveBoardPageCount }, (_, index) => index + 1)
      .map(async (boardNo) => ({
        boardNo,
        html: await fetchVArchiveBoardPageHtml(nickname, button, boardNo, { fetchImpl }),
      }))
  );

  return Object.fromEntries(
    patterns.map(({ difficulty }) => {
      for (const pageEntry of pageEntries) {
        const parsed = parseBoardPageEntry(pageEntry.html, button, titleId, difficulty);
        if (parsed) {
          return [difficulty, { ...parsed, boardNo: pageEntry.boardNo }];
        }
      }

      return [difficulty, null];
    })
  );
}

async function fetchVArchiveBoardPageHtml(nickname, button, boardNo, options = {}) {
  const fetchImpl = resolveFetch(options.fetchImpl);
  const normalizedNickname = normalizeVArchiveNickname(nickname);
  const cacheKey = `${normalizedNickname}:${button}:${boardNo}`;
  const cached = boardPageHtmlCache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), varchiveRequestTimeoutMs);
    const url = `${varchiveBaseUrl}/archive/${encodeURIComponent(normalizedNickname)}/board/${button}/${boardNo}`;

    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
        },
      });

      if (!response.ok) {
        const error = new Error(`Failed to fetch V-ARCHIVE board page: ${response.status}`);
        error.code = 'VARCHIVE_BOARD_FETCH_FAILED';
        error.status = response.status;
        error.nickname = normalizedNickname;
        throw error;
      }

      const html = await response.text();

      if (looksLikeNotFoundHtml(html)) {
        const error = new Error(`V-ARCHIVE에서 ${normalizedNickname} 유저를 찾지 못했다냥.`);
        error.code = 'VARCHIVE_PROFILE_NOT_FOUND';
        error.status = 404;
        error.nickname = normalizedNickname;
        throw error;
      }

      return html;
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeoutError = new Error('V-ARCHIVE 응답이 너무 오래 걸린다냥.');
        timeoutError.code = 'VARCHIVE_BOARD_TIMEOUT';
        timeoutError.nickname = normalizedNickname;
        throw timeoutError;
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })();

  boardPageHtmlCache.set(cacheKey, {
    expiresAt: now + varchiveBoardPageCacheTtlMs,
    promise,
  });

  return promise;
}

async function fetchVArchiveTierBoardEntries(nickname, button, options = {}) {
  const fetchImpl = resolveFetch(options.fetchImpl);
  const normalizedNickname = normalizeVArchiveNickname(nickname);
  const normalizedButton = Number(button);
  const cacheKey = `${normalizedNickname}:${normalizedButton}`;
  const cached = tierBoardApiCache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), varchiveRequestTimeoutMs);
    const url = `${varchiveBaseUrl}/api/v3/archive/${encodeURIComponent(normalizedNickname)}/tier/${normalizedButton}`;

    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
        },
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || payload?.success === false) {
        return [];
      }

      return Array.isArray(payload?.tierBoard?.userRatingList)
        ? payload.tierBoard.userRatingList
        : [];
    } catch (error) {
      if (error?.name === 'AbortError') {
        return [];
      }

      return [];
    } finally {
      clearTimeout(timeout);
    }
  })();

  tierBoardApiCache.set(cacheKey, {
    expiresAt: now + varchiveBoardPageCacheTtlMs,
    promise,
  });

  return promise;
}

async function applyTierMaxComboFlags({ nickname, titleId, button, buttonCells, fetchImpl }) {
  const playedDifficulties = varchiveDifficultyOrder.filter((difficulty) => {
    const cell = buttonCells?.[difficulty];
    return cell?.scoreText && cell.scoreText !== '-';
  });

  if (playedDifficulties.length === 0) {
    return;
  }

  const tierEntries = await fetchVArchiveTierBoardEntries(nickname, button, { fetchImpl });
  if (!Array.isArray(tierEntries) || tierEntries.length === 0) {
    return;
  }

  const tierEntryMap = new Map(
    tierEntries.map((entry) => [buildTierPerformanceEntryKey(entry), entry])
  );

  for (const difficulty of playedDifficulties) {
    const cell = buttonCells[difficulty];
    const tierEntry = tierEntryMap.get(buildTierPerformanceEntryKey({
      title: titleId,
      pattern: difficulty,
      boardNo: cell?.boardNo,
    }));

    if (tierEntry?.maxCombo === true) {
      cell.scoreKind = 'maxcombo';
    }
  }
}

function buildTierPerformanceEntryKey(entry) {
  const title = String(entry?.title ?? '').trim();
  const pattern = String(entry?.pattern ?? '').trim().toUpperCase();
  const boardNo = Number(entry?.boardNo);
  return `${title}:${pattern}:${Number.isFinite(boardNo) ? boardNo : '-'}`;
}

function looksLikeNotFoundHtml(html) {
  const text = String(html ?? '');
  return text.includes('페이지를 찾을 수 없습니다')
    && !text.includes('님의 성과표');
}

function parseBoardPageEntry(html, button, titleId, difficulty) {
  const targetId = `${button}-${titleId}-${difficulty}`;
  const startIndex = String(html ?? '').indexOf(`id="${targetId}"`);

  if (startIndex < 0) {
    return null;
  }

  const snippet = html.slice(startIndex, startIndex + 1500);
  const scoreMatch = snippet.match(/<div class="text-center[^"]*?(?:bg-\[color:var\(--([^)]+)\)\][^"]*)?[^"]*">([^<]+)<\/div>/i);

  if (!scoreMatch) {
    return null;
  }

  const scoreText = decodeHtmlEntities(scoreMatch[2]).trim();
  const scoreKind = scoreText === '-'
    ? 'none'
    : normalizeScoreKind(scoreMatch[1]);

  return {
    scoreText,
    scoreKind,
  };
}

function buildPerformanceCell(pattern, entry) {
  if (!pattern || !Number.isFinite(Number(pattern.level))) {
    return {
      level: null,
      floorName: '',
      rating: null,
      scoreText: '-',
      scoreKind: 'none',
      boardNo: null,
    };
  }

  return {
    level: Number(pattern.level),
    floorName: String(pattern.floorName ?? '').trim(),
    rating: Number.isFinite(Number(pattern.rating)) ? Number(pattern.rating) : null,
    scoreText: entry?.scoreText ?? '-',
    scoreKind: entry?.scoreKind ?? 'none',
    boardNo: entry?.boardNo ?? null,
  };
}

function buildPreferredFocusUrl(nickname, song, performance) {
  for (const key of varchiveKeyOrder) {
    const button = Number(key.replace('B', ''));
    for (const difficulty of varchiveDifficultyOrder) {
      const cell = performance?.cells?.[key]?.[difficulty];
      if (cell?.boardNo && cell.scoreText && cell.scoreText !== '-') {
        return `${varchiveBaseUrl}/archive/${encodeURIComponent(nickname)}/board/${button}/${cell.boardNo}#focus_${song.title}-${button}-${difficulty}`;
      }
    }
  }

  for (const key of varchiveKeyOrder) {
    const button = Number(key.replace('B', ''));
    for (const difficulty of varchiveDifficultyOrder) {
      const cell = performance?.cells?.[key]?.[difficulty];
      if (cell?.boardNo) {
        return `${varchiveBaseUrl}/archive/${encodeURIComponent(nickname)}/board/${button}/${cell.boardNo}#focus_${song.title}-${button}-${difficulty}`;
      }
    }
  }

  return buildVArchiveSongPageUrl(song);
}

function renderHeaderJacket({ contentX, contentY, jacketDataUrl }) {
  if (jacketDataUrl) {
    return `<image href="${escapeXml(jacketDataUrl)}" x="${contentX + 10}" y="${contentY + 10}" width="92" height="92" preserveAspectRatio="xMidYMid slice" clip-path="url(#jacketClip)"/>`;
  }

  return `<rect x="${contentX + 10}" y="${contentY + 10}" width="92" height="92" rx="14" ry="14" fill="#d8d3da" stroke="#baadb7" stroke-width="1.5"/>`;
}

function renderDifficultyHeader({ difficulty, x, y, width, height }) {
  const palette = difficultyPalette[difficulty];
  return `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#fbfafc"/>
  <text x="${x + width / 2}" y="${y + 46}" text-anchor="middle" fill="${palette.label}" font-size="30" font-weight="900">${escapeXml(difficultyDisplayLabels[difficulty] ?? difficulty)}</text>`;
}

function renderKeyRow({ song, performance, key, index, x, y, keyColumnWidth, diffColumnWidth, diffStartX, rowHeight }) {
  const keyBackgroundDataUrl = performanceCardRenderContext.keyBackgroundDataUrls?.[key] ?? null;
  const [startColor, endColor] = getKeyRowPalette(key);
  const difficultyCells = varchiveDifficultyOrder
    .map((difficulty, difficultyIndex) => renderDifficultyCell({
      pattern: song?.patterns?.[key]?.[difficulty],
      cell: performance?.cells?.[key]?.[difficulty],
      difficulty,
      x: diffStartX + diffColumnWidth * difficultyIndex,
      y,
      width: diffColumnWidth,
      height: rowHeight,
    }))
    .join('');

  return `
  <defs>
    <linearGradient id="keyGradient${index}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${startColor}"/>
      <stop offset="1" stop-color="${endColor}"/>
    </linearGradient>
  </defs>
  ${keyBackgroundDataUrl
    ? `<defs>
        <clipPath id="keyCellClip${index}">
          <rect x="${x}" y="${y}" width="${keyColumnWidth}" height="${rowHeight}"/>
        </clipPath>
      </defs>
      <g clip-path="url(#keyCellClip${index})">
        <image href="${escapeXml(keyBackgroundDataUrl)}" x="${x - 10}" y="${y}" width="${keyColumnWidth + 82}" height="${rowHeight}" preserveAspectRatio="xMinYMid slice"/>
      </g>`
    : `<rect x="${x}" y="${y}" width="${keyColumnWidth}" height="${rowHeight}" fill="url(#keyGradient${index})"/>`}
  <text x="${x + keyColumnWidth / 2}" y="${y + 82}" text-anchor="middle" class="keyLabel">${escapeXml(key)}</text>
  ${difficultyCells}`;
}

function renderDifficultyCell({ pattern, cell, difficulty, x, y, width, height }) {
  const iconInfo = getDifficultyIconInfo(pattern, difficulty);
  const palette = difficultyPalette[difficulty] ?? difficultyPalette.NM;
  const iconDataUrl = iconInfo?.iconKey
    ? performanceCardRenderContext.difficultyIconDataUrls?.[iconInfo.iconKey] ?? null
    : null;

  if (!pattern || !Number.isFinite(Number(pattern.level))) {
    return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#f8f4f8"/>
    <text x="${x + width / 2}" y="${y + 77}" text-anchor="middle" class="cellDash">-</text>`;
  }

  const level = String(Number(pattern.level));
  const floor = String(pattern.floorName ?? '').trim();
  const levelColor = iconInfo?.textColor ?? palette.value;
  const iconSize = 28;
  const contentWidth = floor ? 170 : 88;
  const contentStartX = x + (width - contentWidth) / 2;
  const iconY = y + 17;
  const levelX = contentStartX + (iconDataUrl ? iconSize + 8 : 0);
  const scorePalette = scorePaletteByKind[cell?.scoreKind ?? 'none'] ?? scorePaletteByKind.score;
  const scoreDisplay = buildPerformanceScoreDisplay(cell);
  const scoreText = scoreDisplay.text;
  const scoreKindLabel = scoreDisplay.kindLabel;
  const scoreBadgeWidth = scoreText === '-'
    ? 0
    : estimatePerformanceBadgeWidth(scoreText, scoreKindLabel);
  const scoreBadgeX = x + (width - scoreBadgeWidth) / 2;

  return `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#f8f4f8"/>
  <line x1="${x}" y1="${y + height / 2}" x2="${x + width}" y2="${y + height / 2}" stroke="#d9d1d9" stroke-width="1.5"/>
  ${iconDataUrl
    ? `<image href="${escapeXml(iconDataUrl)}" x="${contentStartX}" y="${iconY}" width="${iconSize}" height="${iconSize}" preserveAspectRatio="xMidYMid meet"/>`
    : ''}
  <text x="${levelX}" y="${y + 47}" fill="${levelColor}">
    <tspan class="cellLevel">${escapeXml(level)}</tspan>${floor ? `<tspan dx="8" class="cellFloor">(${escapeXml(floor)}F)</tspan>` : ''}
  </text>
  ${scoreText === '-'
    ? `<text x="${x + width / 2}" y="${y + 102}" text-anchor="middle" class="cellDash">-</text>`
    : `<rect x="${scoreBadgeX}" y="${y + 78}" width="${scoreBadgeWidth}" height="34" rx="6" ry="6" fill="${scorePalette.fill}"/>
       <text x="${x + width / 2}" y="${y + 103}" text-anchor="middle" fill="${scorePalette.text}" class="cellScore">${escapeXml(scoreText)}${scoreKindLabel ? `<tspan dx="6" class="cellScoreKind">${escapeXml(scoreKindLabel)}</tspan>` : ''}</text>`}`;
}

function renderTableGridLines({
  x,
  y,
  keyColumnWidth,
  diffStartX,
  diffColumnWidth,
  tableWidth,
  tableHeaderHeight,
  rowHeight,
  rowCount,
  diffCount,
  color,
  strokeWidth,
}) {
  const verticalLines = Array.from({ length: diffCount - 1 }, (_, index) => {
    const lineX = diffStartX + diffColumnWidth * (index + 1);
    return `<line x1="${lineX}" y1="${y}" x2="${lineX}" y2="${y + tableHeaderHeight + rowHeight * rowCount}" stroke="${color}" stroke-width="${strokeWidth}"/>`;
  }).join('');
  const horizontalLines = Array.from({ length: rowCount }, (_, index) => {
    const lineY = y + tableHeaderHeight + rowHeight * index;
    return `<line x1="${x}" y1="${lineY}" x2="${x + tableWidth}" y2="${lineY}" stroke="${color}" stroke-width="${strokeWidth}"/>`;
  }).join('');
  const keyDivider = `<line x1="${x + keyColumnWidth}" y1="${y}" x2="${x + keyColumnWidth}" y2="${y + tableHeaderHeight + rowHeight * rowCount}" stroke="${color}" stroke-width="${strokeWidth}"/>`;

  return `${keyDivider}${verticalLines}${horizontalLines}`;
}

async function resolvePerformanceCardAssets(song, fetchImpl) {
  const difficultyIconKeys = new Set();

  for (const key of varchiveKeyOrder) {
    for (const difficulty of varchiveDifficultyOrder) {
      const iconInfo = getDifficultyIconInfo(song?.patterns?.[key]?.[difficulty], difficulty);
      if (iconInfo?.iconKey) {
        difficultyIconKeys.add(iconInfo.iconKey);
      }
    }
  }

  const keyBackgroundEntries = await Promise.all(
    Object.entries(keyBackgroundUrls).map(async ([key, url]) => [
      key,
      await fetchAssetDataUrl(url, fetchImpl),
    ])
  );
  const iconEntries = await Promise.all(
    [...difficultyIconKeys].map(async (iconKey) => [
      iconKey,
      await fetchAssetDataUrl(iconAssetUrls[iconKey], fetchImpl),
    ])
  );

  return {
    jacketDataUrl: await fetchJacketDataUrl(song, fetchImpl),
    keyBackgroundDataUrls: Object.fromEntries(keyBackgroundEntries),
    difficultyIconDataUrls: Object.fromEntries(iconEntries),
  };
}

async function fetchJacketDataUrl(song, fetchImpl) {
  const titleId = encodeURIComponent(String(song?.title ?? '').trim());
  if (!titleId) {
    return null;
  }

  return fetchAssetDataUrl(`${varchiveJacketBaseUrl}/${titleId}.jpg`, fetchImpl);
}

async function fetchAssetDataUrl(url, fetchImpl) {
  if (!url) {
    return null;
  }

  if (!assetDataUrlCache.has(url)) {
    assetDataUrlCache.set(url, (async () => {
      const targetFetch = resolveFetch(fetchImpl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), varchiveRequestTimeoutMs);

      try {
        const response = await targetFetch(url, {
          signal: controller.signal,
        });

        if (!response.ok) {
          return null;
        }

        const contentType = response.headers.get('content-type') || guessContentTypeFromUrl(url);
        const buffer = Buffer.from(await response.arrayBuffer());
        return `data:${contentType};base64,${buffer.toString('base64')}`;
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    })());
  }

  return assetDataUrlCache.get(url);
}

function resolveFetch(fetchImpl) {
  const targetFetch = fetchImpl ?? globalThis.fetch;
  if (typeof targetFetch !== 'function') {
    throw new Error('현재 실행 환경에서 fetch를 사용할 수 없다냥.');
  }

  return targetFetch;
}

function guessContentTypeFromUrl(url) {
  if (String(url ?? '').toLowerCase().includes('.png')) {
    return 'image/png';
  }

  return 'image/jpeg';
}

function getDifficultyIconInfo(pattern, difficulty) {
  const level = Number(pattern?.level);
  if (!Number.isFinite(level)) {
    return null;
  }

  if (difficulty === 'SC') {
    if (level <= 5) {
      return { iconKey: 'sc5', textColor: '#df0074' };
    }

    if (level <= 10) {
      return { iconKey: 'sc10', textColor: '#c604e4' };
    }

    return { iconKey: 'sc15', textColor: '#3d66ff' };
  }

  if (level <= 5) {
    return { iconKey: 'yellow', textColor: '#f7b401' };
  }

  if (level <= 10) {
    return { iconKey: 'orange', textColor: '#f95b08' };
  }

  return { iconKey: 'red', textColor: '#f30253' };
}

function getKeyRowPalette(key) {
  if (key === '4B') {
    return ['#00c46a', '#11a7c7'];
  }

  if (key === '5B') {
    return ['#0f5a88', '#73542e'];
  }

  if (key === '6B') {
    return ['#ff9618', '#cf2d24'];
  }

  return ['#4e64d8', '#3e2057'];
}

function getVArchiveDlcAccent(dlcCode) {
  const code = String(dlcCode ?? '').trim().toUpperCase();
  const accentMap = [
    { match: /^(?:VE|VE2|VE3|VE4|VE5|R|RV)$/, badgeFill: '#a10f1e', gridColor: '#c43345' },
    { match: /^(?:VL|VL2|VL3|VL4|VL5)$/, badgeFill: '#1c7c55', gridColor: '#31976d' },
    { match: /^(?:T1|T2|T3|TEK)$/, badgeFill: '#0b7a86', gridColor: '#2d98a3' },
    { match: /^(?:P1|P2|P3|PLI1|PLI2|PLI3)$/, badgeFill: '#c56d00', gridColor: '#da8c28' },
    { match: /^(?:TR|CE|BS)$/, badgeFill: '#7a244d', gridColor: '#a24f75' },
    { match: /^(?:ES|EZ2|ESTI|MAP|NXN|FAL|CP|CY|CHU|BA|ARC|GG|GF|GC|DM|MD|OGK|TQ)$/, badgeFill: '#6b3e88', gridColor: '#8b63a5' },
  ];

  const matched = accentMap.find((entry) => entry.match.test(code));
  if (matched) {
    return {
      badgeFill: matched.badgeFill,
      gridColor: matched.gridColor,
    };
  }

  return {
    badgeFill: '#7b303f',
    gridColor: '#b16070',
  };
}

function normalizeScoreKind(value) {
  const lowered = String(value ?? '').trim().toLowerCase();
  if (!lowered) {
    return 'score';
  }

  if (['perfect', 'maxcombo', 'clear'].includes(lowered)) {
    return lowered;
  }

  return 'score';
}

function formatPerformanceScoreText(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || trimmed === '-') {
    return '-';
  }

  return `${trimmed}%`;
}

function buildPerformanceScoreDisplay(cell) {
  const text = formatPerformanceScoreText(cell?.scoreText);
  return {
    text,
    kindLabel: text !== '-' && cell?.scoreKind === 'maxcombo'
      ? 'MAX'
      : '',
  };
}

function estimatePerformanceBadgeWidth(scoreText, kindLabel = '') {
  const safeScoreText = String(scoreText ?? '').trim();
  const safeKindLabel = String(kindLabel ?? '').trim();

  if (!safeScoreText || safeScoreText === '-') {
    return 0;
  }

  const scoreWidth = safeScoreText.length * 14;
  const labelWidth = safeKindLabel ? safeKindLabel.length * 12 + 10 : 0;
  return Math.max(86, 30 + scoreWidth + labelWidth);
}

function formatGeneratedAt(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${mapped.year}-${mapped.month}-${mapped.day} ${mapped.hour}:${mapped.minute} KST`;
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

let performanceCardRenderContext = {
  keyBackgroundDataUrls: {},
  difficultyIconDataUrls: {},
};
