import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

export const tetrioHunDinFontPath = fileURLToPath(new URL('../assets/fonts/HunDIN1451.ttf', import.meta.url));
export const tetrioHunDinFontUrl = pathToFileURL(tetrioHunDinFontPath).href;
export const tetrioFontFamily = '"HUN-din 1451", "HUN", "HUN2", "Noto Sans CJK KR", "Noto Sans KR", "Noto Sans CJK", "Malgun Gothic", "Apple SD Gothic Neo", Arial, sans-serif';
export const tetrioTextStrokeWidth = '0.32px';
export const tetrioPhraseWordSpacing = '0.16em';
export const tetrioTightCommaDx = '-0.10em';
export const tetrioTightTextCommaDx = '-0.12em';
export const tetrioTightILeftDx = '-0.08em';
export const tetrioTightIRightDx = '-0.12em';

let tetrioHunDinFontDataUriPromise = null;

export function renderTetrioSvgToPng(svg, scale = 1) {
  return new Resvg(svg, {
    font: {
      fontFiles: [tetrioHunDinFontPath],
      defaultFontFamily: 'HUN-din 1451',
      loadSystemFonts: true,
    },
    imageRendering: 0,
    textRendering: 1,
    fitTo: scale === 1
      ? undefined
      : {
        mode: 'zoom',
        value: scale,
      },
  }).render().asPng();
}

export function renderTetrioHunDinFontFace(fontSource) {
  const source = typeof fontSource === 'string' && fontSource
    ? fontSource
    : tetrioHunDinFontUrl;

  return `@font-face {
        font-family: "HUN-din 1451";
        src: url("${source}") format("truetype");
        font-weight: 400 900;
        font-style: normal;
      }
      @font-face {
        font-family: "HUN";
        src: url("${source}") format("truetype");
        font-weight: 400 900;
        font-style: normal;
      }
      @font-face {
        font-family: "HUN2";
        src: url("${source}") format("truetype");
        font-weight: 400 900;
        font-style: normal;
      }`;
}

export function renderTetrioTextWeightCss() {
  return `paint-order: stroke fill;
        stroke: rgba(255,255,255,0.36);
        stroke-width: ${tetrioTextStrokeWidth};
        stroke-linejoin: round;`;
}

export function renderTetrioNumericTextMarkup(value) {
  return renderTetrioAdjustedTextMarkup(value, {
    commaDx: tetrioTightCommaDx,
    tightenI: false,
  });
}

export function renderTetrioTextMarkup(value) {
  return renderTetrioAdjustedTextMarkup(value, {
    commaDx: tetrioTightTextCommaDx,
    tightenI: true,
  });
}

function renderTetrioAdjustedTextMarkup(value, options = {}) {
  const text = String(value ?? '');
  const commaDx = options.commaDx ?? tetrioTightCommaDx;
  const tightenI = options.tightenI === true;

  let markup = '';
  let tightenAfterComma = false;
  let tightenAfterI = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const escaped = escapeXml(char);
    const dxValues = [];

    if (tightenAfterComma && char === ' ' && /\d/.test(findNextNonSpace(text, index + 1))) {
      continue;
    }

    if (tightenAfterComma && /\d/.test(char)) {
      dxValues.push(commaDx);
      tightenAfterComma = false;
    } else if (tightenAfterComma && char !== ' ') {
      tightenAfterComma = false;
    }

    if (tightenAfterI && char !== ' ') {
      dxValues.push(tetrioTightIRightDx);
    }
    tightenAfterI = false;

    if (tightenI && char === 'I') {
      dxValues.push(tetrioTightILeftDx);
      tightenAfterI = true;
    }

    const dx = formatCombinedEmDx(dxValues);

    if (dx) {
      markup += `<tspan dx="${dx}">${escaped}</tspan>`;
    } else {
      markup += escaped;
    }

    tightenAfterComma = char === ',';
  }

  return markup;
}

function findNextNonSpace(text, startIndex) {
  for (let index = startIndex; index < text.length; index += 1) {
    if (text[index] !== ' ') {
      return text[index];
    }
  }

  return '';
}

function formatCombinedEmDx(values) {
  const sum = values.reduce((total, value) => total + Number.parseFloat(value), 0);
  if (Math.abs(sum) < 0.001) {
    return '';
  }

  return `${Number(sum.toFixed(3))}em`;
}

export function getTetrioHunDinFontDataUri() {
  tetrioHunDinFontDataUriPromise ??= readTetrioHunDinFontDataUri();
  return tetrioHunDinFontDataUriPromise;
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

async function readTetrioHunDinFontDataUri() {
  const buffer = await readFile(tetrioHunDinFontPath);
  return `data:font/ttf;base64,${buffer.toString('base64')}`;
}
