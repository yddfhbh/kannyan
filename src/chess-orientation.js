function normalizeFileLabel(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return /^[a-h]$/.test(text) ? text : '';
}

function normalizeRankLabel(value) {
  const text = String(value ?? '').trim();
  return /^[1-8]$/.test(text) ? text : '';
}

export function inferChessBoardOrientation(parsed) {
  const declared = parsed?.orientation === 'b'
    ? 'b'
    : parsed?.orientation === 'w'
      ? 'w'
      : '';
  const bottomLeftFile = normalizeFileLabel(
    parsed?.bottomLeftFile ?? parsed?.bottomLeft ?? parsed?.leftFile
  );
  const bottomRightFile = normalizeFileLabel(
    parsed?.bottomRightFile ?? parsed?.bottomRight ?? parsed?.rightFile
  );
  const bottomLeftRank = normalizeRankLabel(
    parsed?.bottomLeftRank ?? parsed?.bottomRank ?? parsed?.leftBottomRank
  );
  const topLeftRank = normalizeRankLabel(
    parsed?.topLeftRank ?? parsed?.topRank ?? parsed?.leftTopRank
  );

  let fileEvidence = '';
  if (bottomLeftFile === 'a' && bottomRightFile === 'h') {
    fileEvidence = 'w';
  } else if (bottomLeftFile === 'h' && bottomRightFile === 'a') {
    fileEvidence = 'b';
  }

  let rankEvidence = '';
  if (bottomLeftRank === '1' && topLeftRank === '8') {
    rankEvidence = 'w';
  } else if (bottomLeftRank === '8' && topLeftRank === '1') {
    rankEvidence = 'b';
  }

  if (fileEvidence && rankEvidence) {
    return fileEvidence === rankEvidence ? fileEvidence : declared || fileEvidence;
  }

  return fileEvidence || rankEvidence || declared || null;
}

export function getChessOrientationProbeRegions(width, height) {
  const safeWidth = Math.max(1, Math.floor(Number(width) || 0));
  const safeHeight = Math.max(1, Math.floor(Number(height) || 0));
  const bottomTop = Math.min(safeHeight - 1, Math.max(0, Math.floor(safeHeight * 0.72)));
  const cornerTop = Math.min(safeHeight - 1, Math.max(0, Math.floor(safeHeight * 0.64)));
  const rightLeft = Math.min(safeWidth - 1, Math.max(0, Math.floor(safeWidth * 0.64)));

  return [
    {
      label: 'Full board image.',
      left: 0,
      top: 0,
      width: safeWidth,
      height: safeHeight,
      targetWidth: Math.min(1400, Math.max(480, safeWidth)),
    },
    {
      label: 'Enlarged bottom edge with file labels.',
      left: 0,
      top: bottomTop,
      width: safeWidth,
      height: Math.max(1, safeHeight - bottomTop),
      targetWidth: Math.min(1800, Math.max(720, safeWidth * 2)),
    },
    {
      label: 'Enlarged bottom-left corner with file and rank labels.',
      left: 0,
      top: cornerTop,
      width: Math.max(1, Math.ceil(safeWidth * 0.36)),
      height: Math.max(1, safeHeight - cornerTop),
      targetWidth: 1100,
    },
    {
      label: 'Enlarged bottom-right corner with file labels.',
      left: rightLeft,
      top: cornerTop,
      width: Math.max(1, safeWidth - rightLeft),
      height: Math.max(1, safeHeight - cornerTop),
      targetWidth: 1100,
    },
  ];
}
