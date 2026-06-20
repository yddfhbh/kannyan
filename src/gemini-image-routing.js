const directImageReferencePattern =
  /(사진|이미지|짤|그림|보드|체스판|판세|판\s*상황|기물|포지션|글자|텍스트|OCR|색상|컬러|헥스|hex)/i;
const shortDeicticPattern =
  /^(?:이거|이건|이게|이 사진|이 이미지|얘|이 사람|여기|여기서|저거|저건|그거|그건)(?:\s|$)/i;
const shortReplyImageActionPattern =
  /(?:누구야|뭐야|최선수|설명해|분석해|번역해|읽어줘)/i;
const shortReplyOnlyActionPattern =
  /^(?:설명해|설명해줘|설명해봐|분석해|분석해줘|분석해봐|번역해|번역해줘|읽어줘|읽어봐|최선수|최선수 알려줘|누구야|뭐야)\??$/i;

export function shouldUseReplyImagesForGeminiPrompt(prompt) {
  const text = String(prompt ?? '').trim();
  if (!text) {
    return false;
  }

  if (directImageReferencePattern.test(text)) {
    return true;
  }

  if (text.length <= 24 && shortDeicticPattern.test(text) && shortReplyImageActionPattern.test(text)) {
    return true;
  }

  return text.length <= 16 && shortReplyOnlyActionPattern.test(text);
}
