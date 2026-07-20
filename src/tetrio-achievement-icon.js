const achievementIconInnerScale = 0.5714;
const achievementIconInnerOffsetScale = 0.2143;

export function renderTetrioAchievementIconMarkup({
  achievement,
  clipPathId,
  fallbackCornerRadius = 4,
  ringClipPoints,
  size,
  x,
  y,
}) {
  const innerSize = roundSvgNumber(size * achievementIconInnerScale);
  const innerOffset = roundSvgNumber(size * achievementIconInnerOffsetScale);
  const innerHexPoints = getAchievementInnerHexPoints(innerOffset, innerSize);
  const ringMarkup = achievement?.ringPiece
    ? `
      <defs>
        <clipPath id="${clipPathId}">
          <polygon points="${ringClipPoints}"/>
        </clipPath>
      </defs>
      <image href="${achievement.ringPiece}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${clipPathId})"/>
      <image href="${achievement.ringPiece}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${clipPathId})" transform="rotate(180 ${roundSvgNumber(size / 2)} ${roundSvgNumber(size / 2)})"/>`
    : '';

  return `
    <g transform="translate(${roundSvgNumber(x)} ${roundSvgNumber(y)})">
      ${achievement?.frame ? `<image href="${achievement.frame}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>` : `<rect x="0" y="0" width="${size}" height="${size}" rx="${fallbackCornerRadius}" fill="none" stroke="#9cd69e" stroke-width="2"/>`}
      ${ringMarkup}
      <polygon points="${innerHexPoints}" fill="#ffffff" opacity="0.96"/>
      ${achievement?.icon ? `<image href="${achievement.icon}" x="${innerOffset}" y="${innerOffset}" width="${innerSize}" height="${innerSize}" preserveAspectRatio="xMidYMid meet" opacity="0.8"/>` : ''}
      ${achievement?.wreath ? `<image href="${achievement.wreath}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>` : ''}
    </g>`;
}

function getAchievementInnerHexPoints(innerOffset, innerSize) {
  const left = innerOffset;
  const top = innerOffset;
  const width = innerSize;
  const height = innerSize;
  const points = [
    [left + width * 0.26, top + height * 0.08],
    [left + width * 0.74, top + height * 0.08],
    [left + width * 0.9, top + height * 0.5],
    [left + width * 0.74, top + height * 0.92],
    [left + width * 0.26, top + height * 0.92],
    [left + width * 0.1, top + height * 0.5],
  ];

  return points
    .map(([pointX, pointY]) => `${roundSvgNumber(pointX)},${roundSvgNumber(pointY)}`)
    .join(' ');
}

function roundSvgNumber(value) {
  return Number(Number(value).toFixed(2));
}
