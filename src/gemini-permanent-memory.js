import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const permanentMemoryMaxTextLength = 1800;

const permanentMemoryTriggerPattern = /(기억해줘|기억해둬|기억해)/g;
const permanentMemoryUsagePattern = /\[\[\s*PERMANENT_MEMORY_USED\s*:\s*([^\]]*)\]\]/gi;
const permanentMemoryInferenceMinScore = 9;
const searchStopWords = new Set([
  '관련',
  '그거',
  '그건',
  '그게',
  '기억',
  '대해',
  '대한',
  '뭐야',
  '뭔데',
  '무엇',
  '알려',
  '알려줘',
  '어떤',
  '이거',
  '이건',
  '이게',
  '정보',
  '저거',
  '저건',
  '저게',
  '질문',
  'please',
  'tell',
  'what',
]);
const koreanSuffixes = [
  '이라고',
  '라는',
  '에서부터',
  '으로부터',
  '에게서',
  '한테서',
  '에서는',
  '으로는',
  '까지는',
  '부터는',
  '에게는',
  '한테는',
  '처럼',
  '보다',
  '으로',
  '라고',
  '하고',
  '에서',
  '에게',
  '한테',
  '께서',
  '까지',
  '부터',
  '이라',
  '랑',
  '의',
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '에',
  '와',
  '과',
  '도',
  '만',
  '로',
];

export function extractPercentPermanentMemory(content) {
  const text = String(content ?? '').trim();
  if (!text.startsWith('%')) {
    return null;
  }

  const body = text.replace(/^%+/, '').trim();
  if (!/(기억해줘|기억해둬|기억해)/.test(body)) {
    return null;
  }

  return cleanPermanentMemoryText(body.replace(permanentMemoryTriggerPattern, ' '));
}

