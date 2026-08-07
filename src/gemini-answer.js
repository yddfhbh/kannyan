import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const supportedGeminiEmotionLabels = Object.freeze([
  'curious',
  'excited',
  'bored',
  'very_happy',
  'happy',
  'sad',
  'angry',
  'embarrassed',
  'surprised',
  'confused',
  'sleepy',
  'neutral',
]);

const geminiAnswerDirname = path.dirname(fileURLToPath(import.meta.url));

const geminiEmotionAssetPathByLabel = new Map([
  ['curious', path.join(geminiAnswerDirname, '..', 'assets', 'emotions', 'curious.png')],
  ['embarrassed', path.join(geminiAnswerDirname, '..', 'assets', 'emotions', 'embarrassed.png')],
  ['sad', path.join(geminiAnswerDirname, '..', 'assets', 'emotions', 'sad.png')],
  ['excited', path.join(geminiAnswerDirname, '..', 'assets', 'emotions', 'excited.png')],
  ['bored', path.join(geminiAnswerDirname, '..', 'assets', 'emotions', 'bored.png')],
  ['very_happy', path.join(geminiAnswerDirname, '..', 'assets', 'emotions', 'very-happy.png')],
  ['happy', path.join(geminiAnswerDirname, '..', 'assets', 'emotions', 'happy.png')],
]);

const geminiEmotionAssetAliasByLabel = new Map([
  ['angry', 'bored'],
  ['confused', 'bored'],
  ['surprised', 'bored'],
]);

const emotionAliasMap = new Map([
  ['curious', 'curious'],
  ['curiosity', 'curious'],
  ['wondering', 'curious'],
  ['inquisitive', 'curious'],
  ['questioning', 'curious'],
  ['excited', 'excited'],
  ['hyped', 'excited'],
  ['energetic', 'excited'],
  ['playful', 'excited'],
  ['bored', 'bored'],
  ['boring', 'bored'],
  ['idle', 'bored'],
  ['grumpy', 'bored'],
  ['unamused', 'bored'],
  ['snappy', 'bored'],
  ['bitey', 'bored'],
  ['very_happy', 'very_happy'],
  ['veryhappy', 'very_happy'],
  ['super_happy', 'very_happy'],
  ['superhappy', 'very_happy'],
  ['extremely_happy', 'very_happy'],
  ['ecstatic', 'very_happy'],
  ['elated', 'very_happy'],
  ['thrilled', 'very_happy'],
  ['happy', 'happy'],
  ['joy', 'happy'],
  ['joyful', 'happy'],
  ['cheerful', 'happy'],
  ['delighted', 'happy'],
  ['love', 'happy'],
  ['loving', 'happy'],
  ['sad', 'sad'],
  ['down', 'sad'],
  ['upset', 'sad'],
  ['depressed', 'sad'],
  ['lonely', 'sad'],
  ['sorrow', 'sad'],
  ['angry', 'angry'],
  ['mad', 'angry'],
  ['annoyed', 'angry'],
  ['irritated', 'angry'],
  ['frustrated', 'angry'],
  ['embarrassed', 'embarrassed'],
  ['shy', 'embarrassed'],
  ['awkward', 'embarrassed'],
  ['flustered', 'embarrassed'],
  ['bashful', 'embarrassed'],
  ['surprised', 'surprised'],
  ['shock', 'surprised'],
  ['shocked', 'surprised'],
  ['startled', 'surprised'],
  ['amazed', 'surprised'],
  ['confused', 'confused'],
  ['puzzled', 'confused'],
  ['perplexed', 'confused'],
  ['uncertain', 'confused'],
  ['sleepy', 'sleepy'],
  ['tired', 'sleepy'],
  ['drowsy', 'sleepy'],
  ['neutral', 'neutral'],
  ['calm', 'neutral'],
  ['plain', 'neutral'],
  ['default', 'neutral'],
  ['normal', 'neutral'],
]);

const informationalGeminiPromptPattern = /(?:[?？]|\b(?:what|why|how|when|where|who|which|can you|could you|would you|tell me|explain|help|is it|do i|should i|how to)\b|(?:뭐|무엇|왜|어떻게|어디|언제|누구|몇|알려줘|설명해줘|도와줘|추천해줘|가능해|맞아|맞나요|인가요|해줘|해줄래|할 수 있어|할수있어|방법))/i;
const happyAttachmentPositiveCuePattern = /(?:ㅋㅋ+|ㅎㅎ+|축하|고마워|감사|사랑해|행복해|기뻐|신나|대박|최고야|귀여워|웃겨|재밌어|\b(?:yay|yippee|congrats|congratulations|thank you|thanks|love you)\b)/i;

function normalizeGeminiEmotionContextText(value) {
  return String(value ?? '').trim();
}

function parseJsonObjectText(text) {
  const cleaned = String(text ?? '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export function normalizeGeminiEmotionLabel(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[`"'.,!?()[\]{}]/g, '')
    .replace(/[\s-]+/g, '_');

  return emotionAliasMap.get(normalized) ?? 'neutral';
}

export function isLikelyInformationalGeminiPrompt(prompt) {
  const text = normalizeGeminiEmotionContextText(prompt);
  if (!text) {
    return false;
  }

  if (happyAttachmentPositiveCuePattern.test(text)) {
    return false;
  }

  return informationalGeminiPromptPattern.test(text);
}

export function shouldAttachGeminiEmotionAsset(emotion, options = {}) {
  const normalizedEmotion = normalizeGeminiEmotionLabel(emotion);
  const source = String(options.source ?? '').trim().toLowerCase();
  const prompt = normalizeGeminiEmotionContextText(options.prompt);

  if (!getGeminiEmotionAssetPath(normalizedEmotion)) {
    return false;
  }

  if (normalizedEmotion !== 'happy') {
    return true;
  }

  if (source === 'web-search' || source === 'slash-web-search') {
    return false;
  }

  if (isLikelyInformationalGeminiPrompt(prompt)) {
    return false;
  }

  return true;
}

export function parseGeminiAnswerPayload(text) {
  const parsed = parseJsonObjectText(text);
  const rawAnswer = typeof parsed?.answer === 'string'
    ? parsed.answer
    : String(text ?? '');
  const answer = rawAnswer.trim();

  return {
    answer,
    emotion: normalizeGeminiEmotionLabel(parsed?.emotion),
  };
}

export function getGeminiEmotionAssetPath(emotion) {
  const normalizedEmotion = normalizeGeminiEmotionLabel(emotion);
  const assetEmotion =
    geminiEmotionAssetPathByLabel.has(normalizedEmotion)
      ? normalizedEmotion
      : (geminiEmotionAssetAliasByLabel.get(normalizedEmotion) ?? null);

  return assetEmotion
    ? (geminiEmotionAssetPathByLabel.get(assetEmotion) ?? null)
    : null;
}
