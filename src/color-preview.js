import {
  bundledSvgFontFamily,
  renderSvgToPng,
} from './svg-renderer.js';

const previewHintPattern = /(색상|색깔|컬러|무슨\s*색|어떤\s*색|보여|미리보기|미리 보기|preview|render|샘플|swatch|칩|color|colour)/i;
const hexColorPattern = /#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;

export function extractHexColorPreviewRequest(input) {
  const text = normalizeWhitespace(input);
  if (!text) {
    return null;
  }

  const matches = [...text.matchAll(hexColorPattern)];
  if (matches.length !== 1) {
    return null;
  }

  const rawHex = matches[0][0];
  const before = text.slice(0, matches[0].index).trim();
  const after = text.slice((matches[0].index ?? 0) + rawHex.length).trim();
  const surroundingText = `${before} ${after}`.trim();

  if (
    surroundingText
    && !previewHintPattern.test(surroundingText)
    && !/^[?!.,:/\\\-_\s]+$/.test(surroundingText)
  ) {
    return null;
  }

  const color = normalizeHexColor(rawHex);
  return color
    ? {
      ...color,
      requestText: text,
    }
    : null;
}

export function normalizeHexColor(input) {
  const raw = String(input ?? '').trim().replace(/^#/, '');
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) {
    return null;
  }

  const expanded = raw.length <= 4
    ? raw.split('').map((character) => character.repeat(2)).join('')
    : raw;
  const upper = expanded.toUpperCase();
  const hasAlpha = upper.length === 8;
  const rgbHex = upper.slice(0, 6);
  const alphaHex = hasAlpha ? upper.slice(6, 8) : 'FF';
  const red = Number.parseInt(rgbHex.slice(0, 2), 16);
  const green = Number.parseInt(rgbHex.slice(2, 4), 16);
  const blue = Number.parseInt(rgbHex.slice(4, 6), 16);
  const alphaByte = Number.parseInt(alphaHex, 16);
  const alpha = alphaByte / 255;
  const hsl = rgbToHsl(red, green, blue);

  return {
    rawHex: `#${raw.toUpperCase()}`,
    normalizedHex: hasAlpha ? `#${rgbHex}${alphaHex}` : `#${rgbHex}`,
    rgbHex: `#${rgbHex}`,
    hasAlpha,
    red,
    green,
    blue,
    alpha,
    alphaByte,
    alphaPercent: Math.round(alpha * 100),
    rgbText: `${red}, ${green}, ${blue}`,
    rgbaText: `${red}, ${green}, ${blue}, ${formatAlphaValue(alpha)}`,
    hslText: `${hsl.h}deg, ${hsl.s}%, ${hsl.l}%`,
  };
}

export async function renderHexColorPreview(input) {
  const color = typeof input === 'string'
    ? normalizeHexColor(input)
    : input;

  if (!color) {
    throw new Error('A valid hex color is required.');
  }

  return renderSvgToPng(renderHexColorPreviewSvg(color));
}

