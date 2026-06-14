const pieceNames = {
  p: '폰',
  n: '나이트',
  b: '비숍',
  r: '룩',
  q: '퀸',
  k: '킹',
};

function formatMoveNature(move) {
  if (!move) {
    return '';
  }

  const facts = [
    `${pieceNames[move.piece] ?? '기물'}이 ${move.from}에서 ${move.to}로 이동`,
  ];

  if (move.captured) {
    facts.push(`${pieceNames[move.captured] ?? '기물'}를 잡는 수`);
  }
  if (move.promotion) {
    facts.push(`${pieceNames[move.promotion] ?? '기물'} 승격`);
  }
  if (move.givesMate) {
    facts.push('즉시 체크메이트');
  } else if (move.givesCheck) {
    facts.push('체크');
  } else if (!move.captured) {
    facts.push('체크도 포획도 아닌 수');
  }

  return facts.join(', ');
}

export function createStockfishExplanationContext(result, options = {}) {
  const maxPlies = Math.max(1, Number(options.maxPlies) || 6);
  const variation = Array.isArray(result?.principalVariation)
    ? result.principalVariation.slice(0, maxPlies)
    : [];
  const firstMove = variation[0];
  const lines = [
    `최선 수: ${result?.san ?? ''}`,
  ];

  const moveNature = formatMoveNature(firstMove);
  if (moveNature) {
    lines.push(`최선 수의 확인된 성격: ${moveNature}`);
  }

  if (variation.length > 1) {
    lines.push(`상대의 최선 대응: ${variation[1].san}`);
  }
  if (variation.length > 2) {
    lines.push(`그 뒤 권장 후속 수: ${variation[2].san}`);
  }
  if (variation.length > 0) {
    lines.push(`Stockfish 주 변형: ${variation.map((move) => move.san).join(' ')}`);
  }

  if (result?.score?.type === 'mate') {
    lines.push(`강제 메이트 탐지: ${result.score.value}`);
  }

  return lines.join('\n');
}
