export function createGeminiKeyRotation(keys) {
  const configured = [...new Set(keys)];
  let next = 0;

  return {
    nextKeys() {
      if (!configured.length) return [];
      const start = next;
      next = (next + 1) % configured.length;
      return [
        ...configured.slice(start),
        ...configured.slice(0, start),
      ];
    },
    label(key) {
      const index = configured.indexOf(key);
      return index < 0 ? 'key#unknown' : `key#${index + 1}`;
    },
  };
}
