import path from 'node:path';

export const geminiSupportedImageMimeTypes = Object.freeze(new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]));

const mimeByExtension = new Map([
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'], ['.webp', 'image/webp'],
  ['.heic', 'image/heic'], ['.heif', 'image/heif'],
]);

function normalizeMime(value) {
  return String(value ?? '').split(';')[0].trim().toLowerCase();
}

export function inferGeminiImageMimeType(attachment = {}, responseContentType = '') {
  const candidates = [
    normalizeMime(responseContentType),
    normalizeMime(attachment.contentType),
    mimeByExtension.get(path.extname(String(attachment.name ?? '')).toLowerCase()),
  ];
  return candidates.find((mime) => geminiSupportedImageMimeTypes.has(mime)) ?? '';
}

export function detectGeminiImageMimeType(buffer) {
  const bytes = Buffer.from(buffer ?? '');
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') {
    const brand = bytes.toString('ascii', 8, 12).toLowerCase();
    if (brand.includes('heic') || brand.includes('heix') || brand.includes('hevc') || brand.includes('hevx')) return 'image/heic';
  }
  return '';
}

export function isGeminiSupportedImageAttachment(attachment = {}) {
  const mime = inferGeminiImageMimeType(attachment);
  const size = Number(attachment.size);
  return Boolean(mime && attachment.url && (!Number.isFinite(size) || size <= 8 * 1024 * 1024));
}

export function bufferToGeminiImagePart(buffer, contentType = '') {
  const detectedMime = detectGeminiImageMimeType(buffer);
  const declaredMime = normalizeMime(contentType);
  // A stale Discord header must not label JPEG bytes as PNG (or vice versa).
  const mimeType = detectedMime
    || (geminiSupportedImageMimeTypes.has(declaredMime) ? declaredMime : '');
  if (!mimeType) return null;
  return { inline_data: { mime_type: mimeType, data: Buffer.from(buffer).toString('base64') } };
}
