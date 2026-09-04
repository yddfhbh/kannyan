import {
  isVArchiveGradeFloorName,
  normalizeVArchiveGradeButton,
  normalizeVArchiveGradeFloorName,
} from './varchive-grade.js';

const numericSelectionTokenPattern = /^[1-9]\d*$/;

export function parseVArchiveSongLookupInput(input, options = {}) {
  const trimmed = String(input ?? '').trim();
  if (options.allowGradeMode !== false) {
    const gradeMode = parseVArchiveGradeMessageInput(trimmed);
    if (gradeMode) {
      return {
        mode: 'grade',
        rawQuery: trimmed,
        floorName: gradeMode.floorName,
        button: gradeMode.button,
        baseQuery: null,
        selectionIndex: null,
      };
    }
  }

  const match = trimmed.match(/^(.*\S)\s+([1-9]\d*)$/);
  if (!match) {
    return {
      mode: 'song',
      rawQuery: trimmed,
      baseQuery: trimmed,
      selectionIndex: null,
    };
  }

  return {
    mode: 'song',
    rawQuery: trimmed,
    baseQuery: match[1].trim(),
    selectionIndex: Number(match[2]),
  };
}

export function parseVArchiveGradeMessageInput(input) {
  const trimmed = String(input ?? '').trim();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length !== 2) {
    return null;
  }

  if (!isVArchiveGradeFloorName(tokens[0]) || !numericSelectionTokenPattern.test(tokens[1])) {
    return null;
  }

  try {
    return {
      floorName: normalizeVArchiveGradeFloorName(tokens[0]),
      button: normalizeVArchiveGradeButton(tokens[1]),
    };
  } catch {
    return null;
  }
}

export function resolveVArchiveSongCommandOptions(commandName, options = {}) {
  const normalizedCommandName = String(commandName ?? '').trim();
  const songName = String(options.songName ?? '').trim();
  const floorName = String(options.floorName ?? '').trim();
  const rawButton = options.button;
  const hasSongName = songName.length > 0;
  const hasFloorName = floorName.length > 0;
  const hasButton = rawButton !== null && rawButton !== undefined && String(rawButton).trim() !== '';

  if (normalizedCommandName === '\uACE1\uC815\uBCF4') {
    if (!hasSongName) {
      throw buildUsageError(
        options.songUsageMessage
          ?? '`/\uACE1\uC815\uBCF4 \uACE1\uBA85:<\uACE1\uBA85>` \uD615\uC2DD\uC73C\uB85C \uC368\uB2EC\uB77C\uB0E5.'
      );
    }

    return {
      mode: 'song',
      query: songName,
    };
  }

  if (hasSongName && (hasFloorName || hasButton)) {
    throw buildUsageError(
      options.ambiguousUsageMessage
        ?? '\uACE1\uBA85 \uAC80\uC0C9\uACFC \uC11C\uC5F4\uD45C \uCE35 \uC870\uD68C\uB97C \uAC19\uC774 \uC904 \uC218\uB294 \uC5C6\uB2E4\uB0E5. \uD55C \uAC00\uC9C0 \uBC29\uC2DD\uB9CC \uC120\uD0DD\uD574\uB2EC\uB77C\uB0E5.'
    );
  }

  if (hasSongName) {
    return {
      mode: 'song',
      query: songName,
    };
  }

  if (hasFloorName && hasButton) {
    return {
      mode: 'grade',
      floorName: normalizeVArchiveGradeFloorName(floorName),
      button: normalizeVArchiveGradeButton(rawButton),
    };
  }

  if (hasFloorName || hasButton) {
    throw buildUsageError(
      options.gradeUsageMessage
        ?? '`/\uC11C\uC5F4\uD45C \uC11C\uC5F4\uD45C\uB808\uBCA8:15.2 \uBC84\uD2BC:4` \uCC98\uB7FC \uB808\uBCA8\uACFC \uBC84\uD2BC\uC744 \uD568\uAED8 \uC785\uB825\uD574\uB2EC\uB77C\uB0E5.'
    );
  }

  throw buildUsageError(
    options.songUsageMessage
      ?? options.gradeUsageMessage
      ?? '`/\uC11C\uC5F4\uD45C \uACE1\uBA85:<\uACE1\uBA85>` \uB610\uB294 `/\uC11C\uC5F4\uD45C \uC11C\uC5F4\uD45C\uB808\uBCA8:15.2 \uBC84\uD2BC:4` \uD615\uC2DD\uC73C\uB85C \uC368\uB2EC\uB77C\uB0E5.'
  );
}

function buildUsageError(message) {
  const error = new Error(message);
  error.code = 'INVALID_VARCHIVE_SONG_COMMAND_OPTIONS';
  return error;
}