export function cleanPermanentMemoryText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:!?'"“”‘’()[\]{}<>~`-]+/, '')
    .replace(/[\s,.;:!?'"“”‘’()[\]{}<>~`-]+$/, '')
    .trim();
}

export function createPermanentMemoryScope(guildId, userId) {
  return guildId ? `guild:${guildId}` : `dm:${userId}`;
}

export function extractPermanentMemoryUsage(answer, allowedIds = []) {
  const allowedIdSet = new Set(allowedIds);
  const usedIds = [];
  const cleanText = String(answer ?? '').replace(permanentMemoryUsagePattern, (_, rawIds) => {
    for (const id of String(rawIds ?? '').split(',')) {
      const normalizedId = id.trim();
      if (allowedIdSet.has(normalizedId) && !usedIds.includes(normalizedId)) {
        usedIds.push(normalizedId);
      }
    }

    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();

  return { cleanText, usedIds };
}

export function getPermanentMemoryContributorIds(entries, usedIds) {
  const usedIdSet = new Set(usedIds);
  const contributorIds = [];

  for (const entry of entries) {
    if (!usedIdSet.has(entry.id)) {
      continue;
    }

    for (const contributor of entry.contributors ?? []) {
      if (contributor.userId && !contributorIds.includes(contributor.userId)) {
        contributorIds.push(contributor.userId);
      }
    }
  }

  return contributorIds;
}

export function inferPermanentMemoryUsage(answer, entries) {
  const answerTerms = createSearchTerms(answer);

  return entries
    .filter((entry) =>
      scoreSearchMatch(answerTerms, createSearchTerms(entry.text))
        >= permanentMemoryInferenceMinScore
    )
    .map((entry) => entry.id);
}

export class PermanentMemoryStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.entries = [];
    this.loaded = false;
    this.loadPromise = null;
    this.saveQueue = Promise.resolve();
  }

  async ensureLoaded() {
    if (this.loaded) {
      return;
    }

    this.loadPromise ??= this.load();
    await this.loadPromise;
  }

  async add({ scopeId, text, authorId, authorName }) {
    await this.ensureLoaded();

    const normalizedText = cleanPermanentMemoryText(text);
    if (!normalizedText) {
      throw new TypeError('Permanent memory text is empty.');
    }
    if (normalizedText.length > permanentMemoryMaxTextLength) {
      throw new RangeError(`Permanent memory text exceeds ${permanentMemoryMaxTextLength} characters.`);
    }

    const normalizedScopeId = String(scopeId ?? '').trim();
    const normalizedAuthorId = String(authorId ?? '').trim();
    if (!normalizedScopeId || !normalizedAuthorId) {
      throw new TypeError('Permanent memory scope and author are required.');
    }

    const now = new Date().toISOString();
    const duplicate = this.entries.find((entry) =>
      entry.scopeId === normalizedScopeId
      && normalizeComparableText(entry.text) === normalizeComparableText(normalizedText)
    );

    if (duplicate) {
      const hasContributor = duplicate.contributors.some((contributor) =>
        contributor.userId === normalizedAuthorId
      );

      if (!hasContributor) {
        duplicate.contributors.push({
          userId: normalizedAuthorId,
          displayName: normalizeAuthorName(authorName),
          addedAt: now,
        });
      }

      duplicate.updatedAt = now;
      await this.save();
      return {
        entry: cloneEntry(duplicate),
        created: false,
        contributorAdded: !hasContributor,
      };
    }

    const entry = {
      id: randomUUID(),
      scopeId: normalizedScopeId,
      text: normalizedText,
      contributors: [
        {
          userId: normalizedAuthorId,
          displayName: normalizeAuthorName(authorName),
          addedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    this.entries.push(entry);
    await this.save();

    return {
      entry: cloneEntry(entry),
      created: true,
      contributorAdded: true,
    };
  }

  async search(scopeId, query, options = {}) {
    await this.ensureLoaded();

    const limit = Math.max(1, Math.min(8, Number(options.limit) || 4));
    const queryTerms = createSearchTerms(query);
    if (queryTerms.words.size === 0 && queryTerms.bigrams.size === 0) {
      return [];
    }

    return this.entries
      .filter((entry) => entry.scopeId === scopeId)
      .map((entry) => ({
        entry,
        score: scoreSearchMatch(queryTerms, createSearchTerms(entry.text)),
      }))
      .filter(({ score }) => score >= 7)
      .sort((left, right) =>
        right.score - left.score
        || Date.parse(right.entry.updatedAt) - Date.parse(left.entry.updatedAt)
      )
      .slice(0, limit)
      .map(({ entry, score }) => ({
        ...cloneEntry(entry),
        score,
      }));
  }

  async clearAll() {
    await this.ensureLoaded();

    const deletedCount = this.entries.length;
    this.entries = [];
    await this.save();

    return deletedCount;
  }

  async clearScope(scopeId) {
    await this.ensureLoaded();

    const normalizedScopeId = String(scopeId ?? '').trim();
    if (!normalizedScopeId) {
      throw new TypeError('Permanent memory scope is required.');
    }

    const previousCount = this.entries.length;
    this.entries = this.entries.filter((entry) => entry.scopeId !== normalizedScopeId);
    const deletedCount = previousCount - this.entries.length;

    await this.save();

    return deletedCount;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];

      this.entries = entries
        .map(normalizeStoredEntry)
        .filter(Boolean);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Failed to load permanent Gemini memory:');
        console.error(error);
      }
      this.entries = [];
    } finally {
      this.loaded = true;
    }
  }

  async save() {
    this.saveQueue = this.saveQueue
      .catch(() => {})
      .then(async () => {
        const payload = {
          version: 1,
          savedAt: new Date().toISOString(),
          entries: this.entries,
        };

        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      });

    return this.saveQueue;
  }
}

function normalizeStoredEntry(entry) {
  const id = String(entry?.id ?? '').trim();
  const scopeId = String(entry?.scopeId ?? '').trim();
  const text = cleanPermanentMemoryText(entry?.text);
  const contributors = Array.isArray(entry?.contributors)
    ? entry.contributors
        .map(normalizeStoredContributor)
        .filter(Boolean)
    : [];

  if (!id || !scopeId || !text || contributors.length === 0) {
    return null;
  }

  return {
    id,
    scopeId,
    text: text.slice(0, permanentMemoryMaxTextLength),
    contributors,
    createdAt: normalizeDate(entry.createdAt),
    updatedAt: normalizeDate(entry.updatedAt ?? entry.createdAt),
  };
}

function normalizeStoredContributor(contributor) {
  const userId = String(contributor?.userId ?? '').trim();
  if (!userId) {
    return null;
  }

  return {
    userId,
    displayName: normalizeAuthorName(contributor.displayName),
    addedAt: normalizeDate(contributor.addedAt),
  };
}

function normalizeDate(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : new Date().toISOString();
}

function normalizeAuthorName(value) {
  return String(value ?? 'Unknown').trim().slice(0, 80) || 'Unknown';
}

function cloneEntry(entry) {
  return {
    ...entry,
    contributors: entry.contributors.map((contributor) => ({ ...contributor })),
  };
}

function normalizeComparableText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function createSearchTerms(value) {
  const normalized = normalizeComparableText(value);
  const words = new Set();
  const bigrams = new Set();
  const rawTokens = normalized.match(/[\p{Letter}\p{Number}_@]+/gu) ?? [];

  for (const rawToken of rawTokens) {
    const token = stripKoreanSuffix(rawToken);
    if (token.length < 2 || searchStopWords.has(token)) {
      continue;
    }

    words.add(token);

    if (/[\p{Script=Hangul}]/u.test(token) && token.length >= 3) {
      for (let index = 0; index < token.length - 1; index += 1) {
        bigrams.add(token.slice(index, index + 2));
      }
    }
  }

  return { normalized, words, bigrams };
}

function stripKoreanSuffix(token) {
  let result = token;
  let changed = true;

  while (changed) {
    changed = false;

    for (const suffix of koreanSuffixes) {
      if (result.endsWith(suffix) && result.length - suffix.length >= 2) {
        result = result.slice(0, -suffix.length);
        changed = true;
        break;
      }
    }
  }

  return result;
}

function scoreSearchMatch(query, candidate) {
  let wordMatches = 0;
  let bigramMatches = 0;

  for (const word of query.words) {
    if (candidate.words.has(word)) {
      wordMatches += 1;
    }
  }

  for (const bigram of query.bigrams) {
    if (candidate.bigrams.has(bigram)) {
      bigramMatches += 1;
    }
  }

  if (wordMatches === 0 && bigramMatches < 2) {
    return 0;
  }

  const phraseBonus = query.normalized.includes(candidate.normalized)
    || candidate.normalized.includes(query.normalized)
    ? 20
    : 0;

  return wordMatches * 8 + bigramMatches + phraseBonus;
}
