import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bundledSvgFontFamily,
  renderSvgToPng,
} from '../svg-renderer.js';
import { calculateStarforceCost } from './starforce-cost.js';
import { buildStarforceRates } from './starforce-rates.js';

export const STARFORCE_DEFAULT_ITEM_ICON_PATH =
  fileURLToPath(new URL('../../assets/starforce/default-item-icon.svg', import.meta.url));

const cardScale = 2;
const cardFontFamily = bundledSvgFontFamily;

export async function renderStarforceCard(session) {
  const event = normalizeEvent(session?.event);
  const itemIconDataUri = await loadItemIconDataUri(
    session?.itemIconPath || STARFORCE_DEFAULT_ITEM_ICON_PATH
  );
  const nextCost = session.currentStar >= session.maxStar
    ? 0
    : calculateStarforceCost({
      level: session.equipLevel ?? session.level,
      star: session.currentStar,
      event,
    });
  const rates = session.currentStar >= session.maxStar
    ? { success: 0, fail: 0, destroy: 0 }
    : buildStarforceRates({
      star: session.currentStar,
      event,
      chanceTime: false,
    });

  const view = {
    equipLevel: session.equipLevel ?? session.level,
    currentStar: session.currentStar,
    nextStar: session.currentStar >= session.maxStar ? 'MAX' : session.currentStar + 1,
    mesoUsed: session.mesoUsed ?? session.totalMesos ?? 0,
    attempts: session.attempts ?? session.attemptCount ?? 0,
    destroyed: session.destroyed ?? session.destroyCount ?? 0,
    eventName: event.name,
    nextCost,
    successRate: rates.success,
    failRate: rates.fail,
    destroyRate: rates.destroy,
    itemIconDataUri,
    statusText: session.statusText || '',
  };

  const svg = buildStarforceCardSvg(view);
  return renderSvgToPng(svg, {
    background: 'transparent',
  });
}

