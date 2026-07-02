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

const CARD_WIDTH = 560;
const CARD_HEIGHT = 312;
const CARD_SCALE = 2;
const CARD_FONT_FAMILY = bundledSvgFontFamily;

export async function renderStarforceCard(session) {
  const event = normalizeEvent(session?.event);
  const equipLevel = Number(session?.equipLevel ?? session?.level ?? 0);
  const currentStar = Number(session?.currentStar ?? 0);
  const maxStar = Number(session?.maxStar ?? 30);
  const isMaxed = currentStar >= maxStar;
  const itemIconDataUri = await loadItemIconDataUri(
    session?.itemIconPath || STARFORCE_DEFAULT_ITEM_ICON_PATH
  );

  const nextCost = isMaxed
    ? 0
    : calculateStarforceCost({
      level: equipLevel,
      star: currentStar,
      event,
    });

  const rates = isMaxed
    ? { success: 0, fail: 0, destroy: 0 }
    : buildStarforceRates({
      star: currentStar,
      event,
      chanceTime: false,
    });

  const recentLogs = Array.isArray(session?.recentLogs)
    ? session.recentLogs.slice(-3).reverse()
    : [];
  const latestResult = deriveLatestResultBadge(recentLogs[0] ?? '');

  const status = String(session?.status ?? '').trim().toLowerCase();
  const statusText = String(session?.statusText ?? '').trim();

  const view = {
    equipLevel,
    currentStar,
    nextStarText: isMaxed ? 'MAX' : `${formatInteger(currentStar + 1)}성`,
    mesoUsed: Number(session?.mesoUsed ?? session?.totalMesos ?? 0),
    attempts: Number(session?.attempts ?? session?.attemptCount ?? 0),
    destroyed: Number(session?.destroyed ?? session?.destroyCount ?? 0),
    eventName: event.name,
    nextCost,
    successRate: rates.success,
    failRate: rates.fail,
    destroyRate: rates.destroy,
    itemIconDataUri,
    recentLogs,
    latestResult,
    isMaxed,
    statusBadge: buildStatusBadge(status, statusText, event.name),
  };

  return renderSvgToPng(buildStarforceCardSvg(view), {
    background: 'transparent',
    scale: CARD_SCALE,
  });
}

