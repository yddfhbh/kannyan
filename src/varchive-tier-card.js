import {
  bundledSvgFontFamily,
  renderSvgToPng,
} from './svg-renderer.js';

const vArchiveBaseUrl = 'https://v-archive.net';
const vArchiveApiBaseUrl = `${vArchiveBaseUrl}/api/v3/archive`;
const vArchiveRequestTimeoutMs = 15_000;
const maxDisplayedSongs = 30;
const assetDataUrlCache = new Map();

const tierPaletteByCode = {
  AM: {
    accent: '#70645c',
    accentSoft: '#efe6df',
    accentStrong: '#61544d',
  },
  BG: {
    accent: '#6d5b86',
    accentSoft: '#eee7f7',
    accentStrong: '#57486d',
  },
  SV: {
    accent: '#537ec6',
    accentSoft: '#e8f0ff',
    accentStrong: '#355692',
  },
  GD: {
    accent: '#bc9545',
    accentSoft: '#fbf2d8',
    accentStrong: '#98742c',
  },
  PL: {
    accent: '#59a7b4',
    accentSoft: '#e4f5f7',
    accentStrong: '#3b7f8a',
  },
  DM: {
    accent: '#b36473',
    accentSoft: '#f7e6ea',
    accentStrong: '#904754',
  },
  MA: {
    accent: '#8f5ac1',
    accentSoft: '#f0e7fb',
    accentStrong: '#6f4298',
  },
};

export async function createVArchiveTierCard(nickname, button, options = {}) {
  const normalizedNickname = normalizeNickname(nickname);
  const normalizedButton = normalizeButton(button);
  const fetchImpl = resolveFetch(options.fetchImpl);
  const tierBoard = await fetchVArchiveTierBoard(normalizedNickname, normalizedButton, { fetchImpl });

  if (!tierBoard?.tierInfo) {
    const error = new Error(`${normalizedButton}버튼 티어 정보가 없다냥.`);
    error.code = 'NO_TIER_DATA';
    error.button = normalizedButton;
    throw error;
  }

  const displayEntries = Array.isArray(tierBoard.userRatingList)
    ? tierBoard.userRatingList.slice(0, maxDisplayedSongs)
    : [];

  const tierCode = tierBoard.tierInfo.tier?.code ?? '';
  const [tierImageDataUrl, songEntries] = await Promise.all([
    fetchAssetDataUrl(`${vArchiveBaseUrl}/images/tier/${encodeURIComponent(tierCode)}.jpg`, fetchImpl),
    Promise.all(
      displayEntries.map(async (entry, index) => ({
        rank: index + 1,
        titleId: entry.title,
        title: entry.name,
        pattern: entry.pattern,
        level: entry.level,
        floorName: entry.floorName,
        score: entry.score,
        rating: entry.rating,
        maxRating: entry.maxRating,
        maxCombo: entry.maxCombo,
        dayAgo: entry.dayAgo,
        jacketDataUrl: await fetchAssetDataUrl(
          `${vArchiveBaseUrl}/s3/images/jackets/${encodeURIComponent(entry.title)}.jpg`,
          fetchImpl
        ),
      }))
    ),
  ]);

  const view = buildVArchiveTierCardView({
    nickname: normalizedNickname,
    button: normalizedButton,
    tierBoard,
    tierImageDataUrl,
    entries: songEntries,
  });
  const image = await renderVArchiveTierCard(view);

  return {
    image,
    nickname: normalizedNickname,
    button: normalizedButton,
    pageUrl: `${vArchiveBaseUrl}/archive/${encodeURIComponent(normalizedNickname)}/tier/${normalizedButton}`,
    apiUrl: `${vArchiveApiBaseUrl}/${encodeURIComponent(normalizedNickname)}/tier/${normalizedButton}`,
    view,
  };
}

export async function renderVArchiveTierCard(view) {
  return renderSvgToPng(renderVArchiveTierCardSvg(view));
}

