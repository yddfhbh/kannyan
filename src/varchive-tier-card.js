import sharp from 'sharp';
import {
  bundledSvgFontFamily,
  renderSvgToPng,
} from './svg-renderer.js';

const vArchiveBaseUrl = 'https://v-archive.net';
const vArchiveApiBaseUrl = `${vArchiveBaseUrl}/api/v3/archive`;
const vArchiveRequestTimeoutMs = 15_000;
const maxDisplayedSongs = 30;
const vArchiveTierCardRenderScale = 1.5;
const discordSafeImageBudgetBytes = 7_900_000;
const songImageSize = 244;
const tierImageDisplaySize = 160;
const embeddedSongImageSize = Math.round(songImageSize * vArchiveTierCardRenderScale);
const embeddedTierImageSize = Math.round(tierImageDisplaySize * vArchiveTierCardRenderScale);
const embeddedSongCornerRadius = Math.round(18 * (embeddedSongImageSize / songImageSize));
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
    fetchAssetDataUrl(`${vArchiveBaseUrl}/images/tier/${encodeURIComponent(tierCode)}.jpg`, fetchImpl, {
      width: embeddedTierImageSize,
      height: embeddedTierImageSize,
      fit: 'contain',
      format: 'jpeg',
      quality: 88,
    }),
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
          fetchImpl,
          {
            width: embeddedSongImageSize,
            height: embeddedSongImageSize,
            fit: 'cover',
            format: 'jpeg',
            quality: 74,
            roundedCorners: true,
            cornerRadius: embeddedSongCornerRadius,
            background: '#ffffff',
          }
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
  const renderedCard = await renderVArchiveTierCardResult(view);

  return {
    image: renderedCard.buffer,
    imageFormat: renderedCard.format,
    imageContentType: renderedCard.contentType,
    nickname: normalizedNickname,
    button: normalizedButton,
    pageUrl: `${vArchiveBaseUrl}/archive/${encodeURIComponent(normalizedNickname)}/tier/${normalizedButton}`,
    apiUrl: `${vArchiveApiBaseUrl}/${encodeURIComponent(normalizedNickname)}/tier/${normalizedButton}`,
    view,
  };
}

export async function renderVArchiveTierCard(view) {
  const renderedCard = await renderVArchiveTierCardResult(view);
  return renderedCard.buffer;
}

export async function renderVArchiveTierCardResult(view) {
  const layout = getVArchiveTierCardLayout(view);
  const background = await renderSvgToPng(renderVArchiveTierCardBackgroundSvg(view), {
    scale: vArchiveTierCardRenderScale,
  });
  const overlay = await renderSvgMarkupToPngWithSharp(
    renderVArchiveTierCardOverlaySvg(view),
    vArchiveTierCardRenderScale,
    scaleCardCoordinate(layout.viewBoxWidth),
    scaleCardCoordinate(layout.viewBoxHeight)
  );
  const composites = buildVArchiveTierCardImageComposites(view);

  const pngBuffer = await sharp(background)
    .composite([
      ...composites,
      { input: overlay, top: 0, left: 0 },
    ])
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true,
    })
    .toBuffer();

  if (pngBuffer.length <= discordSafeImageBudgetBytes) {
    return {
      buffer: pngBuffer,
      format: 'png',
      contentType: 'image/png',
    };
  }

  const jpegBuffer = await encodeVArchiveTierCardJpeg(pngBuffer);

  return {
    buffer: jpegBuffer,
    format: 'jpeg',
    contentType: 'image/jpeg',
  };
}

async function renderSvgMarkupToPngWithSharp(svg, scale = 1, width, height) {
  return sharp(Buffer.from(svg), {
    density: Math.max(72, Math.round(96 * scale)),
  })
    .resize({
      width: Number.isFinite(width) ? width : null,
      height: Number.isFinite(height) ? height : null,
      fit: 'fill',
    })
    .png()
    .toBuffer();
}

async function encodeVArchiveTierCardJpeg(pngBuffer) {
  const qualitySteps = [95, 93, 91, 89, 87, 85, 83];
  let fallbackBuffer = null;

  for (const quality of qualitySteps) {
    const jpegBuffer = await sharp(pngBuffer)
      .jpeg({
        quality,
        mozjpeg: true,
        chromaSubsampling: '4:4:4',
      })
      .toBuffer();

    fallbackBuffer = jpegBuffer;

    if (jpegBuffer.length <= discordSafeImageBudgetBytes) {
      return jpegBuffer;
    }
  }

  return fallbackBuffer;
}

