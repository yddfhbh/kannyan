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

const cardWidth = 560;
const cardHeight = 340;
const cardScale = 2;
const cardFontFamily = bundledSvgFontFamily;

export async function renderStarforceCard(session) {
  const event = normalizeEvent(session?.event);
  const itemIconDataUri = await loadItemIconDataUri(
    session?.itemIconPath || STARFORCE_DEFAULT_ITEM_ICON_PATH
  );
  const equipLevel = Number(session?.equipLevel ?? session?.level ?? 0);
  const currentStar = Number(session?.currentStar ?? 0);
  const maxStar = Number(session?.maxStar ?? 30);
  const nextCost = currentStar >= maxStar
    ? 0
    : calculateStarforceCost({
      level: equipLevel,
      star: currentStar,
      event,
    });
  const rates = currentStar >= maxStar
    ? { success: 0, fail: 0, destroy: 0 }
    : buildStarforceRates({
      star: currentStar,
      event,
      chanceTime: false,
    });

  const view = {
    equipLevel,
    currentStar,
    nextStar: currentStar >= maxStar ? 'MAX' : currentStar + 1,
    mesoUsed: Number(session?.mesoUsed ?? session?.totalMesos ?? 0),
    attempts: Number(session?.attempts ?? session?.attemptCount ?? 0),
    destroyed: Number(session?.destroyed ?? session?.destroyCount ?? 0),
    eventName: event.name,
    nextCost,
    successRate: rates.success,
    failRate: rates.fail,
    destroyRate: rates.destroy,
    itemIconDataUri,
    statusText: String(session?.statusText ?? '').trim(),
  };

  return renderSvgToPng(buildStarforceCardSvg(view), {
    background: 'transparent',
    scale: cardScale,
  });
}

