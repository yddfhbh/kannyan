import { normalizeVArchiveNickname } from './varchive-link-store.js';

const numericSelectionTokenPattern = /^[1-9]\d*$/;

export function parseVArchivePerformanceMessageInput(
  input,
  fallbackNickname = null,
  options = {}
) {
  const trimmed = String(input ?? '').trim();
  const normalizedFallbackNickname = fallbackNickname
    ? normalizeVArchiveNickname(fallbackNickname)
    : null;

  if (!trimmed) {
    return {
      query: '',
      nickname: normalizedFallbackNickname,
      trailingQueryCandidate: '',
      trailingNicknameCandidate: null,
    };
  }

  const separatorIndex = trimmed.lastIndexOf('|');
  if (separatorIndex < 0) {
    const tokens = trimmed.split(/\s+/);
    const trailingToken = tokens.length > 1
      ? tokens[tokens.length - 1]
      : null;

    // Numeric suffixes are reserved for V-ARCHIVE song result selection,
    // matching the `%서열표 <곡명> 2` behavior.
    if (trailingToken && numericSelectionTokenPattern.test(trailingToken)) {
      return {
        query: trimmed,
        nickname: normalizedFallbackNickname,
        trailingQueryCandidate: '',
        trailingNicknameCandidate: null,
      };
    }

    const trailingQueryCandidate = trailingToken
      ? trimmed.slice(0, trimmed.length - trailingToken.length).trim()
      : '';

    return {
      query: trimmed,
      nickname: normalizedFallbackNickname,
      trailingQueryCandidate,
      trailingNicknameCandidate: trailingToken
        ? normalizeVArchiveNickname(trailingToken)
        : null,
    };
  }

  const query = trimmed.slice(0, separatorIndex).trim();
  const nicknameText = trimmed.slice(separatorIndex + 1).trim();

  if (!query) {
    const error = new Error(options.usageMessage ?? '사용법을 확인해달라냥.');
    error.code = 'INVALID_VARCHIVE_PERFORMANCE_INPUT';
    throw error;
  }

  if (!nicknameText) {
    const error = new Error('`|` 뒤에 V-ARCHIVE 닉네임을 같이 적어달라냥.');
    error.code = 'INVALID_NICKNAME';
    throw error;
  }

  return {
    query,
    nickname: normalizeVArchiveNickname(nicknameText),
    trailingQueryCandidate: '',
    trailingNicknameCandidate: null,
  };
}