export function renderHexColorPreviewSvg(colorInput) {
  const color = typeof colorInput === 'string'
    ? normalizeHexColor(colorInput)
    : colorInput;

  if (!color) {
    throw new Error('A valid hex color is required.');
  }

  const width = 960;
  const height = 720;
  const panelX = 84;
  const panelY = 74;
  const panelWidth = width - panelX * 2;
  const panelHeight = height - panelY * 2;
  const swatchX = panelX + 48;
  const swatchY = panelY + 112;
  const swatchWidth = panelWidth - 96;
  const swatchHeight = 280;
  const labelColor = getContrastTextColor(color.red, color.green, color.blue);
  const pageTop = mixHexColors(color.rgbHex, '#FFFFFF', 0.68);
  const pageBottom = mixHexColors(color.rgbHex, '#0E1016', 0.78);
  const panelBg = mixHexColors(color.rgbHex, '#151821', 0.82);
  const panelStroke = mixHexColors(color.rgbHex, '#FFFFFF', 0.58);
  const accent = mixHexColors(color.rgbHex, '#FFFFFF', 0.22);
  const muted = mixHexColors(color.rgbHex, '#E9EDF5', 0.76);
  const shadow = mixHexColors(color.rgbHex, '#000000', 0.75);
  const detailTop = swatchY + swatchHeight + 44;
  const detailWidth = Math.floor((swatchWidth - 32) / 2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      text {
        font-family: ${bundledSvgFontFamily};
        letter-spacing: 0;
      }
      .eyebrow {
        fill: ${escapeXml(accent)};
        font-size: 24px;
        font-weight: 800;
      }
      .hex {
        fill: #F6F8FC;
        font-size: 58px;
        font-weight: 900;
      }
      .sub {
        fill: ${escapeXml(muted)};
        font-size: 22px;
        font-weight: 700;
      }
      .detailLabel {
        fill: ${escapeXml(accent)};
        font-size: 18px;
        font-weight: 800;
      }
      .detailValue {
        fill: #F6F8FC;
        font-size: 30px;
        font-weight: 900;
      }
    </style>
    <linearGradient id="pageBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${escapeXml(pageTop)}"/>
      <stop offset="1" stop-color="${escapeXml(pageBottom)}"/>
    </linearGradient>
    <linearGradient id="panelGlow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.24"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <pattern id="checker" width="32" height="32" patternUnits="userSpaceOnUse">
      <rect width="32" height="32" fill="#EEF1F6"/>
      <rect width="16" height="16" fill="#D9DEE8"/>
      <rect x="16" y="16" width="16" height="16" fill="#D9DEE8"/>
    </pattern>
    <filter id="panelShadow" x="-20%" y="-20%" width="140%" height="160%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="24" stdDeviation="30" flood-color="${escapeXml(shadow)}" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#pageBg)"/>
  <g filter="url(#panelShadow)">
    <rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" rx="34" fill="${escapeXml(panelBg)}" stroke="${escapeXml(panelStroke)}" stroke-width="2.5"/>
    <rect x="${panelX + 1}" y="${panelY + 1}" width="${panelWidth - 2}" height="${panelHeight - 2}" rx="33" fill="url(#panelGlow)"/>
  </g>
  <text x="${panelX + 48}" y="${panelY + 56}" class="eyebrow">HEX COLOR PREVIEW</text>
  <text x="${panelX + 48}" y="${panelY + 104}" class="hex">${escapeXml(color.normalizedHex)}</text>
  <text x="${panelX + 48}" y="${panelY + 138}" class="sub">RGB ${escapeXml(color.rgbText)}${color.hasAlpha ? `  |  ALPHA ${color.alphaPercent}%` : ''}</text>
  <g>
    <rect x="${swatchX}" y="${swatchY}" width="${swatchWidth}" height="${swatchHeight}" rx="28" fill="url(#checker)" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="2"/>
    <rect x="${swatchX}" y="${swatchY}" width="${swatchWidth}" height="${swatchHeight}" rx="28" fill="${escapeXml(color.rgbHex)}" fill-opacity="${formatAlphaOpacity(color.alpha)}"/>
    <rect x="${swatchX + 28}" y="${swatchY + 28}" width="${swatchWidth - 56}" height="${swatchHeight - 56}" rx="22" fill="#FFFFFF" fill-opacity="0.10"/>
    <text x="${swatchX + 40}" y="${swatchY + swatchHeight - 42}" font-family="${escapeXml(bundledSvgFontFamily)}" font-size="42" font-weight="900" fill="${labelColor}">${escapeXml(color.normalizedHex)}</text>
  </g>
  ${renderDetailBox({
    x: swatchX,
    y: detailTop,
    width: detailWidth,
    label: 'RGB',
    value: color.rgbText,
    stroke: accent,
  })}
  ${renderDetailBox({
    x: swatchX + detailWidth + 32,
    y: detailTop,
    width: detailWidth,
    label: color.hasAlpha ? 'RGBA' : 'HSL',
    value: color.hasAlpha ? color.rgbaText : color.hslText,
    stroke: accent,
  })}
  ${color.hasAlpha ? renderDetailBox({
    x: swatchX,
    y: detailTop + 116,
    width: swatchWidth,
    label: 'ALPHA',
    value: `${color.alphaPercent}% (${color.alphaByte}/255)`,
    stroke: accent,
  }) : ''}
</svg>`;
}

function renderDetailBox({ x, y, width, label, value, stroke }) {
  return `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="92" rx="24" fill="#0F1219" fill-opacity="0.60" stroke="${escapeXml(stroke)}" stroke-opacity="0.36" stroke-width="1.5"/>
    <text x="${x + 22}" y="${y + 30}" class="detailLabel">${escapeXml(label)}</text>
    <text x="${x + 22}" y="${y + 66}" class="detailValue">${escapeXml(value)}</text>
  </g>`;
}

function mixHexColors(baseHex, targetHex, amount = 0.5) {
  const base = normalizeHexColor(baseHex);
  const target = normalizeHexColor(targetHex);
  const weight = clamp01(amount);

  if (!base || !target) {
    return '#000000';
  }

  const red = Math.round(base.red + (target.red - base.red) * weight);
  const green = Math.round(base.green + (target.green - base.green) * weight);
  const blue = Math.round(base.blue + (target.blue - base.blue) * weight);

  return rgbToHex(red, green, blue);
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0').toUpperCase())
    .join('')}`;
}

function rgbToHsl(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  const lightness = (max + min) / 2;
  const saturation = delta === 0
    ? 0
    : delta / (1 - Math.abs(2 * lightness - 1));

  if (delta !== 0) {
    if (max === r) {
      hue = ((g - b) / delta) % 6;
    } else if (max === g) {
      hue = (b - r) / delta + 2;
    } else {
      hue = (r - g) / delta + 4;
    }
  }

  hue = Math.round(hue * 60);
  if (hue < 0) {
    hue += 360;
  }

  return {
    h: hue,
    s: Math.round(saturation * 100),
    l: Math.round(lightness * 100),
  };
}

function getContrastTextColor(red, green, blue) {
  const luminance = getRelativeLuminance(red, green, blue);
  return luminance > 0.42 ? '#111317' : '#F8FAFC';
}

function getRelativeLuminance(red, green, blue) {
  const channels = [red, green, blue].map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function formatAlphaValue(value) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? `${rounded.toFixed(0)}`
    : `${rounded}`;
}

function formatAlphaOpacity(value) {
  return String(Math.max(0, Math.min(1, value)));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value)));
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