function getVArchiveTierCardLayout(view) {
  const outerPadding = 42;
  const gap = 20;
  const columns = 5;
  const totalSlots = maxDisplayedSongs;
  const songCardWidth = 244;
  const songMetaHeight = 94;
  const songCardHeight = songImageSize + songMetaHeight;
  const headerHeight = 260;
  const footerHeight = 52;
  const contentWidth = songCardWidth * columns + gap * (columns - 1);
  const viewBoxWidth = contentWidth + outerPadding * 2;
  const rows = Math.max(1, Math.ceil(totalSlots / columns));
  const gridHeight = rows * songCardHeight + Math.max(0, rows - 1) * gap;
  const viewBoxHeight = outerPadding * 2 + headerHeight + 30 + gridHeight + footerHeight;
  const leftHeaderWidth = 900;
  const rightHeaderWidth = contentWidth - leftHeaderWidth - gap;
  const headerY = outerPadding;
  const gridY = headerY + headerHeight + 30;
  const footerY = gridY + gridHeight + 14;
  const palette = getTierPalette(view.tierCode);
  const entries = Array.isArray(view.entries) ? view.entries : [];
  const slots = Array.from({ length: totalSlots }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);

    return {
      rank: index + 1,
      cardX: outerPadding + column * (songCardWidth + gap),
      cardY: gridY + row * (songCardHeight + gap),
    };
  });

  return {
    outerPadding,
    gap,
    columns,
    totalSlots,
    songCardWidth,
    songMetaHeight,
    songCardHeight,
    headerHeight,
    footerHeight,
    contentWidth,
    viewBoxWidth,
    rows,
    gridHeight,
    viewBoxHeight,
    leftHeaderWidth,
    rightHeaderWidth,
    headerY,
    gridY,
    footerY,
    palette,
    entries,
    slots,
  };
}

function scaleCardCoordinate(value) {
  return Math.round(value * vArchiveTierCardRenderScale);
}

function buildVArchiveTierCardImageComposites(view) {
  const composites = [];

  if (view.tierImageDataUrl) {
    composites.push({
      input: dataUrlToBuffer(view.tierImageDataUrl),
      left: scaleCardCoordinate(85),
      top: scaleCardCoordinate(85),
    });
  }

  for (const entry of Array.isArray(view.entries) ? view.entries : []) {
    if (!entry.jacketDataUrl) {
      continue;
    }

    composites.push({
      input: dataUrlToBuffer(entry.jacketDataUrl),
      left: scaleCardCoordinate(entry.cardX),
      top: scaleCardCoordinate(entry.cardY),
    });
  }

  return composites;
}

export function renderVArchiveTierCardBackgroundSvg(view) {
  const {
    outerPadding,
    leftHeaderWidth,
    rightHeaderWidth,
    headerHeight,
    headerY,
    viewBoxWidth,
    viewBoxHeight,
    gridY,
    footerY,
    palette,
    entries,
    songCardWidth,
    songCardHeight,
  } = getVArchiveTierCardLayout(view);

  const songCardBackgrounds = entries
    .map((entry) => renderSongCardBackground(entry, songCardWidth, songCardHeight))
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${viewBoxWidth}" height="${viewBoxHeight}" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}">
  <defs>
    <style>
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
      .songCardBg {
        fill: rgba(255,255,255,0.97);
        stroke: rgba(70, 80, 100, 0.10);
        stroke-width: 1.2;
      }
      .placeholder {
        fill: #dce4ec;
      }
    </style>
  </defs>
  <rect x="0" y="0" width="${viewBoxWidth}" height="${viewBoxHeight}" class="pageBg" />
  <rect x="${outerPadding}" y="${headerY}" width="${leftHeaderWidth}" height="${headerHeight}" rx="28" ry="28" class="panel" />
  <rect x="${outerPadding + leftHeaderWidth + 20}" y="${headerY}" width="${rightHeaderWidth}" height="${headerHeight}" rx="28" ry="28" class="panel" />
  <rect x="${outerPadding + 28}" y="${headerY + 28}" width="190" height="190" rx="26" ry="26" class="heroAccent" />
  <rect x="${outerPadding + 28}" y="${headerY + 28}" width="190" height="190" rx="26" ry="26" class="heroOutline" />
  ${!view.tierImageDataUrl ? `<rect x="85" y="85" width="160" height="160" rx="18" ry="18" class="placeholder" />` : ''}
  <line x1="${outerPadding + 6}" y1="${gridY - 16}" x2="${viewBoxWidth - outerPadding - 6}" y2="${gridY - 16}" class="divider" />
  ${songCardBackgrounds}
  <rect x="0" y="${footerY}" width="1" height="1" fill="transparent" />
</svg>`;
}

export function renderVArchiveTierCardOverlaySvg(view) {
  const {
    outerPadding,
    gap,
    leftHeaderWidth,
    headerY,
    viewBoxWidth,
    viewBoxHeight,
    footerY,
    palette,
    entries,
    songCardWidth,
  } = getVArchiveTierCardLayout(view);

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
    y: headerY + 246,
    className: 'summaryTopSong',
    lineHeight: 17,
  });
  const songCardOverlays = entries
    .map((entry, index) => renderSongCardOverlay({
      entry,
      index,
      width: songCardWidth,
      imageSize: songImageSize,
    }))
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${viewBoxWidth}" height="${viewBoxHeight}" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}">
  <defs>
    <style>
      text {
        font-family: ${bundledSvgFontFamily};
        letter-spacing: 0;
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
  </defs>
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
  <text x="${outerPadding + leftHeaderWidth + gap + 28}" y="${headerY + 220}" class="summaryLabel">BEST SONG</text>
  ${topSongMarkup}
  ${!view.tierImageDataUrl ? `<text x="165" y="170" text-anchor="middle" class="placeholderText">NO TIER</text>` : ''}
  ${songCardOverlays}
  <text x="${outerPadding + 4}" y="${footerY + 20}" class="footer">${escapeXml(`Generated ${view.generatedAtText}`)}</text>
  <text x="${viewBoxWidth - outerPadding - 4}" y="${footerY + 20}" text-anchor="end" class="footer">API from V-ARCHIVE</text>
</svg>`;
}

