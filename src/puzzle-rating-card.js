import {
  bundledSvgFontFamily,
  renderSvgToPng,
} from './svg-renderer.js';

const puzzleRatingCardRenderScale = 1.35;
const puzzleRatingCardFontFamily = bundledSvgFontFamily;

export async function renderPuzzleRatingCard(view) {
  const svg = renderPuzzleRatingCardSvg(view);
  return renderSvgToPng(svg);
}

export function renderPuzzleRatingCardSvg(view) {
  const viewBoxWidth = 760;
  const viewBoxHeight = 180;
  const width = Math.round(viewBoxWidth * puzzleRatingCardRenderScale);
  const height = Math.round(viewBoxHeight * puzzleRatingCardRenderScale);
  const displayName = String(view?.displayName ?? 'Puzzle Player').trim() || 'Puzzle Player';
  const handle = normalizeHandle(view?.handle);
  const rating = formatInteger(view?.rating);
  const rank = formatRank(view?.rank);
  const solvedCount = formatInteger(view?.solvedCount);
  const ratedAttempts = formatInteger(view?.ratedAttempts);
  const avatarText = escapeXml(displayName[0]?.toUpperCase?.() ?? '?');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}">
  <defs>
    <style>
      text {
        font-family: ${puzzleRatingCardFontFamily};
        letter-spacing: 0;
      }
      .cardBg {
        fill: #24282f;
      }
      .outline {
        fill: none;
        stroke: #3b404a;
        stroke-width: 2;
      }
      .accentSoft {
        fill: #3d48a8;
        opacity: 0.28;
      }
      .accent {
        fill: #4fc2c9;
      }
      .name {
        fill: #f6f7fb;
        font-size: 24px;
        font-weight: 900;
      }
      .handle {
        fill: #d7dcf6;
        font-size: 20px;
        font-weight: 820;
      }
      .rule {
        stroke: #5060d5;
        stroke-width: 3;
      }
      .statLabel {
        fill: #d6d9e0;
        font-size: 15px;
        font-weight: 760;
      }
      .statValue {
        fill: #ffffff;
        font-size: 26px;
        font-weight: 920;
      }
      .metaValue {
        fill: #edf0f8;
        font-size: 19px;
        font-weight: 850;
      }
      .metaMuted {
        fill: #bcc4d5;
        font-size: 18px;
        font-weight: 760;
      }
      .footer {
        fill: #9ca6ba;
        font-size: 12px;
        font-weight: 700;
      }
    </style>
    <clipPath id="avatarClip">
      <circle cx="78" cy="90" r="50"/>
    </clipPath>
  </defs>

  <rect x="0" y="0" width="${viewBoxWidth}" height="${viewBoxHeight}" rx="0" class="cardBg"/>
  <polygon points="515,0 760,0 760,180 622,180" class="accent"/>
  <polygon points="505,0 545,0 642,180 602,180" class="accentSoft"/>
  <rect x="1" y="1" width="${viewBoxWidth - 2}" height="${viewBoxHeight - 2}" class="outline"/>

  <circle cx="78" cy="90" r="52" fill="#eef1f8" opacity="0.08"/>
  <circle cx="78" cy="90" r="50" fill="#eff2f8"/>
  ${view?.avatarDataUri
    ? `<image href="${view.avatarDataUri}" x="28" y="40" width="100" height="100" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>`
    : `<text x="78" y="103" text-anchor="middle" font-size="42" font-weight="900" fill="#42506a">${avatarText}</text>`}
  <circle cx="78" cy="90" r="50" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.85"/>

  <text x="150" y="72" class="name">${escapeXml(displayName)}</text>
  <text x="150" y="108" class="handle">${escapeXml(handle)}</text>
  <line x1="150" y1="123" x2="430" y2="123" class="rule"/>

  <text x="150" y="150" class="metaMuted">Puzzle Rating:</text>
  <text x="278" y="150" class="metaValue">${escapeXml(rating)}</text>
  <text x="390" y="150" class="metaMuted">Rank:</text>
  <text x="456" y="150" class="metaValue">#${escapeXml(rank)}</text>

  <text x="555" y="66" class="statLabel">SOLVED / RATED</text>
  <text x="555" y="104" class="statValue">${escapeXml(`${solvedCount} / ${ratedAttempts}`)}</text>
  <text x="555" y="146" class="footer">KANNYAN DAILY PUZZLE</text>
</svg>`;
}

function normalizeHandle(value) {
  const text = String(value ?? '').trim().replace(/^@+/, '');
  return text ? `@${text}` : '@unknown';
}

function formatInteger(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? `${Math.round(number)}`
    : '-';
}

function formatRank(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? `${Math.trunc(number)}`
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
