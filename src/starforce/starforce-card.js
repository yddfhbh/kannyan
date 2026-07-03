import sharp from 'sharp';
import { bundledSvgFontFamily, renderSvgToPng } from '../svg-renderer.js';
import { STARFORCE_DEFAULT_IMAGE_PATH } from './starforce-assets.js';
import { calculateStarforceCost } from './starforce-cost.js';
import { buildStarforceRates } from './starforce-rates.js';

const FRAME_WIDTH = 1439;
const FRAME_HEIGHT = 1093;

export async function renderStarforceCard(session) {
  const event = normalizeEvent(session?.event);
  const currentStar = Number(session?.currentStar ?? 0);
  const maxStar = Number(session?.maxStar ?? 30);
  const level = Number(session?.equipLevel ?? session?.level ?? 0);
  const isMaxed = currentStar >= maxStar;

  const nextCost = isMaxed
    ? 0
    : calculateStarforceCost({
      level,
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

  const overlayBuffer = renderSvgToPng(
    buildOverlaySvg({
      currentStar,
      nextStarText: isMaxed ? 'MAX' : `${formatInteger(currentStar + 1)}성`,
      nextCost,
      successRate: rates.success,
      failRate: rates.fail,
      destroyRate: rates.destroy,
      statusText: String(session?.statusText ?? '').trim(),
      isMaxed,
    }),
    { background: 'transparent' }
  );

  return sharp(session?.imageAssetPath || STARFORCE_DEFAULT_IMAGE_PATH)
    .composite([{ input: overlayBuffer, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

function buildOverlaySvg(view) {
  const bannerText = view.statusText
    ? view.statusText
    : view.isMaxed
      ? '최대 스타포스에 도달했습니다.'
      : '실패 시 별이 유지됩니다.';
  const badgeText = view.currentStar >= 10
    ? `${formatInteger(view.currentStar)}성+`
    : `${formatInteger(view.currentStar)}성`;
  const showWarningIcon = !view.statusText && !view.isMaxed;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" viewBox="0 0 ${FRAME_WIDTH} ${FRAME_HEIGHT}">
  <style>
    text {
      font-family: ${bundledSvgFontFamily};
      letter-spacing: 0;
      paint-order: stroke fill;
      stroke-linejoin: round;
    }
    .tabText {
      fill: #fff7ef;
      stroke: #5a3712;
      stroke-width: 3px;
      font-size: 31px;
      font-weight: 900;
    }
    .bannerBase {
      fill: #fff7ef;
      stroke: #573916;
      stroke-width: 6px;
      font-size: 33px;
      font-weight: 900;
    }
    .bannerAccent {
      fill: #ffdf1f;
      stroke: #6b480b;
      stroke-width: 6px;
      font-size: 33px;
      font-weight: 900;
    }
    .badgeText {
      fill: #fff7ef;
      stroke: #7a3f06;
      stroke-width: 6px;
      font-size: 43px;
      font-weight: 900;
    }
    .starText {
      fill: #fff8ef;
      stroke: #573916;
      stroke-width: 6px;
      font-size: 66px;
      font-weight: 900;
    }
    .arrowText {
      fill: #ffdb26;
      stroke: #734b0d;
      stroke-width: 6px;
      font-size: 72px;
      font-weight: 900;
    }
    .rateLabel {
      fill: #fff8ef;
      stroke: #573916;
      stroke-width: 6px;
      font-size: 38px;
      font-weight: 900;
    }
    .rateValueGold {
      fill: #ffe11f;
      stroke: #72490d;
      stroke-width: 6px;
      font-size: 43px;
      font-weight: 900;
    }
    .rateValue {
      fill: #fff8ef;
      stroke: #573916;
      stroke-width: 6px;
      font-size: 43px;
      font-weight: 900;
    }
    .footerLabel {
      fill: #fff8ef;
      stroke: #573916;
      stroke-width: 6px;
      font-size: 34px;
      font-weight: 900;
    }
    .footerValue {
      fill: #ffe11f;
      stroke: #72490d;
      stroke-width: 6px;
      font-size: 41px;
      font-weight: 900;
    }
  </style>

  ${renderText(262, 151, '주문서', 'tabText', 'middle', 'middle')}
  ${renderText(722, 151, '스타포스 강화', 'tabText', 'middle', 'middle')}
  ${renderText(1184, 151, '장비전송', 'tabText', 'middle', 'middle')}

  ${showWarningIcon ? renderWarningIcon(602, 276) : ''}
  ${renderBanner(view.statusText, bannerText)}

  ${renderText(214, 402, badgeText, 'badgeText', 'middle')}

  ${renderText(811, 463, `${formatInteger(view.currentStar)}성`, 'starText', 'middle')}
  ${renderText(973, 463, '›', 'arrowText', 'middle')}
  ${renderText(1140, 463, view.nextStarText, 'starText', 'middle')}

  ${renderText(742, 618, '성공확률 :', 'rateLabel')}
  ${renderText(1084, 618, formatPercent(view.successRate), 'rateValueGold')}
  ${renderText(742, 710, '실패확률 :', 'rateLabel')}
  ${renderText(1084, 710, formatPercent(view.failRate), 'rateValue')}
  ${renderText(742, 802, '파괴확률 :', 'rateLabel')}
  ${renderText(1084, 802, formatPercent(view.destroyRate), 'rateValue')}

  ${renderText(460, 1036, '필요한 메소 :', 'footerLabel')}
  ${renderText(766, 1036, formatInteger(view.nextCost), 'footerValue')}
</svg>`;
}

function renderBanner(statusText, bannerText) {
  if (statusText) {
    return renderText(720, 292, bannerText, 'bannerBase', 'middle');
  }

  return `
    <text x="740" y="292" text-anchor="end" class="bannerBase">실패 시 </text>
    <text x="742" y="292" text-anchor="start" class="bannerAccent">별이 유지됩니다.</text>
  `;
}

function renderWarningIcon(x, y) {
  return `
    <g transform="translate(${x} ${y})">
      <polygon points="0,0 26,48 -26,48" fill="#ffdf1f" stroke="#70480d" stroke-width="5"/>
      <rect x="-4" y="14" width="8" height="17" rx="3" fill="#6f490b"/>
      <circle cx="0" cy="38" r="4.2" fill="#6f490b"/>
    </g>
  `;
}

function renderText(x, y, text, className, anchor = 'start', baseline = 'alphabetic') {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="${baseline}" class="${className}">${escapeXml(text)}</text>`;
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
