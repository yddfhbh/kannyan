import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

export const tetrioHunDinFontPath = fileURLToPath(new URL('../assets/fonts/HunDIN1451.ttf', import.meta.url));
export const tetrioHunDinFontUrl = pathToFileURL(tetrioHunDinFontPath).href;
export const tetrioFontFamily = '"HUN-din 1451", "HUN", "HUN2", "Noto Sans CJK KR", "Noto Sans KR", "Noto Sans CJK", "Malgun Gothic", "Apple SD Gothic Neo", Arial, sans-serif';
export const tetrioTextStrokeWidth = '0.32px';
export const tetrioPhraseWordSpacing = '0.16em';
export const tetrioTightCommaDx = '-0.42em';

let tetrioHunDinFontDataUriPromise = null;

export function renderTetrioSvgToPng(svg) {
  return new Resvg(svg, {
    font: {
      fontFiles: [tetrioHunDinFontPath],
      defaultFontFamily: 'HUN-din 1451',
      loadSystemFonts: true,
    },
    imageRendering: 0,
    textRendering: 1,
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
  const text = String(value ?? '');
  let markup = '';
  let tightenNext = false;

  for (const char of text) {
    const escaped = escapeXml(char);
    if (char === '.') {
      markup += `<tspan dx="0.01em" font-family="Arial, sans-serif" font-size="0.72em" stroke="none">${escaped}</tspan>`;
      tightenNext = false;
      continue;
    }

    if (tightenNext && /\d/.test(char)) {
      markup += `<tspan dx="${tetrioTightCommaDx}">${escaped}</tspan>`;
      tightenNext = false;
      continue;
    }

    markup += escaped;
    tightenNext = char === ',';
  }

  return markup;
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