function buildStarforceCardSvg(view) {
  const width = 340;
  const height = 292;
  const currentStarText = `${formatInteger(view.currentStar)}성`;
  const nextStarText = typeof view.nextStar === 'number'
    ? `${formatInteger(view.nextStar)}성`
    : String(view.nextStar);
  const failText = formatPercent(view.failRate);
  const destroyText = formatPercent(view.destroyRate);
  const detailLines = [
    `성공확률: ${formatPercent(view.successRate)}`,
    `실패(유지): ${failText}`,
  ];

  if (view.destroyRate > 0) {
    detailLines.push(`파괴확률: ${destroyText}`);
  }

  const detailMarkup = detailLines
    .map((line, index) => (
      `<text x="144" y="${129 + index * 18}" class="statLine">${escapeXml(line)}</text>`
    ))
    .join('');

  const footerLine = view.statusText
    ? escapeXml(view.statusText)
    : escapeXml(`이벤트: ${view.eventName}  |  누적 메소: ${formatInteger(view.mesoUsed)}  |  시도: ${formatInteger(view.attempts)}회  |  파괴: ${formatInteger(view.destroyed)}회`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width * cardScale}" height="${height * cardScale}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      text {
        font-family: ${cardFontFamily};
        letter-spacing: 0;
      }
      .frame {
        fill: #514033;
        stroke: #dce7f0;
        stroke-width: 2;
      }
      .frameInner {
        fill: #6a5647;
        stroke: #231912;
        stroke-width: 1.5;
      }
      .header {
        fill: #ffd35f;
        font-size: 11px;
        font-weight: 900;
      }
      .tabLabel {
        fill: #f4f0eb;
        font-size: 10px;
        font-weight: 900;
      }
      .warning {
        fill: #ffe15d;
        font-size: 10px;
        font-weight: 900;
      }
      .title {
        fill: #ffffff;
        font-size: 13px;
        font-weight: 900;
      }
      .statLine {
        fill: #f5f5f5;
        font-size: 10px;
        font-weight: 800;
      }
      .optionLabel {
        fill: #f2efeb;
        font-size: 9px;
        font-weight: 800;
      }
      .mesoText {
        fill: #fff0c9;
        font-size: 10px;
        font-weight: 900;
      }
      .buttonText {
        fill: #ffffff;
        font-size: 12px;
        font-weight: 900;
      }
      .footer {
        fill: #efe1cf;
        font-size: 8px;
        font-weight: 800;
      }
      .badgeText {
        fill: #fffdf7;
        font-size: 10px;
        font-weight: 900;
      }
    </style>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="26%" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="tabOff" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#5b483f"/>
      <stop offset="100%" stop-color="#372821"/>
    </linearGradient>
    <linearGradient id="tabOn" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#70cdff"/>
      <stop offset="100%" stop-color="#296db8"/>
    </linearGradient>
    <linearGradient id="iconPanel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2c98d2"/>
      <stop offset="100%" stop-color="#155e92"/>
    </linearGradient>
    <linearGradient id="greenButton" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#c1fb61"/>
      <stop offset="100%" stop-color="#74b11f"/>
    </linearGradient>
    <linearGradient id="grayButton" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#e7e8eb"/>
      <stop offset="100%" stop-color="#94979e"/>
    </linearGradient>
    <clipPath id="iconClip">
      <rect x="30" y="101" width="82" height="72" rx="4"/>
    </clipPath>
  </defs>

  <rect x="3" y="3" width="334" height="286" rx="12" class="frame"/>
  <rect x="6" y="6" width="328" height="280" rx="10" class="frameInner"/>
  <rect x="6" y="6" width="328" height="50" rx="10" fill="url(#gloss)"/>

  <text x="170" y="17" text-anchor="middle" class="header">EQUIPMENT ENCHANT</text>

  <rect x="18" y="25" width="96" height="31" rx="5" fill="url(#tabOff)" stroke="#1d1510" stroke-width="1.5"/>
  <rect x="122" y="23" width="96" height="34" rx="5" fill="url(#tabOn)" stroke="#d4eef8" stroke-width="1.5"/>
  <rect x="226" y="25" width="96" height="31" rx="5" fill="url(#tabOff)" stroke="#1d1510" stroke-width="1.5"/>
  <text x="66" y="44" text-anchor="middle" class="tabLabel">주문서</text>
  <text x="170" y="44" text-anchor="middle" class="tabLabel">스타포스 강화</text>
  <text x="274" y="44" text-anchor="middle" class="tabLabel">장비전승</text>

  <rect x="18" y="63" width="304" height="22" rx="4" fill="#694f40" stroke="#8e725e" stroke-width="1"/>
  <polygon points="79,68 85,80 73,80" fill="#ffd74a" stroke="#9a6c00" stroke-width="1"/>
  <rect x="78.2" y="71" width="1.6" height="4.8" fill="#624400"/>
  <circle cx="79" cy="78" r="1" fill="#624400"/>
  <text x="92" y="78" class="warning">실패 시 강화 단계가 유지됩니다.</text>

  <rect x="18" y="88" width="108" height="108" rx="8" fill="url(#iconPanel)" stroke="#daf1fa" stroke-width="2"/>
  <rect x="25" y="95" width="94" height="94" rx="5" fill="#0f6fa5" opacity="0.35"/>
  <rect x="30" y="100" width="82" height="74" rx="4" fill="none" stroke="#f1fbff" stroke-width="2" stroke-dasharray="6 4"/>
  <path d="M25 90 H70 L59 108 H25 Z" fill="#ff8300" stroke="#cc4d00" stroke-width="1"/>
  <path d="M73 90 H109 L101 102 H65 Z" fill="#329dff" stroke="#114b83" stroke-width="1"/>
  <text x="34" y="103" class="badgeText">${escapeXml(currentStarText)}</text>
  <text x="88" y="101" text-anchor="middle" class="badgeText">${escapeXml(`${formatInteger(view.equipLevel)}제`)}</text>
  <image href="${view.itemIconDataUri}" x="36" y="108" width="70" height="58" preserveAspectRatio="xMidYMid meet" clip-path="url(#iconClip)"/>

  <rect x="132" y="88" width="190" height="108" rx="6" fill="#705a4b" stroke="#927766" stroke-width="1"/>
  <text x="144" y="113" class="title">${escapeXml(`${currentStarText}  >  ${nextStarText}`)}</text>
  ${detailMarkup}

  <rect x="18" y="202" width="148" height="26" rx="5" fill="#604b3f" stroke="#7f6858" stroke-width="1"/>
  <rect x="174" y="202" width="148" height="26" rx="5" fill="#604b3f" stroke="#7f6858" stroke-width="1"/>
  <text x="30" y="219" class="optionLabel">스타캐치 해제</text>
  <text x="186" y="219" class="optionLabel">파괴방지</text>
  <rect x="146" y="209" width="12" height="12" rx="1.5" fill="#d9dce2" stroke="#65676e" stroke-width="1"/>
  <rect x="302" y="209" width="12" height="12" rx="1.5" fill="#d9dce2" stroke="#65676e" stroke-width="1"/>

  <rect x="18" y="234" width="304" height="22" rx="5" fill="#5b473a" stroke="#7d6656" stroke-width="1"/>
  <circle cx="32" cy="245" r="5" fill="#ffca38" stroke="#916300" stroke-width="1"/>
  <text x="45" y="249" class="mesoText">필요한 메소 : ${escapeXml(formatInteger(view.nextCost))}</text>

  <rect x="84" y="261" width="90" height="28" rx="6" fill="url(#greenButton)" stroke="#335712" stroke-width="1.5"/>
  <circle cx="109" cy="275" r="8" fill="#f6f7de" stroke="#6f9129" stroke-width="1"/>
  <text x="109" y="278" text-anchor="middle" fill="#68ab20" font-size="14" font-weight="900">+</text>
  <text x="141" y="279" text-anchor="middle" class="buttonText">강화</text>

  <rect x="182" y="261" width="86" height="28" rx="6" fill="url(#grayButton)" stroke="#5f6268" stroke-width="1.5"/>
  <circle cx="199" cy="275" r="7" fill="#f1f1f3" stroke="#80838a" stroke-width="1"/>
  <path d="M202 271 A5 5 0 1 0 202 279" fill="none" stroke="#a4a7ad" stroke-width="2"/>
  <text x="231" y="279" text-anchor="middle" class="buttonText">취소</text>

  <text x="170" y="290" text-anchor="middle" class="footer">${footerLine}</text>
</svg>`;
}

async function loadItemIconDataUri(iconPath) {
  try {
    const extension = path.extname(iconPath).toLowerCase();
    const buffer = await fs.readFile(iconPath);

    if (extension === '.svg') {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buffer.toString('utf8'))}`;
    }

    return `data:${getMimeTypeFromExtension(extension)};base64,${buffer.toString('base64')}`;
  } catch {
    return buildFallbackItemIconDataUri();
  }
}

function normalizeEvent(event) {
  return {
    name: String(event?.name ?? '없음'),
    discount30: Boolean(event?.discount30),
    fiveTenFifteen: Boolean(event?.fiveTenFifteen),
    destroyReduction: Boolean(event?.destroyReduction),
    safeguard: Boolean(event?.safeguard),
    starCatch: Boolean(event?.starCatch),
  };
}

function buildFallbackItemIconDataUri() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <path d="M46 13 L54 13 L58 53 L42 53 Z" fill="#89d0ff" stroke="#eff9ff" stroke-width="2"/>
  <path d="M36 49 L62 49 L66 56 L32 56 Z" fill="#efc44d" stroke="#855b0b" stroke-width="2"/>
  <rect x="43" y="56" width="10" height="20" rx="4" fill="#d34b61" stroke="#6f2633" stroke-width="2"/>
  <rect x="40" y="76" width="16" height="8" rx="3" fill="#cfd4de" stroke="#445061" stroke-width="2"/>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function getMimeTypeFromExtension(extension) {
  switch (extension) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}

function formatInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '0';
  }

  return Math.trunc(number).toLocaleString('ko-KR');
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '0.0%';
  }

  return `${(number * 100).toFixed(1)}%`;
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
