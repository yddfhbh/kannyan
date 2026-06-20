function clampInt(value, min, max) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function makeRegion(label, left, top, width, height, imageWidth, imageHeight, targetWidth) {
  const safeLeft = clampInt(left, 0, imageWidth - 1);
  const safeTop = clampInt(top, 0, imageHeight - 1);
  const safeRight = clampInt(left + width, safeLeft + 1, imageWidth);
  const safeBottom = clampInt(top + height, safeTop + 1, imageHeight);

  return {
    label,
    left: safeLeft,
    top: safeTop,
    width: Math.max(1, safeRight - safeLeft),
    height: Math.max(1, safeBottom - safeTop),
    targetWidth,
  };
}

export function getChessOrientationProbeRegions(width, height) {
  const imageWidth = Math.max(1, Math.floor(Number(width) || 1));
  const imageHeight = Math.max(1, Math.floor(Number(height) || 1));

  const edgeH = Math.max(36, Math.round(imageHeight * 0.18));
  const edgeW = Math.max(36, Math.round(imageWidth * 0.18));
  const cornerW = Math.max(60, Math.round(imageWidth * 0.28));
  const cornerH = Math.max(60, Math.round(imageHeight * 0.28));

  return [
    makeRegion('whole image, locate the chessboard coordinate labels', 0, 0, imageWidth, imageHeight, imageWidth, imageHeight, 1000),

    makeRegion('top edge labels', 0, 0, imageWidth, edgeH, imageWidth, imageHeight, 900),
    makeRegion('bottom edge labels', 0, imageHeight - edgeH, imageWidth, edgeH, imageWidth, imageHeight, 900),
    makeRegion('left edge labels', 0, 0, edgeW, imageHeight, imageWidth, imageHeight, 500),
    makeRegion('right edge labels', imageWidth - edgeW, 0, edgeW, imageHeight, imageWidth, imageHeight, 500),

    makeRegion('top-left corner label', 0, 0, cornerW, cornerH, imageWidth, imageHeight, 420),
    makeRegion('top-right corner label', imageWidth - cornerW, 0, cornerW, cornerH, imageWidth, imageHeight, 420),
    makeRegion('bottom-left corner label', 0, imageHeight - cornerH, cornerW, cornerH, imageWidth, imageHeight, 420),
    makeRegion('bottom-right corner label', imageWidth - cornerW, imageHeight - cornerH, cornerW, cornerH, imageWidth, imageHeight, 420),
  ];
}

function normalizeOrientation(value) {
  const text = String(value ?? '').trim().toLowerCase();

  if (text === 'w' || text === 'white') return 'w';
  if (text === 'b' || text === 'black') return 'b';

  return '';
}

function normalizeFileLabel(value) {
  const text = String(value ?? '').trim().toLowerCase();

  if (/^[a-h]$/.test(text)) {
    return text;
  }

  const squareMatch = text.match(/\b([a-h])[1-8]\b/);
  if (squareMatch) {
    return squareMatch[1];
  }

  const fileMatch = text.match(/\bfile\s*[:=]?\s*([a-h])\b/);
  if (fileMatch) {
    return fileMatch[1];
  }

  return '';
}

function normalizeRankLabel(value) {
  const text = String(value ?? '').trim().toLowerCase();

  if (/^[1-8]$/.test(text)) {
    return text;
  }

  const squareMatch = text.match(/\b[a-h]([1-8])\b/);
  if (squareMatch) {
    return squareMatch[1];
  }

  const rankMatch = text.match(/\brank\s*[:=]?\s*([1-8])\b/);
  if (rankMatch) {
    return rankMatch[1];
  }

  return '';
}

function firstLabel(parsed, names, normalizer) {
  for (const name of names) {
    const value = parsed?.[name];

    if (Array.isArray(value)) {
      for (const item of value) {
        const normalized = normalizer(item);
        if (normalized) return normalized;
      }
      continue;
    }

    const normalized = normalizer(value);
    if (normalized) return normalized;
  }

  return '';
}

