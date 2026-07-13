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

  const normalizedSvg = ensureSvgNamespace(svg);

return new Resvg(normalizedSvg, {
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

export function ensureSvgNamespace(svg) {
  const source = Buffer.isBuffer(svg)
    ? svg.toString('utf8')
    : String(svg ?? '');

  const rootMatch = /<svg\b[^>]*>/i.exec(source);

  if (!rootMatch) {
    return source;
  }

  // 기본 SVG 네임스페이스가 이미 있으면 그대로 반환
  if (/\sxmlns\s*=\s*["'][^"']+["']/i.test(rootMatch[0])) {
    return source;
  }

  const patchedRoot = rootMatch[0].replace(
    /<svg\b/i,
    '<svg xmlns="http://www.w3.org/2000/svg"',
  );

  return (
    source.slice(0, rootMatch.index)
    + patchedRoot
    + source.slice(rootMatch.index + rootMatch[0].length)
  );
}