export function renderVArchiveTierCardSvg(view) {
  const {
    outerPadding,
    gap,
    songCardWidth,
    songCardHeight,
    leftHeaderWidth,
    rightHeaderWidth,
    headerHeight,
    headerY,
    gridY,
    footerY,
    viewBoxWidth,
    viewBoxHeight,
    palette,
    entries,
  } = getVArchiveTierCardLayout(view);

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
    y: headerY + 246,
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
  <text x="${outerPadding + leftHeaderWidth + gap + 28}" y="${headerY + 220}" class="summaryLabel">BEST SONG</text>
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

function renderSongCardBackground(entry, width, cardHeight) {
  return `
  <g>
    <rect x="${entry.cardX}" y="${entry.cardY}" width="${width}" height="${cardHeight}" rx="20" ry="20" class="songCardBg" />
    ${!entry.jacketDataUrl
      ? `<rect x="${entry.cardX}" y="${entry.cardY}" width="${songImageSize}" height="${songImageSize}" rx="18" ry="18" class="placeholder" />`
      : ''}
  </g>`;
}

function renderSongCardOverlay({
  entry,
  index,
  width,
  imageSize,
}) {
  const metaY = entry.cardY + imageSize;
  const titleY = metaY + 28;
  const pointY = metaY + 72;
  const updatedY = metaY + 92;

  return `
  <g>
    <rect x="${entry.cardX + 10}" y="${entry.cardY + 10}" width="28" height="28" rx="8" ry="8" class="rankBadge" />
    <text x="${entry.cardX + 24}" y="${entry.cardY + 30}" text-anchor="middle" class="rankText">${escapeXml(String(entry.rank))}</text>

    ${entry.maxCombo ? renderComboChip(entry.cardX + width - 60, entry.cardY + 12) : ''}

    <rect x="${entry.cardX + 12}" y="${entry.cardY + imageSize - 42}" width="96" height="28" rx="14" ry="14" class="songShade" />
    <text x="${entry.cardX + 60}" y="${entry.cardY + imageSize - 23}" text-anchor="middle" class="scoreText">${escapeXml(entry.scoreText)}</text>

    <rect x="${entry.cardX + width - 88}" y="${entry.cardY + imageSize - 74}" width="76" height="26" rx="13" ry="13" class="patternBadge" />
    <text x="${entry.cardX + width - 50}" y="${entry.cardY + imageSize - 56}" text-anchor="middle" class="patternText">${escapeXml(entry.patternText)}</text>

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
    ${!entry.jacketDataUrl
      ? `<text x="${entry.cardX + imageSize / 2}" y="${entry.cardY + imageSize / 2}" text-anchor="middle" class="placeholderText">NO JACKET</text>`
      : ''}
  </g>`;
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

    ${entry.maxCombo ? renderComboChip(entry.cardX + width - 60, entry.cardY + 12) : ''}

    <rect x="${entry.cardX + 12}" y="${entry.cardY + imageSize - 42}" width="96" height="28" rx="14" ry="14" class="songShade" />
    <text x="${entry.cardX + 60}" y="${entry.cardY + imageSize - 23}" text-anchor="middle" class="scoreText">${escapeXml(entry.scoreText)}</text>

    <rect x="${entry.cardX + width - 88}" y="${entry.cardY + imageSize - 74}" width="76" height="26" rx="13" ry="13" class="patternBadge" />
    <text x="${entry.cardX + width - 50}" y="${entry.cardY + imageSize - 56}" text-anchor="middle" class="patternText">${escapeXml(entry.patternText)}</text>

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
  </g>`;
}

function renderSongImage(entry, index, imageSize) {
  if (entry.jacketDataUrl) {
    return `<image href="${escapeXml(entry.jacketDataUrl)}" x="${entry.cardX}" y="${entry.cardY}" width="${imageSize}" height="${imageSize}" preserveAspectRatio="none" />`;
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

async function fetchAssetDataUrl(url, fetchImpl, options = {}) {
  if (!url) {
    return null;
  }

  const cacheKey = JSON.stringify({
    url,
    width: options.width ?? null,
    height: options.height ?? null,
    fit: options.fit ?? null,
    format: options.format ?? null,
    quality: options.quality ?? null,
    roundedCorners: options.roundedCorners ?? false,
    cornerRadius: options.cornerRadius ?? null,
  });

  if (!assetDataUrlCache.has(cacheKey)) {
    assetDataUrlCache.set(cacheKey, (async () => {
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

          const sourceContentType = response.headers.get('content-type') || guessContentTypeFromUrl(url);
          const sourceBuffer = Buffer.from(await response.arrayBuffer());
          const transformedAsset = await transformAssetForEmbed(sourceBuffer, sourceContentType, options);

          return `data:${transformedAsset.contentType};base64,${transformedAsset.buffer.toString('base64')}`;
        } finally {
          clearTimeout(timeout);
        }
      } catch {
        return null;
      }
    })());
  }

  return assetDataUrlCache.get(cacheKey);
}

async function transformAssetForEmbed(buffer, contentType, options = {}) {
  const imageLikeContent = /^image\//i.test(contentType);
  const hasResizeRequest = Number.isFinite(options.width) || Number.isFinite(options.height);

  if (!imageLikeContent || !hasResizeRequest) {
    return {
      buffer,
      contentType,
    };
  }

  const format = options.format === 'png' ? 'png' : 'jpeg';
  let pipeline = sharp(buffer, {
    failOn: 'none',
  }).resize({
    width: Number.isFinite(options.width) ? options.width : null,
    height: Number.isFinite(options.height) ? options.height : null,
    fit: options.fit === 'contain' ? 'contain' : 'cover',
    position: 'centre',
    background: format === 'png'
      ? { r: 0, g: 0, b: 0, alpha: 0 }
      : { r: 0, g: 0, b: 0, alpha: 1 },
  });

  if (options.roundedCorners && Number.isFinite(options.cornerRadius) && options.cornerRadius > 0) {
    const roundedMask = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="${Number.isFinite(options.width) ? options.width : options.height}" height="${Number.isFinite(options.height) ? options.height : options.width}">
        <rect width="100%" height="100%" rx="${options.cornerRadius}" ry="${options.cornerRadius}" fill="#ffffff"/>
      </svg>
    `);
    pipeline = pipeline
      .ensureAlpha()
      .composite([{ input: roundedMask, blend: 'dest-in' }]);

    if (format !== 'png') {
      pipeline = pipeline.flatten({
        background: options.background ?? '#ffffff',
      });
    }
  }

  if (format === 'png') {
    pipeline = pipeline.png();
    return {
      buffer: await pipeline.toBuffer(),
      contentType: 'image/png',
    };
  }

  pipeline = pipeline.jpeg({
    quality: Number.isFinite(options.quality) ? options.quality : 82,
    mozjpeg: true,
  });

  return {
    buffer: await pipeline.toBuffer(),
    contentType: 'image/jpeg',
  };
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

function dataUrlToBuffer(dataUrl) {
  const value = String(dataUrl ?? '');
  const commaIndex = value.indexOf(',');

  if (commaIndex === -1) {
    throw new Error('Invalid data URL for card asset.');
  }

  return Buffer.from(value.slice(commaIndex + 1), 'base64');
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
