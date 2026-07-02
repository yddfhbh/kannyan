import sharp from 'sharp';
import { bundledSvgFontFamily, renderSvgToPng } from '../svg-renderer.js';
import { STARFORCE_DEFAULT_IMAGE_PATH } from './starforce-assets.js';
import { calculateStarforceCost } from './starforce-cost.js';
import { buildStarforceRates } from './starforce-rates.js';

const FRAME_WIDTH = 1439;
const FRAME_HEIGHT = 1093;

export async function renderStarforceCard(session) {
  const event = normalizeEvent(session?.event);
  const level = Number(session?.equipLevel ?? session?.level ?? 0);
  const currentStar = Number(session?.currentStar ?? 0);
  const maxStar = Number(session?.maxStar ?? 30);
  const mesoUsed = Number(session?.mesoUsed ?? session?.totalMesos ?? 0);
  const attempts = Number(session?.attempts ?? session?.attemptCount ?? 0);
  const destroyed = Number(session?.destroyed ?? session?.destroyCount ?? 0);
  const recentLogs = Array.isArray(session?.recentLogs)
    ? session.recentLogs.slice(-3).reverse()
    : [];
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

  const overlay = renderSvgToPng(buildOverlaySvg({
    level,
    currentStar,
    nextStarText: isMaxed ? 'MAX' : `${formatInteger(currentStar + 1)}성`,
    maxStar,
    nextCost,
    mesoUsed,
    attempts,
    destroyed,
    successRate: rates.success,
    failRate: rates.fail,
    destroyRate: rates.destroy,
    recentLogs,
    statusText: String(session?.statusText ?? '').trim(),
    eventName: event.name,
    isMaxed,
  }), {
    background: 'transparent',
  });

  return sharp(session?.imageAssetPath || STARFORCE_DEFAULT_IMAGE_PATH)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

function buildOverlaySvg(view) {
  const headerText = view.statusText
    ? view.statusText
    : view.isMaxed
      ? '최대 스타포스에 도달했습니다.'
      : `이벤트: ${view.eventName} · 실패 시 별이 유지됩니다.`;

  const latestLogText = view.recentLogs[0] ?? '최근 결과: 아직 없음';
  const badgeText = view.currentStar >= 10
    ? `${formatInteger(view.currentStar)}성+`
    : `${formatInteger(view.currentStar)}성`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" viewBox="0 0 ${FRAME_WIDTH} ${FRAME_HEIGHT}">
  <style>
    text {
      font-family: ${bundledSvgFontFamily};
      letter-spacing: 0;
    }
    .shadow {
      fill: rgba(34, 18, 0, 0.9);
    }
    .tabText {
      fill: #fff8ef;
      font-size: 42px;
      font-weight: 900;
    }
    .bannerText {
      fill: #fff8ef;
      font-size: 34px;
      font-weight: 900;
    }
    .bannerAccent {
      fill: #ffe01f;
      font-size: 34px;
      font-weight: 900;
    }
    .badgeText {
      fill: #fff8ef;
      font-size: 38px;
      font-weight: 900;
    }
    .rightStar {
      fill: #fff8ef;
      font-size: 64px;
      font-weight: 900;
    }
    .arrowText {
      fill: #ffdb27;
      font-size: 72px;
      font-weight: 900;
    }
    .rateLabel {
      fill: #fff8ef;
      font-size: 42px;
      font-weight: 900;
    }
    .rateValue {
      fill: #ffe01f;
      font-size: 42px;
      font-weight: 900;
    }
    .rateValuePlain {
      fill: #fff8ef;
      font-size: 42px;
      font-weight: 900;
    }
    .footerLabel {
      fill: #fff8ef;
      font-size: 34px;
      font-weight: 900;
    }
    .footerValue {
      fill: #ffe01f;
      font-size: 34px;
      font-weight: 900;
    }
    .smallInfo {
      fill: #f9edd0;
      font-size: 25px;
      font-weight: 700;
    }
    .smallInfoValue {
      fill: #ffe18b;
      font-size: 25px;
      font-weight: 800;
    }
  </style>

  ${renderText(287, 176, '주문서', 'tabText', 'middle')}
  ${renderText(720, 170, '스타포스 강화', 'tabText', 'middle')}
  ${renderText(1162, 176, '장비전송', 'tabText', 'middle')}

  ${renderText(720, 291, headerText, 'bannerText', 'middle', {
    highlight: view.statusText ? null : headerText.includes('실패 시') ? '실패 시 별이 유지됩니다.' : null,
    highlightClass: 'bannerAccent',
  })}

  ${renderText(223, 401, badgeText, 'badgeText', 'middle')}

  ${renderText(808, 472, `${formatInteger(view.currentStar)}성`, 'rightStar', 'middle')}
  ${renderText(972, 475, '›', 'arrowText', 'middle')}
  ${renderText(1130, 472, view.nextStarText, 'rightStar', 'middle')}

  ${renderText(748, 619, '성공확률 :', 'rateLabel')}
  ${renderText(1068, 619, formatPercent(view.successRate), 'rateValue')}
  ${renderText(748, 709, '실패확률 :', 'rateLabel')}
  ${renderText(1068, 709, formatPercent(view.failRate), 'rateValuePlain')}
  ${renderText(748, 799, '파괴확률 :', 'rateLabel')}
  ${renderText(1068, 799, formatPercent(view.destroyRate), 'rateValuePlain')}

  ${renderText(719, 926, `최근 결과 : ${latestLogText}`, 'smallInfo', 'middle')}

  ${renderText(488, 1025, '필요한 메소 :', 'footerLabel')}
  ${renderText(760, 1025, formatInteger(view.nextCost), 'footerValue')}

  ${renderText(250, 1069, `사용 메소 ${formatInteger(view.mesoUsed)}`, 'smallInfo')}
  ${renderText(632, 1069, `시도 ${formatInteger(view.attempts)}회`, 'smallInfo')}
  ${renderText(903, 1069, `파괴 ${formatInteger(view.destroyed)}회`, 'smallInfo')}
  ${renderText(1133, 1069, `최대 ${formatInteger(view.maxStar)}성`, 'smallInfo')}
</svg>`;
}

function renderText(x, y, text, className, anchor = 'start', options = {}) {
  const safeText = escapeXml(text);
  const highlight = options.highlight ? String(options.highlight) : '';
  const highlightClass = options.highlightClass || className;

  if (highlight && text.includes(highlight)) {
    const prefix = text.slice(0, text.indexOf(highlight));
    const suffix = text.slice(text.indexOf(highlight) + highlight.length);
    const safePrefix = escapeXml(prefix);
    const safeHighlight = escapeXml(highlight);
    const safeSuffix = escapeXml(suffix);

    return `
      <text x="${x + 3}" y="${y + 3}" text-anchor="${anchor}" class="shadow ${className}">
        <tspan>${safePrefix}</tspan><tspan class="${highlightClass}">${safeHighlight}</tspan><tspan>${safeSuffix}</tspan>
      </text>
      <text x="${x}" y="${y}" text-anchor="${anchor}" class="${className}">
        <tspan>${safePrefix}</tspan><tspan class="${highlightClass}">${safeHighlight}</tspan><tspan>${safeSuffix}</tspan>
      </text>
    `;
  }

  return `
    <text x="${x + 3}" y="${y + 3}" text-anchor="${anchor}" class="shadow ${className}">${safeText}</text>
    <text x="${x}" y="${y}" text-anchor="${anchor}" class="${className}">${safeText}</text>
  `;
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
