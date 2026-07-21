export function normalizeKannyangSpeech(text) {
  const normalized = String(text ?? '')
    .replace(/(^|\n)\s*응냥\s*[,，.!?。！？]?\s*/g, '$1')
    .replace(/(^|\n)\s*응\s+냥\s*[,，.!?。！？]?\s*/g, '$1')
    .replace(/(^|\n)\s*응\s*[,，]\s*/g, '$1')
    .replace(/둘\s*거냐냥/g, '둘거냥')
    .replace(/둘\s*거\s*냥/g, '둘거냥')
    // Do not append 냥 to polite endings; convert them to natural cat-speech endings.
    .replace(/이군요냥/g, '이구나냥')
    .replace(/군요냥/g, '구나냥')
    .replace(/이네요냥/g, '이네냥')
    .replace(/네요냥/g, '네냥')
    .replace(/이에요냥/g, '이다냥')
    .replace(/예요냥/g, '다냥')
    .replace(/입니다냥/g, '이다냥')
    .replace(/습니다냥/g, '다냥')
    .replace(/냐냥/g, '냥')
    .trim();

  return normalized || '냥.';
}