function vote(scores, orientation, weight = 1) {
  if (orientation === 'w' || orientation === 'b') {
    scores[orientation] += weight;
  }
}

export function inferChessBoardOrientation(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const explicit = normalizeOrientation(parsed.orientation);

  const bottomLeftFile = firstLabel(parsed, [
    'bottomLeftFile',
    'bottom_left_file',
    'bottomLeft',
    'bottom_left',
    'bottomLeftSquare',
    'bottom_left_square',
  ], normalizeFileLabel);

  const bottomRightFile = firstLabel(parsed, [
    'bottomRightFile',
    'bottom_right_file',
    'bottomRight',
    'bottom_right',
    'bottomRightSquare',
    'bottom_right_square',
  ], normalizeFileLabel);

  const topLeftFile = firstLabel(parsed, [
    'topLeftFile',
    'top_left_file',
    'topLeft',
    'top_left',
    'topLeftSquare',
    'top_left_square',
  ], normalizeFileLabel);

  const topRightFile = firstLabel(parsed, [
    'topRightFile',
    'top_right_file',
    'topRight',
    'top_right',
    'topRightSquare',
    'top_right_square',
  ], normalizeFileLabel);

  const bottomLeftRank = firstLabel(parsed, [
    'bottomLeftRank',
    'bottom_left_rank',
    'bottomLeft',
    'bottom_left',
    'bottomLeftSquare',
    'bottom_left_square',
  ], normalizeRankLabel);

  const bottomRightRank = firstLabel(parsed, [
    'bottomRightRank',
    'bottom_right_rank',
    'bottomRight',
    'bottom_right',
    'bottomRightSquare',
    'bottom_right_square',
  ], normalizeRankLabel);

  const topLeftRank = firstLabel(parsed, [
    'topLeftRank',
    'top_left_rank',
    'topLeft',
    'top_left',
    'topLeftSquare',
    'top_left_square',
  ], normalizeRankLabel);

  const topRightRank = firstLabel(parsed, [
    'topRightRank',
    'top_right_rank',
    'topRight',
    'top_right',
    'topRightSquare',
    'top_right_square',
  ], normalizeRankLabel);

  const scores = { w: 0, b: 0 };

  // 파일 라벨 기준:
  // 백 시점: 왼쪽 파일 a, 오른쪽 파일 h
  // 흑 시점: 왼쪽 파일 h, 오른쪽 파일 a
  if (bottomLeftFile === 'a') vote(scores, 'w', 3);
  if (bottomLeftFile === 'h') vote(scores, 'b', 3);
  if (bottomRightFile === 'h') vote(scores, 'w', 3);
  if (bottomRightFile === 'a') vote(scores, 'b', 3);

  if (topLeftFile === 'a') vote(scores, 'w', 2);
  if (topLeftFile === 'h') vote(scores, 'b', 2);
  if (topRightFile === 'h') vote(scores, 'w', 2);
  if (topRightFile === 'a') vote(scores, 'b', 2);

  // 랭크 라벨 기준:
  // 백 시점: 위 8, 아래 1
  // 흑 시점: 위 1, 아래 8
  if (topLeftRank === '8') vote(scores, 'w', 3);
  if (topLeftRank === '1') vote(scores, 'b', 3);
  if (topRightRank === '8') vote(scores, 'w', 2);
  if (topRightRank === '1') vote(scores, 'b', 2);

  if (bottomLeftRank === '1') vote(scores, 'w', 3);
  if (bottomLeftRank === '8') vote(scores, 'b', 3);
  if (bottomRightRank === '1') vote(scores, 'w', 2);
  if (bottomRightRank === '8') vote(scores, 'b', 2);

  // 라벨 판정이 있으면 orientation 필드보다 라벨을 우선한다.
  // Gemini가 orientation만 w로 찍고 topLeftRank=1을 같이 주는 경우를 막기 위함.
  if (scores.w !== scores.b) {
    return scores.w > scores.b ? 'w' : 'b';
  }

  return explicit || null;
}