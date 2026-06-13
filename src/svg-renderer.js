import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

export const bundledArialFontPath = fileURLToPath(new URL('../assets/fonts/Arial.ttf', import.meta.url));
export const bundledArialBoldFontPath = fileURLToPath(new URL('../assets/fonts/Arial-Bold.ttf', import.meta.url));
export const bundledNotoSansCjkKrBoldFontPath = fileURLToPath(new URL('../assets/fonts/NotoSansCJKkr-Bold.otf', import.meta.url));
export const bundledSvgFontFamily = '"Noto Sans CJK KR", Arial';

const bundledFontFiles = [
  bundledArialFontPath,
  bundledArialBoldFontPath,
  bundledNotoSansCjkKrBoldFontPath,
];

export function renderSvgToPng(svg, options = {}) {
  const scale = Number.isFinite(options.scale) && options.scale > 0
    ? options.scale
    : 1;
  const extraFontFiles = Array.isArray(options.fontFiles)
    ? options.fontFiles.filter(Boolean)
    : [];

  return new Resvg(svg, {
    background: options.background,
    font: {
      fontFiles: [...bundledFontFiles, ...extraFontFiles],
      defaultFontFamily: options.defaultFontFamily || 'Arial',
      loadSystemFonts: false,
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
