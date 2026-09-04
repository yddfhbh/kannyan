const validVArchiveGradeButtons = new Set([4, 5, 6, 8]);
const vArchiveGradeDifficulties = ['NM', 'HD', 'MX', 'SC'];
const vArchiveGradeFloorPattern = /^\d+(?:\.\d+)?$/;
const vArchiveJacketBaseUrl = 'https://v-archive.net/s3/images/jackets';

export function isVArchiveGradeFloorName(value) {
  return vArchiveGradeFloorPattern.test(String(value ?? '').trim());
}

export function normalizeVArchiveGradeFloorName(value) {
  const floorName = String(value ?? '').trim();
  if (isVArchiveGradeFloorName(floorName)) {
    return floorName;
  }

  const error = new Error('\uC11C\uC5F4\uD45C \uB808\uBCA8\uC740 `15.2`\uCC98\uB7FC \uC785\uB825\uD574\uB2EC\uB77C\uB0E5.');
  error.code = 'INVALID_VARCHIVE_GRADE_FLOOR';
  throw error;
}

export function normalizeVArchiveGradeButton(value) {
  const button = Number(value);
  if (validVArchiveGradeButtons.has(button)) {
    return button;
  }

  const error = new Error('\uBC84\uD2BC\uC740 4, 5, 6, 8 \uC911\uC5D0\uC11C\uB9CC \uACE0\uB97C \uC218 \uC788\uB2E4\uB0E5.');
  error.code = 'INVALID_VARCHIVE_GRADE_BUTTON';
  throw error;
}

export function getVArchiveGradeKey(button) {
  return `${normalizeVArchiveGradeButton(button)}B`;
}

export function buildVArchiveJacketUrl(titleId) {
  const normalizedTitleId = String(titleId ?? '').trim();
  return normalizedTitleId
    ? `${vArchiveJacketBaseUrl}/${encodeURIComponent(normalizedTitleId)}.jpg`
    : null;
}

export function getVArchiveGradeEmptyMessage(button, floorName) {
  return `${getVArchiveGradeKey(button)} ${normalizeVArchiveGradeFloorName(floorName)}\uCE35\uC5D0 \uD574\uB2F9\uD558\uB294 \uD328\uD134\uC774 \uC5C6\uB2E4\uB0E5.`;
}

export function findVArchiveGradeEntries(songs, floorName, button) {
  const normalizedFloorName = normalizeVArchiveGradeFloorName(floorName);
  const normalizedButton = normalizeVArchiveGradeButton(button);
  const targetKey = `${normalizedButton}B`;
  const entries = [];

  for (const song of Array.isArray(songs) ? songs : []) {
    const patternGroup = song?.patterns?.[targetKey];
    if (!patternGroup || typeof patternGroup !== 'object') {
      continue;
    }

    for (const difficulty of vArchiveGradeDifficulties) {
      const pattern = patternGroup[difficulty];
      const patternFloorName = String(pattern?.floorName ?? '').trim();
      const level = Number(pattern?.level);

      if (patternFloorName !== normalizedFloorName || !Number.isFinite(level)) {
        continue;
      }

      const titleId = normalizeSongTitleId(song?.title);
      entries.push({
        titleId,
        songName: String(song?.name ?? '').trim() || 'Unknown Song',
        dlcCode: String(song?.dlcCode ?? '').trim(),
        difficulty,
        level,
        floorName: patternFloorName,
        button: normalizedButton,
        key: targetKey,
        jacketUrl: buildVArchiveJacketUrl(titleId),
      });
    }
  }

  return entries.sort(compareVArchiveGradeEntries);
}

function compareVArchiveGradeEntries(left, right) {
  const songNameOrder = String(left?.songName ?? '').localeCompare(
    String(right?.songName ?? ''),
    'ko',
    { sensitivity: 'base', numeric: true },
  );
  if (songNameOrder !== 0) {
    return songNameOrder;
  }

  const leftDifficultyIndex = vArchiveGradeDifficulties.indexOf(String(left?.difficulty ?? ''));
  const rightDifficultyIndex = vArchiveGradeDifficulties.indexOf(String(right?.difficulty ?? ''));
  if (leftDifficultyIndex !== rightDifficultyIndex) {
    return leftDifficultyIndex - rightDifficultyIndex;
  }

  return String(left?.titleId ?? '').localeCompare(String(right?.titleId ?? ''), 'en', {
    numeric: true,
  });
}

function normalizeSongTitleId(value) {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text)
    ? String(Number(text))
    : text;
}