function buildStarforceCardSvg(view) {
  const nextStarText = typeof view.nextStar === 'number'
    ? `${formatInteger(view.nextStar)}성`
    : String(view.nextStar);
  const statusChip = view.statusText
    ? `<g transform="translate(392 28)">
        <rect x="0" y="0" width="136" height="28" rx="14" fill="#241739" stroke="#5c3ea8" stroke-width="1"/>
        <text x="68" y="19" text-anchor="middle" class="statusText">${escapeXml(view.statusText)}</text>
      </g>`
    : '';
  const destroyLine = view.destroyRate > 0
    ? `<text x="238" y="176" class="bodyValue">파괴 ${formatPercent(view.destroyRate)}</text>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cardWidth}" height="${cardHeight}" viewBox="0 0 ${cardWidth} ${cardHeight}">
  <defs>
    <style>
      text {
        font-family: ${cardFontFamily};
        letter-spacing: 0;
      }
      .title {
        fill: #f6f8ff;
        font-size: 30px;
        font-weight: 900;
      }
      .subtitle {
        fill: #cad2f3;
        font-size: 17px;
        font-weight: 760;
      }
      .label {
        fill: #94a0d8;
        font-size: 13px;
        font-weight: 780;
        text-transform: uppercase;
      }
      .sectionTitle {
        fill: #f2f5ff;
        font-size: 14px;
        font-weight: 860;
      }
      .heroValue {
        fill: #ffffff;
        font-size: 28px;
        font-weight: 920;
      }
      .bodyValue {
        fill: #e9edff;
        font-size: 20px;
        font-weight: 840;
      }
      .statLabel {
        fill: #8f9ac8;
        font-size: 12px;
        font-weight: 760;
      }
      .statValue {
        fill: #f8faff;
        font-size: 23px;
        font-weight: 920;
      }
      .statusText {
        fill: #efe9ff;
        font-size: 12px;
        font-weight: 820;
      }
      .hint {
        fill: #8ea3ff;
        font-size: 12px;
        font-weight: 780;
      }
      .footer {
        fill: #8b95c3;
        font-size: 11px;
        font-weight: 720;
      }
    </style>
    <linearGradient id="bgGradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1020"/>
      <stop offset="55%" stop-color="#10172d"/>
      <stop offset="100%" stop-color="#0a0f1d"/>
    </linearGradient>
    <linearGradient id="glowGradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#233a8b" stop-opacity="0.38"/>
      <stop offset="100%" stop-color="#6c2bd9" stop-opacity="0.10"/>
    </linearGradient>
    <linearGradient id="iconGradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#122246"/>
      <stop offset="100%" stop-color="#17315d"/>
    </linearGradient>
    <linearGradient id="iconGlow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#63b4ff" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#63b4ff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="itemClip">
      <rect x="52" y="106" width="128" height="128" rx="22"/>
    </clipPath>
  </defs>

  <rect x="0" y="0" width="${cardWidth}" height="${cardHeight}" rx="26" fill="url(#bgGradient)"/>
  <rect x="1.5" y="1.5" width="${cardWidth - 3}" height="${cardHeight - 3}" rx="24.5" fill="none" stroke="#283252" stroke-width="3"/>
  <rect x="14" y="14" width="${cardWidth - 28}" height="${cardHeight - 28}" rx="20" fill="none" stroke="#12192e" stroke-width="1"/>
  <circle cx="90" cy="46" r="110" fill="url(#glowGradient)"/>
  <circle cx="490" cy="38" r="92" fill="#20346c" opacity="0.18"/>

  <text x="34" y="52" class="title">STARFORCE</text>
  <text x="34" y="79" class="subtitle">${escapeXml(`${formatInteger(view.equipLevel)}제 장비 강화`)}</text>
  <text x="34" y="102" class="hint">${escapeXml(`이벤트: ${view.eventName}`)}</text>
  ${statusChip}

  <rect x="34" y="122" width="164" height="138" rx="24" fill="url(#iconGradient)" stroke="#2b4478" stroke-width="1.5"/>
  <rect x="44" y="132" width="144" height="118" rx="20" fill="none" stroke="#5f8dff" stroke-opacity="0.28" stroke-width="1"/>
  <rect x="52" y="106" width="96" height="36" rx="18" fill="#4b2bd8" stroke="#7b64f0" stroke-width="1.2"/>
  <text x="100" y="129" text-anchor="middle" class="sectionTitle">${escapeXml(`${formatInteger(view.currentStar)}성`)}</text>
  <image href="${view.itemIconDataUri}" x="62" y="116" width="108" height="108" preserveAspectRatio="xMidYMid meet" clip-path="url(#itemClip)"/>
  <rect x="52" y="106" width="128" height="128" rx="22" fill="url(#iconGlow)"/>

  <rect x="220" y="122" width="306" height="86" rx="22" fill="#11182d" stroke="#273457" stroke-width="1.5"/>
  <text x="238" y="146" class="label">NEXT ATTEMPT</text>
  <text x="238" y="178" class="heroValue">${escapeXml(`${formatInteger(view.currentStar)}성 → ${nextStarText}`)}</text>
  <text x="238" y="206" class="bodyValue">성공 ${formatPercent(view.successRate)}</text>
  <text x="378" y="206" class="bodyValue">실패 ${formatPercent(view.failRate)}</text>
  ${destroyLine}

  <rect x="220" y="222" width="148" height="86" rx="20" fill="#0f1529" stroke="#273457" stroke-width="1.5"/>
  <text x="238" y="246" class="statLabel">다음 강화 메소</text>
  <text x="238" y="282" class="statValue">${escapeXml(formatInteger(view.nextCost))}</text>

  <rect x="378" y="222" width="148" height="86" rx="20" fill="#0f1529" stroke="#273457" stroke-width="1.5"/>
  <text x="396" y="246" class="statLabel">누적 사용 메소</text>
  <text x="396" y="282" class="statValue">${escapeXml(formatInteger(view.mesoUsed))}</text>

  <rect x="34" y="274" width="164" height="34" rx="17" fill="#11182d" stroke="#273457" stroke-width="1.5"/>
  <text x="54" y="296" class="footer">${escapeXml(`시도 ${formatInteger(view.attempts)}회  |  파괴 ${formatInteger(view.destroyed)}회`)}</text>

  <text x="34" y="326" class="footer">실패는 별 유지, 실제 조작은 아래 Discord 버튼으로 진행됩니다.</text>
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
