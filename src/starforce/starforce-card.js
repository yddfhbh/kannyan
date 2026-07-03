import sharp from 'sharp';
import { bundledSvgFontFamily, renderSvgToPng } from '../svg-renderer.js';
import {
  STARFORCE_DEFAULT_IMAGE_PATH,
  STARFORCE_EQUIPMENT_ICON_DESTROYED_PATH,
  STARFORCE_EQUIPMENT_ICON_NORMAL_PATH,
} from './starforce-assets.js';
import { calculateStarforceCost } from './starforce-cost.js';
import {
  buildStarforceRates,
  shouldStarforceDropOnFailure,
} from './starforce-rates.js';

const FRAME_WIDTH = 1439;
const FRAME_HEIGHT = 1093;
const EQUIPMENT_ICON_LAYOUT = Object.freeze({
  left: 226,
  top: 490,
  width: 230,
  height: 230,
});
const STARFORCE_TAB_TEXT_LAYOUT = Object.freeze({
  scroll: { x: 266, y: 171, label: '주문서' },
  starforce: { x: 726, y: 171, label: '스타포스 강화' },
  transfer: { x: 1174, y: 171, label: '장비전송' },
});

export async function renderStarforceCard(session) {
  const event = normalizeEvent(session?.event);
  const currentStar = Number(session?.currentStar ?? 0);
  const maxStar = Number(session?.maxStar ?? 25);
  const level = Number(session?.equipLevel ?? session?.level ?? 0);
  const isMaxed = currentStar >= maxStar;
  const isDestroyed = Boolean(session?.pendingRecovery);

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
      nextStarText: isMaxed ? 'MAX' : formatStarLabel(currentStar + 1),
      nextCost,
      successRate: rates.success,
      failRate: rates.fail,
      destroyRate: rates.destroy,
      statusText: String(session?.statusText ?? '').trim(),
      isMaxed,
    }),
    { background: 'transparent' }
  );

  const equipmentIconBuffer = await renderEquipmentIcon(isDestroyed);

  return sharp(session?.imageAssetPath || STARFORCE_DEFAULT_IMAGE_PATH)
    .composite([
      {
        input: equipmentIconBuffer,
        left: EQUIPMENT_ICON_LAYOUT.left,
        top: EQUIPMENT_ICON_LAYOUT.top,
      },
      {
        input: overlayBuffer,
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
}

async function renderEquipmentIcon(isDestroyed) {
  const sourcePath = isDestroyed
    ? STARFORCE_EQUIPMENT_ICON_DESTROYED_PATH
    : STARFORCE_EQUIPMENT_ICON_NORMAL_PATH;

  return sharp(sourcePath)
    .resize(EQUIPMENT_ICON_LAYOUT.width, EQUIPMENT_ICON_LAYOUT.height, {
      fit: 'contain',
      kernel: sharp.kernel.nearest,
      background: {
        r: 0,
        g: 0,
        b: 0,
        alpha: 0,
      },
    })
    .png()
    .toBuffer();
}

function buildOverlaySvg(view) {
  const canDestroy = Number(view.destroyRate) > 0;
  const failureDrops = shouldStarforceDropOnFailure(view.currentStar);
  const bannerText = view.statusText
    ? view.statusText
    : view.isMaxed
      ? '최대 스타포스에 도달했습니다.'
      : canDestroy
        ? '실패 시 파괴될 수 있습니다.'
        : failureDrops
          ? '실패 시 별이 하락합니다.'
          : '실패 시 별이 유지됩니다.';
  const badgeText = formatStarLabel(view.currentStar);
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
      stroke-width: 6px;
      font-size: 42px;
      font-weight: 900;
    }
    .bannerBase {
      fill: #fff7ef;
      stroke: #573916;
      stroke-width: 6px;
      font-size: 40px;
      font-weight: 900;
    }
    .bannerAccent {
      fill: #ffdf1f;
      stroke: #6b480b;
      stroke-width: 6px;
      font-size: 40px;
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
      stroke-width: 7px;
      font-size: 40px;
      font-weight: 900;
    }
    .footerValue {
      fill: #ffe11f;
      stroke: #72490d;
      stroke-width: 7px;
      font-size: 48px;
      font-weight: 900;
    }
  </style>

  ${renderText(
    STARFORCE_TAB_TEXT_LAYOUT.scroll.x,
    STARFORCE_TAB_TEXT_LAYOUT.scroll.y,
    STARFORCE_TAB_TEXT_LAYOUT.scroll.label,
    'tabText',
    'middle',
    'middle'
  )}
  ${renderText(
    STARFORCE_TAB_TEXT_LAYOUT.starforce.x,
    STARFORCE_TAB_TEXT_LAYOUT.starforce.y,
    STARFORCE_TAB_TEXT_LAYOUT.starforce.label,
    'tabText',
    'middle',
    'middle'
  )}
  ${renderText(
    STARFORCE_TAB_TEXT_LAYOUT.transfer.x,
    STARFORCE_TAB_TEXT_LAYOUT.transfer.y,
    STARFORCE_TAB_TEXT_LAYOUT.transfer.label,
    'tabText',
    'middle',
    'middle'
  )}

  ${showWarningIcon ? renderWarningIcon(546, 255) : ''}
  ${renderBanner(view.statusText, bannerText)}

  ${renderText(204, 410, badgeText, 'badgeText', 'middle')}

  ${renderText(811, 463, formatStarLabel(view.currentStar), 'starText', 'middle')}
  ${renderText(973, 463, '›', 'arrowText', 'middle')}
  ${renderText(1140, 463, view.nextStarText, 'starText', 'middle')}

  ${renderText(742, 618, '성공확률 :', 'rateLabel')}
  ${renderText(1084, 618, formatPercent(view.successRate), 'rateValueGold')}
  ${renderText(742, 710, '실패확률 :', 'rateLabel')}
  ${renderText(1084, 710, formatPercent(view.failRate), 'rateValue')}
  ${renderText(742, 802, '파괴확률 :', 'rateLabel')}
  ${renderText(1084, 802, formatPercent(view.destroyRate), 'rateValue')}

  ${renderText(470, 1014, '필요한 메소 :', 'footerLabel')}
  ${renderText(758, 1014, formatInteger(view.nextCost), 'footerValue')}
</svg>`;
}

function renderBanner(statusText, bannerText) {
  if (statusText) {
    return renderText(672, 296, bannerText, 'bannerBase', 'middle');
  }

  if (bannerText === '실패 시 파괴될 수 있습니다.') {
    return `
      <text x="700" y="296" text-anchor="end" class="bannerBase">실패 시 </text>
      <text x="720" y="296" text-anchor="start" class="bannerAccent">파괴될 수 있습니다.</text>
    `;
  }

  if (bannerText === '실패 시 별이 하락합니다.') {
    return `
      <text x="700" y="296" text-anchor="end" class="bannerBase">실패 시 </text>
      <text x="720" y="296" text-anchor="start" class="bannerAccent">별이 하락합니다.</text>
    `;
  }

  return `
    <text x="700" y="296" text-anchor="end" class="bannerBase">실패 시 </text>
    <text x="720" y="296" text-anchor="start" class="bannerAccent">별이 유지됩니다.</text>
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

function formatStarLabel(star) {
  return `${formatInteger(star)}성`;
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