export function renderVArchiveTierCardSvg(view) {
  const outerPadding = 42;
  const gap = 20;
  const columns = 5;
  const songCardWidth = 244;
  const songImageSize = 244;
  const songMetaHeight = 94;
  const songCardHeight = songImageSize + songMetaHeight;
  const headerHeight = 260;
  const footerHeight = 52;
  const contentWidth = songCardWidth * columns + gap * (columns - 1);
  const viewBoxWidth = contentWidth + outerPadding * 2;
  const rows = Math.max(1, Math.ceil((view.entries?.length ?? 0) / columns));
  const gridHeight = rows * songCardHeight + Math.max(0, rows - 1) * gap;
  const viewBoxHeight = outerPadding * 2 + headerHeight + 30 + gridHeight + footerHeight;
  const leftHeaderWidth = 900;
  const rightHeaderWidth = contentWidth - leftHeaderWidth - gap;
  const headerY = outerPadding;
  const gridY = headerY + headerHeight + 30;
  const footerY = gridY + gridHeight + 14;
  const palette = getTierPalette(view.tierCode);
  const entries = Array.isArray(view.entries) ? view.entries : [];

  const clipDefs = entries
    .map((entry, index) => `<clipPath id="song-clip-${index}"><rect x="${entry.cardX}" y="${entry.cardY}" width="${songImageSize}" height="${songImageSize}" rx="18" ry="18"/></clipPath>`)
    .join('');

  const songCards = entries
    .map((entry, index) => renderSongCard({
      entry,
      index,
      width: songCardWidth,
      imageSize: songImageSize,
      cardHeight: songCardHeight,
      palette,
    }))
    .join('');

  const summaryRows = [
    ['표시 곡수', `${entries.length}곡`],
    ['TOP 50 합계', formatFixed(view.top50sum, 4)],
    ['환산 포인트', formatFixed(view.tierPoint, 4)],
    ['표시 평균', formatFixed(view.displayAverage, 3)],
    ['MAX 콤보', `${view.maxComboCount}/${entries.length}`],
    ['가능 버튼', view.availableButtonsText],
  ];

  const summaryMarkup = summaryRows
    .map((row, index) => {
      const y = headerY + 55 + index * 28;
      return `<text x="${outerPadding + leftHeaderWidth + gap + 28}" y="${y}" class="summaryLabel">${escapeXml(row[0])}</text>
  <text x="${viewBoxWidth - outerPadding - 28}" y="${y}" text-anchor="end" class="summaryValue">${escapeXml(row[1])}</text>`;
    })
    .join('');

  const topSongLines = splitTextLines(view.bestSongTitle, 22, 2);
  const topSongMarkup = renderTextLines({
    lines: topSongLines,
    x: outerPadding + leftHeaderWidth + gap + 28,
    y: headerY + 240,
    className: 'summaryTopSong',
    lineHeight: 17,
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${viewBoxWidth}" height="${viewBoxHeight}" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}">
  <defs>
    <style>
      text {
        font-family: ${bundledSvgFontFamily};
        letter-spacing: 0;
      }
      .pageBg { fill: #f7edef; }
      .panel {
        fill: rgba(255,255,255,0.95);
        stroke: rgba(80, 80, 95, 0.10);
        stroke-width: 1.5;
      }
      .divider {
        stroke: rgba(72, 88, 110, 0.28);
        stroke-width: 2;
      }
      .heroAccent { fill: ${palette.accentSoft}; }
      .heroOutline {
        fill: none;
        stroke: ${palette.accent};
        stroke-width: 2;
      }
      .nickname {
        fill: #11131a;
        font-size: 48px;
        font-weight: 900;
      }
      .subTitle {
        fill: #5f6d77;
        font-size: 18px;
        font-weight: 700;
      }
      .tierName {
        fill: #27313a;
        font-size: 22px;
        font-weight: 800;
      }
      .metaLabel {
        fill: #71808b;
        font-size: 14px;
        font-weight: 700;
      }
      .metaValue {
        fill: #1e2a35;
        font-size: 24px;
        font-weight: 900;
      }
      .metaValueSmall {
        fill: #31404f;
        font-size: 18px;
        font-weight: 800;
      }
      .nextLabel {
        fill: ${palette.accentStrong};
        font-size: 15px;
        font-weight: 800;
      }
      .summaryTitle {
        fill: #23303a;
        font-size: 24px;
        font-weight: 900;
      }
      .summaryLabel {
        fill: #71808b;
        font-size: 14px;
        font-weight: 700;
      }
      .summaryValue {
        fill: #22303b;
        font-size: 16px;
        font-weight: 900;
      }
      .summaryTopSong {
        fill: ${palette.accentStrong};
        font-size: 15px;
        font-weight: 800;
      }
      .songCardBg {
        fill: rgba(255,255,255,0.97);
        stroke: rgba(70, 80, 100, 0.10);
        stroke-width: 1.2;
      }
      .songShade {
        fill: rgba(10, 14, 24, 0.88);
      }
      .rankBadge {
        fill: rgba(12, 16, 28, 0.90);
      }
      .rankText {
        fill: #f8f8fb;
        font-size: 18px;
        font-weight: 900;
      }
      .patternBadge {
        fill: ${palette.accentStrong};
      }
      .patternText {
        fill: #ffffff;
        font-size: 15px;
        font-weight: 900;
      }
      .scoreText {
        fill: #ffffff;
        font-size: 16px;
        font-weight: 900;
      }
      .floorBadge {
        fill: rgba(255,255,255,0.96);
      }
      .floorText {
        fill: ${palette.accentStrong};
        font-size: 15px;
        font-weight: 900;
      }
      .songTitle {
        fill: #171c25;
        font-size: 17px;
        font-weight: 900;
      }
      .songPoint {
        fill: #516272;
        font-size: 16px;
        font-weight: 800;
      }
      .songMeta {
        fill: #7a8794;
        font-size: 12px;
        font-weight: 700;
      }
      .comboChip {
        fill: #ffd665;
      }
      .comboText {
        fill: #6b4d00;
        font-size: 10px;
        font-weight: 900;
      }
      .placeholder {
        fill: #dce4ec;
      }
      .placeholderText {
        fill: #708090;
        font-size: 15px;
        font-weight: 800;
      }
      .footer {
        fill: #72808c;
        font-size: 12px;
        font-weight: 700;
      }
    </style>
    ${clipDefs}
  </defs>

  <rect x="0" y="0" width="${viewBoxWidth}" height="${viewBoxHeight}" class="pageBg" />

  <rect x="${outerPadding}" y="${headerY}" width="${leftHeaderWidth}" height="${headerHeight}" rx="28" ry="28" class="panel" />
  <rect x="${outerPadding + leftHeaderWidth + gap}" y="${headerY}" width="${rightHeaderWidth}" height="${headerHeight}" rx="28" ry="28" class="panel" />

  <rect x="${outerPadding + 28}" y="${headerY + 28}" width="190" height="190" rx="26" ry="26" class="heroAccent" />
  <rect x="${outerPadding + 28}" y="${headerY + 28}" width="190" height="190" rx="26" ry="26" class="heroOutline" />
  ${renderTierImage(view.tierImageDataUrl, outerPadding + 43, headerY + 43, 160, 160)}

  <text x="${outerPadding + 248}" y="${headerY + 80}" class="nickname">${escapeXml(view.nickname.toUpperCase())}</text>
  <text x="${outerPadding + 248}" y="${headerY + 116}" class="subTitle">${escapeXml(`${view.button} BUTTON TIER`)}</text>
  <text x="${outerPadding + 248}" y="${headerY + 170}" class="tierName">${escapeXml(view.tierName)}</text>

  <text x="${outerPadding + 248}" y="${headerY + 206}" class="metaLabel">다음 티어</text>
  <text x="${outerPadding + 328}" y="${headerY + 206}" class="nextLabel">${escapeXml(view.nextTierText)}</text>

  <text x="${outerPadding + leftHeaderWidth - 28}" y="${headerY + 78}" text-anchor="end" class="metaLabel">TOP 50 합계</text>
  <text x="${outerPadding + leftHeaderWidth - 28}" y="${headerY + 108}" text-anchor="end" class="metaValue">${escapeXml(formatFixed(view.top50sum, 4))}</text>

  <text x="${outerPadding + leftHeaderWidth - 28}" y="${headerY + 150}" text-anchor="end" class="metaLabel">환산 포인트</text>
  <text x="${outerPadding + leftHeaderWidth - 28}" y="${headerY + 180}" text-anchor="end" class="metaValue">${escapeXml(formatFixed(view.tierPoint, 4))}</text>

  <text x="${outerPadding + leftHeaderWidth - 28}" y="${headerY + 218}" text-anchor="end" class="metaLabel">표시 평균 포인트</text>
  <text x="${outerPadding + leftHeaderWidth - 28}" y="${headerY + 242}" text-anchor="end" class="metaValueSmall">${escapeXml(formatFixed(view.displayAverage, 3))}</text>

  <text x="${outerPadding + leftHeaderWidth + gap + 28}" y="${headerY + 34}" class="summaryTitle">SUMMARY</text>
  ${summaryMarkup}
  <text x="${outerPadding + leftHeaderWidth + gap + 28}" y="${headerY + 202}" class="summaryLabel">BEST SONG</text>
  ${topSongMarkup}

  <line x1="${outerPadding + 6}" y1="${gridY - 16}" x2="${viewBoxWidth - outerPadding - 6}" y2="${gridY - 16}" class="divider" />

  ${songCards}

  <text x="${outerPadding + 4}" y="${footerY + 20}" class="footer">${escapeXml(`Generated ${view.generatedAtText}`)}</text>
  <text x="${viewBoxWidth - outerPadding - 4}" y="${footerY + 20}" text-anchor="end" class="footer">API from V-ARCHIVE</text>
</svg>`;
}

export async function fetchVArchiveTierBoard(nickname, button, options = {}) {
  const normalizedNickname = normalizeNickname(nickname);
  const normalizedButton = normalizeButton(button);
  const fetchImpl = resolveFetch(options.fetchImpl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), vArchiveRequestTimeoutMs);

  try {
    const response = await fetchImpl(
      `${vArchiveApiBaseUrl}/${encodeURIComponent(normalizedNickname)}/tier/${normalizedButton}`,
      {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
        },
      }
    );

    const payload = await parseJsonResponse(response);

    if (!response.ok || payload?.success === false) {
      const error = new Error(payload?.message || `${normalizedNickname} 티어 정보를 찾지 못했다냥.`);
      error.status = response.status;
      error.code = payload?.errorCode ?? 'VARCHIVE_FETCH_FAILED';
      error.payload = payload;
      throw error;
    }

    return payload.tierBoard;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('V-ARCHIVE 응답이 너무 오래 걸린다냥.');
      timeoutError.code = 'VARCHIVE_TIMEOUT';
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildVArchiveTierCardView({
  nickname,
  button,
  tierBoard,
  tierImageDataUrl,
  entries,
}) {
  const displayEntries = Array.isArray(entries) ? entries : [];
  const palette = getTierPalette(tierBoard.tierInfo.tier?.code);
  const displayAverage = displayEntries.length > 0
    ? displayEntries.reduce((sum, entry) => sum + Number(entry.rating || 0), 0) / displayEntries.length
    : 0;
  const maxComboCount = displayEntries.filter((entry) => entry.maxCombo).length;
  const nextRating = Number(tierBoard.tierInfo.tier?.next?.rating);
  const tierPoint = Number(tierBoard.tierInfo.userRatingConversion);
  const ratingGap = Number.isFinite(nextRating) ? Math.max(0, nextRating - tierPoint) : null;
  const availableButtons = Array.isArray(tierBoard.tierButtons) ? tierBoard.tierButtons : [button];

  return {
    nickname,
    button,
    palette,
    tierCode: tierBoard.tierInfo.tier?.code ?? '',
    tierName: tierBoard.tierInfo.tier?.name ?? 'Unknown Tier',
    tierImageDataUrl,
    top50sum: Number(tierBoard.tierInfo.userRating),
    tierPoint,
    displayAverage,
    maxComboCount,
    bestSongTitle: displayEntries[0]?.title ?? '기록 없음',
    availableButtonsText: availableButtons.map((value) => `${value}B`).join(', '),
    nextTierText: tierBoard.tierInfo.tier?.next
      ? `${tierBoard.tierInfo.tier.next.name}${ratingGap !== null ? ` · +${formatFixed(ratingGap, 4)}` : ''}`
      : '최상위 티어',
    generatedAtText: formatGeneratedAt(new Date().toISOString()),
    entries: displayEntries.map((entry, index) => {
      const column = index % 5;
      const row = Math.floor(index / 5);
      const cardX = 42 + column * (244 + 20);
      const cardY = 42 + 260 + 30 + row * (244 + 94 + 20);

      return {
        ...entry,
        cardX,
        cardY,
        scoreText: `${formatFixed(entry.score, 2)}%`,
        pointText: formatFixed(entry.rating, 3),
        maxRatingText: formatFixed(entry.maxRating, 1),
        patternText: `${entry.pattern ?? '-'} ${entry.level ?? '-'}`,
        floorText: entry.floorName ?? '-',
        updatedText: formatDayAgo(entry.dayAgo),
        titleLines: splitTextLines(entry.title, 20, 2),
      };
    }),
  };
}

function renderSongCard({ entry, index, width, imageSize, cardHeight, palette }) {
  const metaY = entry.cardY + imageSize;
  const titleY = metaY + 28;
  const pointY = metaY + 72;
  const updatedY = metaY + 92;

  return `
  <g>
    <rect x="${entry.cardX}" y="${entry.cardY}" width="${width}" height="${cardHeight}" rx="20" ry="20" class="songCardBg" />
    ${renderSongImage(entry, index, imageSize)}
    <rect x="${entry.cardX + 10}" y="${entry.cardY + 10}" width="28" height="28" rx="8" ry="8" class="rankBadge" />
    <text x="${entry.cardX + 24}" y="${entry.cardY + 30}" text-anchor="middle" class="rankText">${escapeXml(String(entry.rank))}</text>

    <rect x="${entry.cardX + width - 82}" y="${entry.cardY + 14}" width="68" height="26" rx="13" ry="13" class="patternBadge" />
    <text x="${entry.cardX + width - 48}" y="${entry.cardY + 32}" text-anchor="middle" class="patternText">${escapeXml(entry.patternText)}</text>

    <rect x="${entry.cardX + 12}" y="${entry.cardY + imageSize - 42}" width="96" height="28" rx="14" ry="14" class="songShade" />
    <text x="${entry.cardX + 60}" y="${entry.cardY + imageSize - 23}" text-anchor="middle" class="scoreText">${escapeXml(entry.scoreText)}</text>

    <rect x="${entry.cardX + width - 88}" y="${entry.cardY + imageSize - 42}" width="76" height="28" rx="14" ry="14" class="floorBadge" />
    <text x="${entry.cardX + width - 50}" y="${entry.cardY + imageSize - 23}" text-anchor="middle" class="floorText">${escapeXml(entry.floorText)}</text>

    ${renderTextLines({
      lines: entry.titleLines,
      x: entry.cardX + 12,
      y: titleY,
      className: 'songTitle',
      lineHeight: 18,
    })}

    <text x="${entry.cardX + 12}" y="${pointY}" class="songPoint">${escapeXml(`${entry.pointText} / ${entry.maxRatingText}`)}</text>
    <text x="${entry.cardX + width - 12}" y="${pointY}" text-anchor="end" class="songMeta">${escapeXml(entry.updatedText)}</text>
    <text x="${entry.cardX + 12}" y="${updatedY}" class="songMeta">${escapeXml(`title ${entry.titleId}`)}</text>
    ${entry.maxCombo ? renderComboChip(entry.cardX + width - 60, metaY + 12) : ''}
  </g>`;
}

function renderSongImage(entry, index, imageSize) {
  if (entry.jacketDataUrl) {
    return `<image href="${escapeXml(entry.jacketDataUrl)}" x="${entry.cardX}" y="${entry.cardY}" width="${imageSize}" height="${imageSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#song-clip-${index})" />`;
  }

  return `
    <rect x="${entry.cardX}" y="${entry.cardY}" width="${imageSize}" height="${imageSize}" rx="18" ry="18" class="placeholder" />
    <text x="${entry.cardX + imageSize / 2}" y="${entry.cardY + imageSize / 2}" text-anchor="middle" class="placeholderText">NO JACKET</text>`;
}

function renderTierImage(dataUrl, x, y, width, height) {
  if (dataUrl) {
    return `<image href="${escapeXml(dataUrl)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" />`;
  }

  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" ry="18" class="placeholder" />
    <text x="${x + width / 2}" y="${y + height / 2}" text-anchor="middle" class="placeholderText">NO TIER</text>`;
}

function renderComboChip(x, y) {
  return `<rect x="${x}" y="${y}" width="48" height="18" rx="9" ry="9" class="comboChip" />
  <text x="${x + 24}" y="${y + 13}" text-anchor="middle" class="comboText">MAX</text>`;
}

function renderTextLines({
  lines,
  x,
  y,
  className,
  lineHeight,
}) {
  const safeLines = Array.isArray(lines) && lines.length > 0 ? lines : ['-'];

  return `<text x="${x}" y="${y}" class="${className}">${safeLines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join('')}</text>`;
}

function splitTextLines(value, maxCharactersPerLine, maxLines) {
  const text = String(value ?? '').trim();
  if (!text) {
    return ['-'];
  }

  const lines = [];
  let remaining = text;

  while (remaining && lines.length < maxLines) {
    if (remaining.length <= maxCharactersPerLine) {
      lines.push(remaining);
      remaining = '';
      break;
    }

    let breakIndex = remaining.lastIndexOf(' ', maxCharactersPerLine);
    if (breakIndex <= 0) {
      breakIndex = maxCharactersPerLine;
    }

    lines.push(remaining.slice(0, breakIndex).trim());
    remaining = remaining.slice(breakIndex).trimStart();
  }

  if (remaining) {
    const lastLineIndex = Math.max(0, lines.length - 1);
    lines[lastLineIndex] = truncateText(
      `${lines[lastLineIndex]} ${remaining}`.trim(),
      maxCharactersPerLine
    );
  }

  return lines.filter(Boolean);
}

function truncateText(value, maxLength) {
  const text = String(value ?? '');
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

async function fetchAssetDataUrl(url, fetchImpl) {
  if (!url) {
    return null;
  }

  if (!assetDataUrlCache.has(url)) {
    assetDataUrlCache.set(url, (async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), vArchiveRequestTimeoutMs);

        try {
          const response = await fetchImpl(url, {
            signal: controller.signal,
          });

          if (!response.ok) {
            return null;
          }

          const contentType = response.headers.get('content-type') || guessContentTypeFromUrl(url);
          const buffer = Buffer.from(await response.arrayBuffer());
          return `data:${contentType};base64,${buffer.toString('base64')}`;
        } finally {
          clearTimeout(timeout);
        }
      } catch {
        return null;
      }
    })());
  }

  return assetDataUrlCache.get(url);
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function normalizeNickname(value) {
  const nickname = String(value ?? '').trim();
  if (!nickname) {
    const error = new Error('V-ARCHIVE 닉네임을 입력해달라냥.');
    error.code = 'INVALID_NICKNAME';
    throw error;
  }

  if (nickname.length > 40) {
    const error = new Error('닉네임이 너무 길다냥.');
    error.code = 'INVALID_NICKNAME';
    throw error;
  }

  return nickname;
}

function normalizeButton(value) {
  const numericButton = Number(value);
  if ([4, 5, 6, 8].includes(numericButton)) {
    return numericButton;
  }

  const error = new Error('버튼은 4, 5, 6, 8 중에서 골라달라냥.');
  error.code = 'INVALID_BUTTON';
  throw error;
}

function resolveFetch(fetchImpl) {
  const targetFetch = fetchImpl ?? globalThis.fetch;
  if (typeof targetFetch !== 'function') {
    throw new Error('현재 실행 환경에서 fetch를 사용할 수 없다냥.');
  }

  return targetFetch;
}

function guessContentTypeFromUrl(url) {
  if (String(url).toLowerCase().endsWith('.jpg') || String(url).toLowerCase().endsWith('.jpeg')) {
    return 'image/jpeg';
  }

  if (String(url).toLowerCase().endsWith('.png')) {
    return 'image/png';
  }

  return 'application/octet-stream';
}

function formatGeneratedAt(value) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${mapped.year}-${mapped.month}-${mapped.day} ${mapped.hour}:${mapped.minute} KST`;
}

function formatDayAgo(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return 'recent';
  }

  if (numericValue === 0) {
    return 'today';
  }

  if (numericValue === 1) {
    return '1 day ago';
  }

  return `${numericValue} days ago`;
}

function getTierPalette(code) {
  return tierPaletteByCode[code] ?? {
    accent: '#64748b',
    accentSoft: '#edf2f7',
    accentStrong: '#475569',
  };
}

function formatFixed(value, digits) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? numericValue.toFixed(digits)
    : '-';
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