function buildStarforceCardSvg(view) {
  const resultBadgeMarkup = buildResultBadgeMarkup(view.latestResult);
  const ratesMarkup = buildRatesMarkup(view);
  const recentLogsMarkup = buildRecentLogsMarkup(view.recentLogs);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <defs>
    <style>
      text {
        font-family: ${CARD_FONT_FAMILY};
        letter-spacing: 0;
      }
      .bg {
        fill: #0b1120;
      }
      .bgGlowTop {
        fill: url(#topGlow);
      }
      .bgGlowBottom {
        fill: url(#bottomGlow);
      }
      .outerStroke {
        fill: none;
        stroke: #24324f;
        stroke-width: 2;
      }
      .innerStroke {
        fill: none;
        stroke: #131c30;
        stroke-width: 1;
      }
      .headerBand {
        fill: #10182a;
        stroke: #202d46;
        stroke-width: 1.2;
      }
      .panel {
        fill: #101827;
        stroke: #263754;
        stroke-width: 1.2;
      }
      .panelSoft {
        fill: #0f1625;
        stroke: #202f49;
        stroke-width: 1;
      }
      .panelGlow {
        fill: url(#heroGlow);
        opacity: 0.9;
      }
      .title {
        fill: #f4f7ff;
        font-size: 28px;
        font-weight: 900;
      }
      .subtitle {
        fill: #c8d3f7;
        font-size: 18px;
        font-weight: 760;
      }
      .tinyLabel {
        fill: #8a99ca;
        font-size: 11px;
        font-weight: 760;
      }
      .statusText {
        fill: #eef2ff;
        font-size: 12px;
        font-weight: 820;
      }
      .statusIdle {
        fill: #15233a;
        stroke: #3d5e9d;
        stroke-width: 1;
      }
      .statusEnded {
        fill: #241a39;
        stroke: #6f4cc2;
        stroke-width: 1;
      }
      .statusExpired {
        fill: #2a1d2a;
        stroke: #99617a;
        stroke-width: 1;
      }
      .heroLabel {
        fill: #9aace5;
        font-size: 12px;
        font-weight: 800;
      }
      .heroStar {
        fill: #ffffff;
        font-size: 58px;
        font-weight: 940;
      }
      .heroFlow {
        fill: #d8e0ff;
        font-size: 23px;
        font-weight: 840;
      }
      .sectionLabel {
        fill: #9aa8d8;
        font-size: 11px;
        font-weight: 760;
      }
      .rateLabel {
        fill: #9eabd7;
        font-size: 12px;
        font-weight: 780;
      }
      .rateValue {
        font-size: 18px;
        font-weight: 900;
      }
      .successText {
        fill: #78e2a0;
      }
      .failText {
        fill: #d6dae7;
      }
      .destroyText {
        fill: #ff8796;
      }
      .maxTitle {
        fill: #f4f7ff;
        font-size: 22px;
        font-weight: 920;
      }
      .maxBody {
        fill: #cfd7f5;
        font-size: 14px;
        font-weight: 760;
      }
      .chipLabel {
        fill: #95a4d7;
        font-size: 11px;
        font-weight: 760;
      }
      .chipValue {
        fill: #f5f7ff;
        font-size: 20px;
        font-weight: 920;
      }
      .recentTitle {
        fill: #b3bfeb;
        font-size: 11px;
        font-weight: 820;
      }
      .recentLine {
        fill: #dde4ff;
        font-size: 12px;
        font-weight: 760;
      }
      .resultText {
        fill: #f8fbff;
        font-size: 12px;
        font-weight: 860;
      }
      .resultSuccess {
        fill: #163628;
        stroke: #2f8e59;
        stroke-width: 1;
      }
      .resultFail {
        fill: #362f1d;
        stroke: #9d8441;
        stroke-width: 1;
      }
      .resultDestroy {
        fill: #3b1b24;
        stroke: #b14d61;
        stroke-width: 1;
      }
      .divider {
        stroke: #202d47;
        stroke-width: 1;
      }
      .iconShell {
        fill: #0f1830;
        stroke: #26417b;
        stroke-width: 1.3;
      }
      .iconInset {
        fill: #122141;
      }
      .iconHint {
        fill: #8aa4eb;
        font-size: 10px;
        font-weight: 800;
      }
    </style>
    <linearGradient id="topGlow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#4f46cf" stop-opacity="0.24"/>
      <stop offset="100%" stop-color="#2f6bff" stop-opacity="0.08"/>
    </linearGradient>
    <linearGradient id="bottomGlow" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="#162643" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#0b1120" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="heroGlow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a2441" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#101827" stop-opacity="0.6"/>
    </linearGradient>
    <clipPath id="itemClip">
      <rect x="36" y="96" width="60" height="60" rx="16"/>
    </clipPath>
  </defs>

  <rect x="0" y="0" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="24" class="bg"/>
  <rect x="0" y="0" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="24" class="bgGlowTop"/>
  <rect x="0" y="168" width="${CARD_WIDTH}" height="144" rx="24" class="bgGlowBottom"/>
  <rect x="1.5" y="1.5" width="${CARD_WIDTH - 3}" height="${CARD_HEIGHT - 3}" rx="22.5" class="outerStroke"/>
  <rect x="12" y="12" width="${CARD_WIDTH - 24}" height="${CARD_HEIGHT - 24}" rx="18" class="innerStroke"/>

  <rect x="20" y="20" width="${CARD_WIDTH - 40}" height="56" rx="18" class="headerBand"/>
  <text x="34" y="47" class="title">STARFORCE</text>
  <text x="34" y="66" class="subtitle">${escapeXml(`Lv.${formatInteger(view.equipLevel)} 장비`)}</text>

  <g transform="translate(416 30)">
    <rect x="0" y="0" width="110" height="28" rx="14" class="${escapeXml(view.statusBadge.tone)}"/>
    <text x="55" y="19" text-anchor="middle" class="statusText">${escapeXml(view.statusBadge.label)}</text>
  </g>

  ${resultBadgeMarkup}

  <rect x="24" y="84" width="310" height="128" rx="22" class="panel"/>
  <rect x="24" y="84" width="310" height="128" rx="22" class="panelGlow"/>
  <text x="128" y="110" class="heroLabel">현재 스타</text>
  <text x="128" y="162" class="heroStar">${escapeXml(`★ ${formatInteger(view.currentStar)}`)}</text>
  <text x="128" y="191" class="heroFlow">${escapeXml(`${formatInteger(view.currentStar)}성 → ${view.nextStarText}`)}</text>

  <rect x="34" y="94" width="64" height="64" rx="18" class="iconShell"/>
  <rect x="40" y="100" width="52" height="52" rx="14" class="iconInset"/>
  <image href="${view.itemIconDataUri}" x="43" y="103" width="46" height="46" preserveAspectRatio="xMidYMid meet" clip-path="url(#itemClip)"/>
  <text x="66" y="173" text-anchor="middle" class="iconHint">ITEM</text>

  <rect x="348" y="84" width="188" height="128" rx="22" class="panelSoft"/>
  <text x="366" y="109" class="sectionLabel">${view.isMaxed ? '최대 도달' : '다음 강화 확률'}</text>
  ${ratesMarkup}

  <g transform="translate(24 228)">
    <rect x="0" y="0" width="122" height="56" rx="18" class="panelSoft"/>
    <text x="16" y="20" class="chipLabel">필요 메소</text>
    <text x="16" y="44" class="chipValue">${escapeXml(formatInteger(view.nextCost))}</text>
  </g>
  <g transform="translate(158 228)">
    <rect x="0" y="0" width="122" height="56" rx="18" class="panelSoft"/>
    <text x="16" y="20" class="chipLabel">사용 메소</text>
    <text x="16" y="44" class="chipValue">${escapeXml(formatInteger(view.mesoUsed))}</text>
  </g>
  <g transform="translate(292 228)">
    <rect x="0" y="0" width="110" height="56" rx="18" class="panelSoft"/>
    <text x="16" y="20" class="chipLabel">시도</text>
    <text x="16" y="44" class="chipValue">${escapeXml(`${formatInteger(view.attempts)}회`)}</text>
  </g>
  <g transform="translate(414 228)">
    <rect x="0" y="0" width="122" height="56" rx="18" class="panelSoft"/>
    <text x="16" y="20" class="chipLabel">파괴</text>
    <text x="16" y="44" class="chipValue">${escapeXml(`${formatInteger(view.destroyed)}회`)}</text>
  </g>

  <text x="24" y="302" class="recentTitle">최근 결과</text>
  ${recentLogsMarkup}
</svg>`;
}

function buildRatesMarkup(view) {
  if (view.isMaxed) {
    return `
      <text x="366" y="145" class="maxTitle">MAX STARFORCE</text>
      <text x="366" y="169" class="maxBody">최대 스타포스에 도달했습니다.</text>
      <text x="366" y="192" class="maxBody">더 이상 강화할 수 없습니다.</text>
    `;
  }

  return `
    <line x1="366" y1="120" x2="518" y2="120" class="divider"/>
    <text x="366" y="144" class="rateLabel">성공</text>
    <text x="508" y="144" text-anchor="end" class="rateValue successText">${formatPercent(view.successRate)}</text>

    <line x1="366" y1="156" x2="518" y2="156" class="divider"/>
    <text x="366" y="180" class="rateLabel">실패</text>
    <text x="508" y="180" text-anchor="end" class="rateValue failText">${formatPercent(view.failRate)}</text>

    <line x1="366" y1="192" x2="518" y2="192" class="divider"/>
    <text x="366" y="214" class="rateLabel">파괴</text>
    <text x="508" y="214" text-anchor="end" class="rateValue destroyText">${formatPercent(view.destroyRate)}</text>
  `;
}

function buildRecentLogsMarkup(recentLogs) {
  if (!Array.isArray(recentLogs) || recentLogs.length === 0) {
    return '<text x="92" y="302" class="recentLine">아직 없음</text>';
  }

  return recentLogs
    .slice(0, 3)
    .map((log, index) => {
      const x = 92 + index * 150;
      return `<text x="${x}" y="302" class="recentLine">${escapeXml(truncateText(log, 17))}</text>`;
    })
    .join('');
}

function buildResultBadgeMarkup(latestResult) {
  if (!latestResult) {
    return '';
  }

  return `
    <g transform="translate(206 78)">
      <rect x="0" y="0" width="128" height="28" rx="14" class="${latestResult.tone}"/>
      <text x="64" y="19" text-anchor="middle" class="resultText">${escapeXml(latestResult.label)}</text>
    </g>
  `;
}

function buildStatusBadge(status, statusText, eventName) {
  if (status === 'ended' || statusText.includes('종료')) {
    return {
      label: '세션 종료됨',
      tone: 'statusEnded',
    };
  }

  if (status === 'expired' || statusText.includes('만료')) {
    return {
      label: '세션 만료됨',
      tone: 'statusExpired',
    };
  }

  return {
    label: eventName || '이벤트 없음',
    tone: 'statusIdle',
  };
}

function deriveLatestResultBadge(latestLog) {
  const text = String(latestLog ?? '').trim();
  if (!text) {
    return null;
  }

  if (text.includes('파괴')) {
    return {
      label: '장비 파괴!',
      tone: 'resultDestroy',
    };
  }

  if (text.includes('성공')) {
    return {
      label: '강화 성공!',
      tone: 'resultSuccess',
    };
  }

  if (text.includes('실패')) {
    return {
      label: '강화 실패',
      tone: 'resultFail',
    };
  }

  return null;
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

function truncateText(value, maxLength) {
  const text = String(value ?? '');
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
