﻿import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  getTetrioHunDinFontDataUri,
  renderTetrioHunDinFontFace,
  renderTetrioNumericTextMarkup,
  renderTetrioTextMarkup,
  renderTetrioTextWeightCss,
  renderTetrioSvgToPng,
  tetrioFontFamily,
  tetrioPhraseWordSpacing,
  tetrioTightCommaDx,
} from './tetrio-font.js';

const bannedAvatarPath = fileURLToPath(new URL('../assets/avatar-banned.png', import.meta.url));
const headerOverlayPath = fileURLToPath(new URL('../assets/about-header-overlay.png', import.meta.url));
const tetrioApiBaseUrl = 'https://ch.tetr.io/api';
const tetrioContentBaseUrl = 'https://tetr.io/user-content';
const tetrioGameBaseUrl = 'https://tetr.io';
const tetrioDefaultAvatarUrl = `${tetrioGameBaseUrl}/res/avatar.png`;
const twemojiBaseUrl = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72';
const cardFontFamily = tetrioFontFamily;
const bioFontFamily = '"Noto Sans CJK KR", Arial';
const tetrioPalette = {
  pageBg: '#07100a',
  cardBg: '#21421f',
  cardBorder: '#3a6a40',
  panelBg: '#1d3b1b',
  panelBorder: '#315b36',
  divider: '#3a6a40',
  progressTrack: '#0a160c',
};
const tetrioHeaders = {
  'User-Agent': 'discord-bot/1.0 TETR.IO profile card',
  'X-Session-ID': 'discord-bot-tetrio-card',
};
const bioTextFontSize = 17;
const bioCjkReferenceFontSize = 17;
const bioCjkReferenceWidth = 16.375;
const bioTextBaselineOffsetY = 45;
const bioTextLineHeight = 25;
const bioTextBottomPadding = 15;
const bioClipTopOffsetY = 25;
const bioClipBottomInset = 6;
const measuredBioWrapMaxLength = 180;
const bioEmojiSize = 18;
const statRankRightInset = 5;
const tetrioJsonCacheMaxEntries = 200;
const imageDataUriCacheMaxEntries = 800;
const achievementSpriteCacheMaxEntries = 8;
const measuredTextWidthCacheMaxEntries = 1200;
const levelTagHeight = 28;
const supporterBadgeHeight = 26;
const compactProfileStatsBoxHeight = 24;
const achievementIconGridSize = 8;
const achievementIconInnerScale = 0.5714;
const achievementIconInnerOffsetScale = 0.2143;
const achievementRankNames = new Map([
  [0, 'none'],
  [1, 'bronze'],
  [2, 'silver'],
  [3, 'gold'],
  [4, 'platinum'],
  [5, 'diamond'],
  [100, 'issued'],
]);
let tetrioHunFontDataUriPromise = null;
let bannedAvatarDataUriPromise = null;
let defaultAvatarDataUriPromise = null;
let headerOverlayDataUriPromise = null;
const tetrioJsonCache = new Map();
const tetrioJsonPendingPromises = new Map();
const imageDataUriCache = new Map();
const imageDataUriPendingPromises = new Map();
const achievementIconPendingPromises = new Map();
const achievementSpriteCache = new Map();
const achievementSpritePendingPromises = new Map();
const headerNameWidthCache = new Map();
const bioTextWidthCache = new Map();
const graphemeSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('en', { granularity: 'grapheme' })
  : null;
const emojiPresentationPattern = /\p{Emoji_Presentation}/u;
const extendedPictographicPattern = /\p{Extended_Pictographic}/u;
const tetrioCardDebug = process.env.TETRIO_CARD_DEBUG === '1';

function debugTetrioCard(label, data) {
  if (!tetrioCardDebug) return;

  console.log(`[TETRIO CARD DEBUG] ${label}`);
  console.log(JSON.stringify(data, null, 2));
}


export async function createTetrioProfileCard(username) {
  const card = await createTetrioProfileCardSvg(username);
  const image = renderTetrioSvgToPng(card.svg, 2);

  return {
    image,
    username: card.username,
  };
}

export async function createTetrioProfileCardSvg(username) {
  const normalizedUsername = normalizeTetrioUsername(username);

  if (!normalizedUsername) {
    const error = new Error('TETR.IO username is required');
    error.status = 400;
    throw error;
  }

  const [userResponse, summariesResponse] = await Promise.all([
    fetchTetrioJson(`/users/${encodeURIComponent(normalizedUsername)}`),
    fetchTetrioJson(`/users/${encodeURIComponent(normalizedUsername)}/summaries`),
  ]);

  const user = userResponse.data;
  const summaries = summariesResponse.data;
  const assets = await fetchTetrioAssets(user, summaries);
  const svg = await renderTetrioCardSvg(user, summaries, assets);

  return {
    svg,
    username: user.username,
  };
}

export async function findTetrioUsername(input) {
  const normalizedUsername = normalizeTetrioUsername(String(input ?? ''));
  if (!normalizedUsername) {
    return null;
  }

  try {
    const response = await fetchTetrioJson(`/users/${encodeURIComponent(normalizedUsername)}`);
    return response.data?.username ?? normalizedUsername;
  } catch (error) {
    if (error.status === 404) {
      return null;
    }

    throw error;
  }
}

export async function findTetrioUsernameByDiscordId(discordUserId) {
  const normalizedDiscordUserId = String(discordUserId ?? '').trim();

  if (!/^\d{17,20}$/.test(normalizedDiscordUserId)) {
    return null;
  }

  const query = `discord:id:${normalizedDiscordUserId}`;
  const response = await fetchTetrioJson(`/users/search/${encodeURIComponent(query)}`);
  const users = Array.isArray(response.data?.users)
    ? response.data.users
    : [];

  return users[0]?.username ?? null;
}

function normalizeTetrioUsername(input) {
  const trimmed = input.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/^\/u\/([^/]+)/i);
    if (match) {
      return decodeURIComponent(match[1]).trim().toLowerCase();
    }
  } catch {
    // Plain usernames are expected most of the time.
  }

  return trimmed.replace(/^@+/, '').toLowerCase();
}

async function fetchTetrioJson(path) {
  const now = Date.now();
  const cached = tetrioJsonCache.get(path);

  if (cached && cached.expiresAt > now) {
    console.log(`[TETR.IO CACHE HIT] ${path} ttl=${Math.round((cached.expiresAt - now) / 1000)}s`);
    return cached.body;
  }

  if (cached) {
    console.log(`[TETR.IO CACHE EXPIRED] ${path}`);
    tetrioJsonCache.delete(path);
  }

  if (tetrioJsonPendingPromises.has(path)) {
    console.log(`[TETR.IO PENDING HIT] ${path}`);
    return tetrioJsonPendingPromises.get(path);
  }
  console.log(`[TETR.IO CACHE MISS] ${path}`);
  const promise = fetchTetrioJsonUncached(path)
    .finally(() => {
      tetrioJsonPendingPromises.delete(path);
    });

  tetrioJsonPendingPromises.set(path, promise);
  return promise;
}

async function fetchTetrioJsonUncached(path) {
  const response = await fetch(`${tetrioApiBaseUrl}${path}`, {
    headers: tetrioHeaders,
  });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    const error = new Error(body?.error?.msg ?? `TETR.IO API responded with ${response.status}`);
    error.status = response.status;
    throw error;
  }

  cacheTetrioJsonResult(path, body);
  return body;
}

function getTetrioJsonCacheTtlCapMs(path) {
  if (path.endsWith('/summaries')) {
    return 10_000; // 스탯 반영용: 최대 30초
  }

  if (/^\/users\/[^/]+$/.test(path)) {
    return 60_000; // 프로필 기본 정보: 최대 60초
  }

  return 300_000; // 디스코드 ID 검색 등은 5분 유지
}

function cacheTetrioJsonResult(path, body) {
  const apiExpiresAt = Number(body?.cache?.cached_until);
  if (!Number.isFinite(apiExpiresAt) || apiExpiresAt <= Date.now()) {
    console.log(`[TETR.IO CACHE SKIP] ${path}`);
    return;
  }

  const ttlCapMs = getTetrioJsonCacheTtlCapMs(path);
  const expiresAt = Math.min(apiExpiresAt, Date.now() + ttlCapMs);

  console.log(`[TETR.IO CACHE SAVE] ${path} ttl=${Math.round((expiresAt - Date.now()) / 1000)}s`);

  if (tetrioJsonCache.size >= tetrioJsonCacheMaxEntries) {
    tetrioJsonCache.delete(tetrioJsonCache.keys().next().value);
  }

  tetrioJsonCache.set(path, {
    body,
    expiresAt,
  });
}

async function fetchTetrioAssets(user, summaries) {
  const isBanned = isBannedTetrioUser(user);
  const avatarUrl = user.avatar_revision
    ? `${tetrioContentBaseUrl}/avatars/${user._id}.jpg?rv=${user.avatar_revision}`
    : tetrioDefaultAvatarUrl;
  const bannerUrl = user.supporter && user.banner_revision
    ? `${tetrioContentBaseUrl}/banners/${user._id}.jpg?rv=${user.banner_revision}`
    : null;
  const countryCode = normalizeCountryCode(user.country);
  const flagUrl = countryCode
    ? `https://flagcdn.com/h40/${countryCode.toLowerCase()}.png`
    : null;
  const badges = user.badges ?? [];
  const featuredAchievements = getFeaturedAchievements(user, summaries);
  const leagueRank = summaries?.league?.rank
    ? summaries.league.rank
    : null;
  const uniqueBadges = getUniqueBadges(badges);
  const avatarPromise = isBanned
    ? fetchBannedAvatarDataUri()
    : user.avatar_revision
      ? fetchImageDataUri(avatarUrl)
      : fetchDefaultAvatarDataUri();
  const [avatar, banner, flag, badgeIconEntries, featuredAchievementAssets, leagueRankIcon, hunFont, headerOverlay] = await Promise.all([
    avatarPromise,
    fetchImageDataUri(bannerUrl),
    fetchImageDataUri(flagUrl),
    Promise.all(uniqueBadges.map(async (badge) => [
      badge.id,
      await fetchImageDataUri(`${tetrioGameBaseUrl}/res/badges/${formatTetrioAssetPath(badge.id)}.png`),
    ])),
    Promise.all(featuredAchievements.map(fetchFeaturedAchievementAsset)),
    fetchImageDataUri(leagueRank ? `${tetrioGameBaseUrl}/res/league-ranks/${formatTetrioAssetPath(leagueRank)}.png` : null, {
      includeMetadata: true,
      trimTransparent: true,
    }),
    fetchTetrioHunFontDataUri(),
    fetchHeaderOverlayDataUri(),
  ]);

  return {
    avatar,
    banner,
    flag,
    badgeIcons: Object.fromEntries(badgeIconEntries),
    featuredAchievements: featuredAchievementAssets.filter(Boolean),
    leagueRankIcon,
    hunFont,
    headerOverlay,
  };
}

function getUniqueBadges(badges) {
  const seen = new Set();
  return badges.filter((badge) => {
    const id = String(badge?.id ?? '');
    if (!id || seen.has(id)) {
      return false;
    }

    seen.add(id);
    return true;
  });
}

function getFeaturedAchievements(user, summaries) {
  const featuredIds = Array.isArray(user?.achievements)
    ? getUniqueFeaturedAchievementIds(user.achievements).slice(0, 3)
    : [];
  const achievements = Array.isArray(summaries?.achievements)
    ? summaries.achievements
    : [];

  return featuredIds
    .map((featuredId) => achievements.find((achievement) =>
      Number(achievement?.k) === Number(featuredId)
      && !achievement?.stub
      && Number(achievement?.rank) !== 0
    ))
    .filter(Boolean);
}

function getUniqueFeaturedAchievementIds(achievementIds) {
  const seen = new Set();
  const uniqueIds = [];

  for (const achievementId of achievementIds) {
    const id = Number(achievementId);
    if (!Number.isSafeInteger(id) || seen.has(id)) {
      continue;
    }

    seen.add(id);
    uniqueIds.push(id);
  }

  return uniqueIds;
}

async function fetchFeaturedAchievementAsset(achievement) {
  const id = Number(achievement?.k);
  const rankName = achievementRankNames.get(Number(achievement?.rank));
  if (!Number.isSafeInteger(id) || id < 1 || !rankName) {
    return null;
  }

  const spriteIndex = Math.floor((id - 1) / 64);
  const tileIndex = (id - 1) % (achievementIconGridSize * achievementIconGridSize);
  const competitivePlace = getAchievementCompetitivePlace(achievement);
  const [frame, wreath, icon] = await Promise.all([
    fetchImageDataUri(`${tetrioGameBaseUrl}/res/achievements/frames/${rankName}.png`),
    fetchImageDataUri(competitivePlace ? `${tetrioGameBaseUrl}/res/achievements/wreaths/${competitivePlace}.png` : null),
    fetchAchievementIconDataUri(spriteIndex, tileIndex),
  ]);

  return {
    ...achievement,
    competitivePlace,
    frame,
    icon,
    rankName,
    wreath,
  };
}

async function fetchAchievementIconDataUri(spriteIndex, tileIndex) {
  const cacheKey = `achievement-icon:${spriteIndex}:${tileIndex}`;
  if (imageDataUriCache.has(cacheKey)) {
    return imageDataUriCache.get(cacheKey);
  }

  if (achievementIconPendingPromises.has(cacheKey)) {
    return achievementIconPendingPromises.get(cacheKey);
  }

  const promise = fetchAchievementIconDataUriUncached(spriteIndex, tileIndex, cacheKey)
    .finally(() => {
      achievementIconPendingPromises.delete(cacheKey);
    });
  achievementIconPendingPromises.set(cacheKey, promise);
  return promise;
}

async function fetchAchievementIconDataUriUncached(spriteIndex, tileIndex, cacheKey) {
  try {
    const sprite = await fetchAchievementSprite(spriteIndex);
    const tileWidth = Math.floor((sprite?.width ?? 0) / achievementIconGridSize);
    const tileHeight = Math.floor((sprite?.height ?? 0) / achievementIconGridSize);
    if (tileWidth <= 0 || tileHeight <= 0) {
      return null;
    }

    const tileColumn = tileIndex % achievementIconGridSize;
    const tileRow = Math.floor(tileIndex / achievementIconGridSize);
    const buffer = await sharp(sprite.buffer)
      .extract({
        left: tileColumn * tileWidth,
        top: tileRow * tileHeight,
        width: tileWidth,
        height: tileHeight,
      })
      .negate({ alpha: false })
      .png()
      .toBuffer();
    const dataUri = `data:image/png;base64,${buffer.toString('base64')}`;
    cacheImageDataUriResult(cacheKey, dataUri);
    return dataUri;
  } catch {
    return null;
  }
}

async function fetchAchievementSprite(spriteIndex) {
  const cacheKey = `achievement-sprite:${spriteIndex}`;
  if (achievementSpriteCache.has(cacheKey)) {
    return achievementSpriteCache.get(cacheKey);
  }

  if (achievementSpritePendingPromises.has(cacheKey)) {
    return achievementSpritePendingPromises.get(cacheKey);
  }

  const promise = fetchAchievementSpriteUncached(spriteIndex, cacheKey)
    .finally(() => {
      achievementSpritePendingPromises.delete(cacheKey);
    });
  achievementSpritePendingPromises.set(cacheKey, promise);
  return promise;
}

async function fetchAchievementSpriteUncached(spriteIndex, cacheKey) {
  const response = await fetch(`${tetrioGameBaseUrl}/res/achievements/icons/${spriteIndex}.png`, {
    headers: tetrioHeaders,
  });
  if (!response.ok) {
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const metadata = await sharp(buffer).metadata();
  const result = {
    buffer,
    height: metadata.height,
    width: metadata.width,
  };
  cacheAchievementSpriteResult(cacheKey, result);
  return result;
}

function cacheAchievementSpriteResult(key, result) {
  if (!result?.buffer) {
    return;
  }

  if (achievementSpriteCache.size >= achievementSpriteCacheMaxEntries) {
    achievementSpriteCache.delete(achievementSpriteCache.keys().next().value);
  }

  achievementSpriteCache.set(key, result);
}

function getAchievementCompetitivePlace(achievement) {
  const position = Number(achievement?.pos);
  if (Number(achievement?.art) !== 2 || !Number.isFinite(position) || position < 0) {
    return null;
  }

  if (position < 3) return 't3';
  if (position < 5) return 't5';
  if (position < 10) return 't10';
  if (position < 25) return 't25';
  if (position < 50) return 't50';
  if (position < 100) return 't100';
  return null;
}

function formatTetrioAssetPath(value) {
  return String(value)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function normalizeCountryCode(value) {
  const country = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

function isBannedTetrioUser(user) {
  return String(user?.role ?? '').toLowerCase() === 'banned';
}

async function fetchImageDataUri(url, options = {}) {
  if (!url) {
    return null;
  }

  const cacheKey = getImageDataUriCacheKey(url, options);
  if (imageDataUriCache.has(cacheKey)) {
    return imageDataUriCache.get(cacheKey);
  }

  if (imageDataUriPendingPromises.has(cacheKey)) {
    return imageDataUriPendingPromises.get(cacheKey);
  }

  const promise = fetchImageDataUriUncached(url, options, cacheKey)
    .finally(() => {
      imageDataUriPendingPromises.delete(cacheKey);
    });
  imageDataUriPendingPromises.set(cacheKey, promise);
  return promise;
}

async function fetchImageDataUriUncached(url, options, cacheKey) {
  try {
    const response = await fetch(url, { headers: tetrioHeaders });
    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') ?? 'image/jpeg';
    const originalBuffer = Buffer.from(await response.arrayBuffer());
    const buffer = options.trimTransparent
      ? await trimTransparentImageBuffer(originalBuffer, contentType)
      : originalBuffer;
    const dataUri = `data:${contentType};base64,${buffer.toString('base64')}`;
    if (!options.includeMetadata) {
      cacheImageDataUriResult(cacheKey, dataUri);
      return dataUri;
    }

    const result = {
      image: dataUri,
      ...(await readImageMetadata(buffer)),
    };
    cacheImageDataUriResult(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

function getImageDataUriCacheKey(url, options = {}) {
  return [
    url,
    options.includeMetadata ? 'metadata' : 'data',
    options.trimTransparent ? 'trim' : 'raw',
  ].join('|');
}

function cacheImageDataUriResult(key, result) {
  if (result === null || result === undefined) {
    return;
  }

  if (imageDataUriCache.size >= imageDataUriCacheMaxEntries) {
    imageDataUriCache.delete(imageDataUriCache.keys().next().value);
  }

  imageDataUriCache.set(key, result);
}

async function readImageMetadata(buffer) {
  try {
    const metadata = await sharp(buffer).metadata();
    return {
      height: metadata.height,
      width: metadata.width,
    };
  } catch {
    return {};
  }
}

async function trimTransparentImageBuffer(buffer, contentType) {
  if (!contentType.includes('png')) {
    return buffer;
  }

  try {
    return await sharp(buffer)
      .trim()
      .png()
      .toBuffer();
  } catch {
    return buffer;
  }
}

function fetchTetrioHunFontDataUri() {
  tetrioHunFontDataUriPromise ??= getTetrioHunDinFontDataUri();
  return tetrioHunFontDataUriPromise;
}

function fetchBannedAvatarDataUri() {
  bannedAvatarDataUriPromise ??= readLocalImageDataUri(bannedAvatarPath, 'image/png');
  return bannedAvatarDataUriPromise;
}

function fetchDefaultAvatarDataUri() {
  defaultAvatarDataUriPromise ??= fetchImageDataUri(tetrioDefaultAvatarUrl)
    .then((dataUri) => {
      if (!dataUri) {
        defaultAvatarDataUriPromise = null;
      }
      return dataUri;
    });
  return defaultAvatarDataUriPromise;
}

function fetchHeaderOverlayDataUri() {
  headerOverlayDataUriPromise ??= readLocalImageDataUri(headerOverlayPath, 'image/png');
  return headerOverlayDataUriPromise;
}

async function readLocalImageDataUri(path, mimeType) {
  try {
    const buffer = await readFile(path);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

async function renderTetrioCardSvg(user, summaries, assets) {
  const svgWidth = 820;
  const layoutWidth = svgWidth;
  const cardX = 14;
  const cardWidth = layoutWidth - cardX * 2;
  const contentX = 28;
  const contentWidth = layoutWidth - contentX * 2;
  const contentRight = contentX + contentWidth;
  const topStatGap = 8;
  const topStatAvailableWidth = contentWidth - topStatGap * 2;
  const topLeagueStatWidth = Math.round(topStatAvailableWidth * 0.42);
  const topSecondaryStatWidth = (topStatAvailableWidth - topLeagueStatWidth) / 2;
  const topLeagueStatX = contentX;
  const topFortyLinesStatX = topLeagueStatX + topLeagueStatWidth + topStatGap;
  const topBlitzStatX = topFortyLinesStatX + topSecondaryStatWidth + topStatGap;
  const bottomStatGap = 8;
  const bottomStatWidth = (contentWidth - bottomStatGap) / 2;
  const bottomQuickPlayStatX = contentX;
  const bottomExpertQuickPlayStatX = bottomQuickPlayStatX + bottomStatWidth + bottomStatGap;
 const bannerCutLeft = -2; // 배너 영역 왼쪽을 12px 잘라냄

const bannerX = cardX + bannerCutLeft;
const bannerY = 26;
const bannerHeight = 92;
const bannerWidth = cardWidth - bannerCutLeft + 2;

const headerOverlayHeight = 15;
const headerOverlayTileWidth = 180; // 작을수록 더 자주 반복됨
const headerOverlayY = bannerY + bannerHeight - headerOverlayHeight;
const headerOverlayOffsetX = -2; // 오른쪽으로 8px
const bannerEdgeCoverWidth = 4;   // 끝부분 가릴 폭
const bannerEdgeCoverOffsetY = 5; // 아래로 4px 내림
const bannerEdgeCoverY = headerOverlayY + bannerEdgeCoverOffsetY;
const bannerEdgeCoverHeight = headerOverlayHeight;
const bannerRightEdgeCoverHeight = 10;
const bannerRightEdgeCoverY = bannerEdgeCoverY ;
  const avatarX = 28;
  const avatarY = bannerY-24; //프사 높이 , 많이뺴면 올라감
  const avatarSize = 94;
  const nameX = avatarX + avatarSize + 16;
  const headerNameFontSize = 46;
  const headerNameFontWeight = 900;
  const headerUsername = String(user.username ?? '').toUpperCase();
  const bannerCropLeft = 0; // 왼쪽을  더 자름
 const headerNameWidth = await measureRenderedHeaderUsernameWidth({
  text: headerUsername,
  fontSize: headerNameFontSize,
  fontDataUri: assets.hunFont,
  fontWeight: headerNameFontWeight,
});

const headerFlagGap = 110;
const headerFlagX = Math.round(nameX + headerNameWidth + headerFlagGap);
const headerFlagY = bannerY + 18;
const headerMetaY = bannerY + Math.min(77, bannerHeight - 23);
  
  const headerNameClass = assets.banner ? 'headerName' : 'headerName noBannerHeaderName';
  const headerNameMarkup = await renderHeaderUsernameMarkup({
    className: headerNameClass,
    fontDataUri: assets.hunFont,
    fontSize: headerNameFontSize,
    fontWeight: headerNameFontWeight,
    text: headerUsername,
    x: nameX,
    y: bannerY + 52,
  });
  const headerMetaClass = assets.banner ? 'meta' : 'meta noBannerMeta';
  const flag = getCountryFlag(user.country, assets.flag);
  const joined = user.ts ? `JOINED ${formatRelativeDate(user.ts).toUpperCase()}` : 'JOIN DATE HIDDEN';
  const headerMetaFontSize = 12;
  const headerMetaX = avatarX + avatarSize + 18;
  const league = summaries.league;
  const fortyLines = summaries['40l'];
  const blitz = summaries.blitz;
  const zenith = summaries.zenith;
  const zenithEx = summaries.zenithex;
  const badges = user.badges ?? [];
  const levelTag = getLevelTag(user.xp);
  const badgeLayout = getBadgeLayout(badges.length, contentWidth);
  const levelTagY = bannerY + bannerHeight + 8;
  const levelRowCenterY = levelTagY + levelTagHeight / 2;
  const profileStats = getCompactProfileStats(user, league);
  const profileStatsWidth = getCompactProfileStatsWidth(profileStats);
  const profileDistinguishment = resolveProfileDistinguishment(user, summaries);
  const profileStatsRightNudge = !profileStats.timeItem && profileStats.roundItems.length ? 8 : 0;
  const supporterBadgeRightEdge = profileStatsWidth > 0
    ? contentRight - profileStatsWidth - 8 + profileStatsRightNudge
    : contentRight;
  const supporterBadge = user.supporter
    ? getSupporterBadgeLayout(user.supporter_tier ?? 1, supporterBadgeRightEdge, levelRowCenterY - supporterBadgeHeight / 2)
    : null;
  const profileStatsX = supporterBadge
    ? supporterBadge.x + supporterBadge.width + 8
    : contentRight - profileStatsWidth + profileStatsRightNudge;
  const profileStatsY = levelRowCenterY - compactProfileStatsBoxHeight / 2;
  const noticeStartY = levelTagY + 42;
  const noticeSlotHeight = 68;
  const noticeMarkup = [];
  let noticeCursorY = noticeStartY;
  if (isBannedTetrioUser(user)) {
    noticeMarkup.push(renderBannedBanner(noticeCursorY, cardX, cardWidth));
    noticeCursorY += noticeSlotHeight;
  }
  if (user.badstanding && !isBannedTetrioUser(user)) {
    noticeMarkup.push(renderBadStandingBanner(noticeCursorY, cardX, cardWidth));
    noticeCursorY += noticeSlotHeight;
  }
  if (profileDistinguishment) {
    noticeMarkup.push(renderDistinguishmentBanner(profileDistinguishment, noticeCursorY, cardX, cardWidth));
    noticeCursorY += noticeSlotHeight;
  }
  const badgeBoxY = noticeMarkup.length > 0 ? noticeCursorY : levelTagY + 46;
const badgeY = badgeBoxY + 10;
const badgeBoxHeight = badgeLayout.boxHeight;
const bioTextLeftInset = 12;
const bioTextRightInset = 0;
const bioTextWidth = contentWidth - bioTextLeftInset - bioTextRightInset;

const bioHangulWidth = await measureBioHangulWidth(bioTextFontSize);

const bioLines = await wrapBioText(user.bio, bioTextWidth, {
  fontDataUri: assets.hunFont,
  fontSize: bioTextFontSize,
  hangulWidth: bioHangulWidth,
});

const bioEmojiAssets = await fetchBioEmojiAssets(bioLines);
const hasBio = bioLines.length > 0;
const bioHeight = getBioHeight(bioLines);
const bioY = badgeBoxY + badgeBoxHeight + 8;
const topStatY = bioY + (hasBio ? bioHeight + 8 : 0);
const bottomStatY = topStatY + 100;
const svgHeight = bottomStatY + 126;
const cardHeight = svgHeight - 32;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${layoutWidth} ${svgHeight}">
  <defs>
    <clipPath id="avatarClip"><rect x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" rx="6"/></clipPath>
    <clipPath id="bannerClip"><rect x="${bannerX}" y="${bannerY}" width="${bannerWidth}" height="${bannerHeight}" rx="0"/></clipPath>
    <clipPath id="bioClip"><rect x="${contentX + bioTextLeftInset}" y="${bioY + bioClipTopOffsetY}" width="${bioTextWidth}" height="${Math.max(0, bioHeight - bioClipTopOffsetY - bioClipBottomInset)}"/></clipPath>
    <linearGradient id="bannerFallback" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#304e52"/>
      <stop offset="0.5" stop-color="#25412d"/>
      <stop offset="1" stop-color="#1b2f23"/>
    </linearGradient>

    <filter id="headerNameShadow" x="-20%" y="-35%" width="160%" height="220%">
      <feOffset in="SourceAlpha" dx="0" dy="5" result="shadowOffset"/>
      <feGaussianBlur in="shadowOffset" stdDeviation="4.2" result="shadowBlur"/>
      <feFlood flood-color="#071109" flood-opacity="0.58" result="shadowColor"/>
      <feComposite in="shadowColor" in2="shadowBlur" operator="in" result="shadow"/>
      <feMerge>
        <feMergeNode in="shadow"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

 <filter id="headerUnderscoreShadow" x="-140%" y="-600%" width="380%" height="1300%" color-interpolation-filters="sRGB">
  <feDropShadow dx="0" dy="5.2" stdDeviation="4.2" flood-color="#071109" flood-opacity="0.58"/>
</filter>

<filter id="statValueGlowWide" x="-28%" y="-82%" width="156%" height="264%" color-interpolation-filters="sRGB">
  <feGaussianBlur in="SourceGraphic" stdDeviation="4.1"/>
</filter>

<filter id="statValueGlowTight" x="-22%" y="-62%" width="144%" height="224%" color-interpolation-filters="sRGB">
  <feGaussianBlur in="SourceGraphic" stdDeviation="1.45"/>
</filter>

<filter id="headerOverlayTint" color-interpolation-filters="sRGB">
  <feColorMatrix type="matrix" values="
    0 0 0 0 0.1294
    0 0 0 0 0.2588
    0 0 0 0 0.1216
    0 0 0 1 0"/>
</filter>

<filter id="featuredAchievementShadow" x="-18%" y="-18%" width="136%" height="146%" color-interpolation-filters="sRGB">
  <feDropShadow dx="0" dy="2.4" stdDeviation="2.2" flood-color="#061009" flood-opacity="0.72"/>
</filter>
    <pattern id="dangerStripe" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <rect width="24" height="24" fill="#b50808"/>
      <rect width="9" height="24" fill="#8c0505"/>
    </pattern>
    ${renderLevelTagGradients()}
    ${renderSupporterBadgeDefs()}
    <style>
      ${renderTetrioFontFace(assets.hunFont)}
      text { font-family: ${cardFontFamily}; letter-spacing: 0; ${renderTetrioTextWeightCss()} }
      .legacyBannerFont text {
      font-family: Arial;
      word-spacing: 8px;
      }
      .tiny { font-size: 11px; font-weight: 900; fill: #a8e7a7; text-shadow: 0 1px 2px #061009; }
      .plainRank { font-size: 12px; font-weight: 900; fill: #a8e7a7; text-shadow: 0 1px 2px #061009; }
      .label { font-size: 13px; font-weight: 900; fill: #5d915c; opacity: 0.84; word-spacing: ${tetrioPhraseWordSpacing}; }
      .value {
  font-weight: 950;
  fill: #c9ffc8;
  stroke: rgba(190, 245, 190, 0.82);
  stroke-width: 1.35px;
  stroke-linejoin: round;
  paint-order: stroke fill;
}

.valueShadow {
  font-weight: 900;
  fill: rgba(218, 255, 213, 0.2);
}

.valueGlowWide {
  font-weight: 900;
  fill: #7fe985;
  opacity: 0.38;
}

.valueGlowTight {
  font-weight: 900;
  fill: #d8ffd2;
  opacity: 0.82;
}
      .sub {
  font-size: 15.2px;
  font-weight: 950;
  fill: #c3f2bc;
  stroke: rgba(195, 242, 188, 0.62);
  stroke-width: 0.42px;
  paint-order: stroke fill;
  text-shadow: 0 1px 2px #061009;
  word-spacing: ${tetrioPhraseWordSpacing};
}

.subMetric {
  font-size: 15.2px;
  font-family: ${cardFontFamily};
  font-weight: 950;
  text-shadow: 0 1px 2px #061009;
  word-spacing: ${tetrioPhraseWordSpacing};
}

.subMetricValue {
  fill: #d2ffc9;
  font-weight: 950;
  stroke: rgba(210, 255, 201, 0.62);
  stroke-width: 0.38px;
  paint-order: stroke fill;
  letter-spacing: 0.18px;
}

.subMetricLabel {
  fill: #9ed99a;
  font-weight: 950;
  stroke: rgba(158, 217, 154, 0.5);
  stroke-width: 0.32px;
  paint-order: stroke fill;
  letter-spacing: 0.8px;
  opacity: 1;
}
      .leagueAux { fill: #c5efbc; }
      .leagueAuxMuted { fill: #c5efbc; }
      .white { fill: #f6fff5; text-shadow: 0 2px 4px #061009; }
      .headerName {
        fill: #fbfff8;
        filter: url(#headerNameShadow);
        stroke: rgba(251,255,248,0.54);
        stroke-width: 1.8px;
        paint-order: stroke fill;
      }

      .headerNameUnderscore {
        fill: #fbfff8;
        stroke: rgba(251,255,248,0.54);
        stroke-width: 1.8px;
        paint-order: stroke fill;
        filter: url(#headerUnderscoreShadow);
      }

      .noBannerHeaderNameUnderscore {
        fill: #b7d9af;
      }
      .meta { fill: #d4f7ff; text-shadow: 0 2px 3px #061009; word-spacing: ${tetrioPhraseWordSpacing}; }
      .noBannerHeaderName { fill: #b7d9af; }
      .noBannerMeta { fill: #82aa7e; }
      .xp { fill: #f7fff1; text-shadow: 0 2px 3px #061009; }
      .profileBoxValue { text-shadow: 0 1px 2px #061009; }
      .profileBoxValuePrimary { fill: #a9ef9e; }
      .profileBoxValueSecondary { fill: #7aa076; }
      .profileBoxValueSuffix { fill: #86a683; }
      .profileBoxSeparator { fill: #5a875d; opacity: 0.92; }
      .dangerTitle {
  fill: #fff8f0;
  stroke: rgba(255, 248, 240, 0.65);
  stroke-width: 0.75px;
  paint-order: stroke fill;
  text-shadow: 0 2px 3px #5d0000;
}

.dangerSub {
  fill: #fff4ec;
  stroke: rgba(255, 244, 236, 0.55);
  stroke-width: 0.42px;
  paint-order: stroke fill;
  text-shadow: 0 2px 3px #5d0000;
}
      .bioTitle {
        fill: #679d63;
        opacity: 0.88;
        word-spacing: 4px;
      }

      .bioText {
  font-family: ${bioFontFamily};
  fill: #6faa6b;
  text-shadow: 0 1px 2px #07150a;
  word-spacing: 0px;

  stroke: rgba(255,255,255,0.22);
  stroke-width: 0.12px;
  font-weight: 700;
  stroke-linejoin: round;
  paint-order: stroke fill;
}
    </style>
  </defs>

  <rect width="${layoutWidth}" height="${svgHeight}" fill="${tetrioPalette.pageBg}"/>
  <rect x="${cardX}" y="16" width="${cardWidth}" height="${cardHeight}" fill="${tetrioPalette.cardBg}" stroke="${tetrioPalette.cardBorder}" stroke-width="4" rx="3"/>
 <rect x="${bannerX}" y="${bannerY}" width="${bannerWidth}" height="${bannerHeight}" fill="url(#bannerFallback)" clip-path="url(#bannerClip)"/>
${assets.banner ? `<image href="${assets.banner}" x="${bannerX}" y="${bannerY}" width="${bannerWidth}" height="${bannerHeight}" preserveAspectRatio="xMidYMid slice" clip-path="url(#bannerClip)"/>` : ''}
<rect x="${bannerX}" y="${bannerY}" width="${bannerWidth}" height="${bannerHeight}" fill="#000000" opacity="0.08" clip-path="url(#bannerClip)"/>

<rect x="${bannerX}" y="-18" width="${layoutWidth - bannerX - 4}" height="44" fill="#000000"/> 
//검은박스 조절

${renderHeaderOverlayStrip(
  assets.headerOverlay,
  bannerX + headerOverlayOffsetX,
  headerOverlayY,
  bannerWidth,
  headerOverlayHeight,
  { tileWidth: headerOverlayTileWidth }
)}
<rect
  x="${bannerX}"
  y="${bannerEdgeCoverY}"
  width="${bannerEdgeCoverWidth}"
  height="${bannerEdgeCoverHeight}"
  fill="${tetrioPalette.cardBorder}"
/>
<rect
  x="${bannerX + bannerWidth - bannerEdgeCoverWidth}"
  y="${bannerRightEdgeCoverY}"
  width="${bannerEdgeCoverWidth}"
  height="${bannerRightEdgeCoverHeight}"
  fill="${tetrioPalette.cardBorder}"
/>

<rect x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" fill="#26362c" clip-path="url(#avatarClip)"/>
  ${assets.avatar ? `<image href="${assets.avatar}" x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>` : `<text x="${avatarX + avatarSize / 2}" y="${avatarY + 55}" text-anchor="middle" font-size="38" font-weight="900" fill="#9eeaa4">${escapeXml(user.username[0]?.toUpperCase() ?? '?')}</text>`}
  <rect x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" rx="8" fill="none" stroke="#d9ffe2" stroke-width="2" opacity="0.25"/>

  ${headerNameMarkup}
${renderHeaderFlag(flag, headerFlagX, headerFlagY)}
  <text x="${headerMetaX}" y="${headerMetaY}" class="${headerMetaClass}" font-size="${headerMetaFontSize}" font-weight="800" xml:space="preserve">${renderTetrioTextMarkup(joined)} - <tspan font-family="Noto Sans CJK KR, Arial" font-size="11" font-weight="900">♥</tspan> ${renderTetrioNumericTextMarkup(formatNumber(user.friend_count ?? user.friendcount ?? 0))}</text>
  ${renderLevelTag(levelTag, contentX, levelTagY)}
  ${renderFeaturedAchievements(assets.featuredAchievements, contentX + levelTag.width + 8, levelTagY - 6)}
  ${supporterBadge ? renderSupporterBadgeMarkup(supporterBadge) : ''}
  ${renderProfileStats(profileStats, profileStatsX, profileStatsY)}

  ${noticeMarkup.join('\n')}

  ${renderBadgeRow(badges, assets.badgeIcons, badgeY, contentX, contentWidth, badgeLayout)}

  ${renderBio(bioLines, bioEmojiAssets, bioY, bioHeight, contentX, contentWidth)}
  ${renderStatCard(topLeagueStatX, topStatY, topLeagueStatWidth, 'TETRA LEAGUE', `#${formatRank(league?.standing)}`, `${formatTrNumber(league?.tr)}TR`, `${formatDecimal(league?.apm, 2)} APM   ${formatDecimal(league?.pps, 2)} PPS   ${formatDecimal(league?.vs, 2)} VS`, {
    valueIcon: assets.leagueRankIcon?.image,
    valueIconHeight: assets.leagueRankIcon?.height,
    valueFontSize: 34.2,
    valueAlign: 'center',
    valueIconSize: 26,
    valueIconWidth: assets.leagueRankIcon?.width,
    valueIconGap: 20,
    valueFormat: 'leagueWithGlicko',
    glicko: league?.glicko,
    rd: league?.rd,
    flag,
    localRank: league?.standing_local,
    worldRank: league?.standing,
    subtextMarkup: renderLeagueMetricsSubtext(topLeagueStatX, topStatY, topLeagueStatWidth, league),
  })}
  ${renderStatCard(topFortyLinesStatX, topStatY, topSecondaryStatWidth, '40 LINES', `#${formatRank(fortyLines?.rank)}`, formatTime(fortyLines?.record?.results?.stats?.finaltime), formatAgo(fortyLines?.record?.ts), {
    valueFontSize: 34.2,
    valueFormat: 'timeSplitDecimal',
    flag,
    localRank: fortyLines?.rank_local,
    worldRank: fortyLines?.rank,
  })}
  ${renderStatCard(topBlitzStatX, topStatY, topSecondaryStatWidth, 'BLITZ', `#${formatRank(blitz?.rank)}`, formatNumber(blitz?.record?.results?.stats?.score), formatAgo(blitz?.record?.ts), { valueFontSize: 34.2, flag, localRank: blitz?.rank_local, worldRank: blitz?.rank })}
  ${renderStatCard(bottomQuickPlayStatX, bottomStatY, bottomStatWidth, 'QUICK PLAY', `#${formatRank(zenith?.rank)}`, `${formatAltitude(zenith?.record?.results?.stats?.zenith?.altitude)}M`, `CAREER BEST ${formatAltitude(zenith?.best?.record?.results?.stats?.zenith?.altitude)}M (#${formatRank(zenith?.best?.rank)})`, { valueFontSize: 35.6, unitFontSize: 27.8, valueFormat: 'altitudeWithUnit', flag, localRank: zenith?.rank_local, worldRank: zenith?.rank })}
  ${renderStatCard(bottomExpertQuickPlayStatX, bottomStatY, bottomStatWidth, 'EXPERT QUICK PLAY', `#${formatRank(zenithEx?.rank)}`, `${formatAltitude(zenithEx?.record?.results?.stats?.zenith?.altitude)}M`, `CAREER BEST ${formatAltitude(zenithEx?.best?.record?.results?.stats?.zenith?.altitude)}M (#${formatRank(zenithEx?.best?.rank)})`, { valueFontSize: 35.6, unitFontSize: 27.8, valueFormat: 'altitudeWithUnit', flag, localRank: zenithEx?.rank_local, worldRank: zenithEx?.rank })}

</svg>`;
}

function getHeaderFlagNudgeX(text, fontSize) {
  const rawText = String(text ?? '').toUpperCase();

  // 닉네임이 _로 시작하면 renderHeaderUsernameMarkup 쪽에서
  // 언더바/뒤 글자 전체를 오른쪽으로 밀었으므로 국기도 같이 밀기
  if (rawText.startsWith('_')) {
    return fontSize * 0.45;
  }

  return 0;
}

function getSupporterBadgeLayout(tier, rightEdge = 920, y = 160) {
  const starCount = Math.max(0, Math.min(4, Number(tier) - 1));
  const height = supporterBadgeHeight;
  const starCellWidth = 40;
  const starStep = 32;
  const starAreaWidth = starCount > 0
    ? starCellWidth + (starCount - 1) * starStep
    : 0;
  const labelWidth = 122;
  const labelX = Math.max(0, starAreaWidth - 3);
  const width = labelX + labelWidth;
  const x = rightEdge - width;
  return {
    starCount,
    height,
    starCellWidth,
    starStep,
    starAreaWidth,
    labelWidth,
    labelX,
    width,
    x,
    y,
  };
}

function renderSupporterBadge(tier, rightEdge = 920, y = 160) {
  return renderSupporterBadgeMarkup(getSupporterBadgeLayout(tier, rightEdge, y));
}

function renderTetrioFontFace(fontDataUri) {
  if (!fontDataUri) {
    return '';
  }

  return renderTetrioHunDinFontFace(fontDataUri);
}

function renderSupporterBadgeMarkup(layout) {
  const {
    starCount,
    height,
    starCellWidth,
    starStep,
    labelWidth,
    labelX,
    width,
    x,
    y,
  } = layout;
  const starSegments = Array.from({ length: starCount }, (_, index) => {
    const left = index * starStep;
    return `<polygon points="${getSupporterStarCellPoints(left, starCellWidth, height)}" fill="url(#supporterStarGradient)"/>`;
  }).join('');
  const stars = Array.from({ length: starCount }, (_, index) => {
    const left = index * starStep;
    const centerX = left + starCellWidth / 2 - 1.2;
    return `<polygon points="${getStarPoints(centerX, 13, 8.8, 3.9)}" fill="#fffaf2"/>`;
  }).join('');
  const labelPoints = getSupporterLabelPoints(labelX, labelWidth, height, { verticalInset: 0.8 });

  return `
  <g transform="translate(${x} ${y})" filter="url(#supporterBadgeShadow)">
    ${starSegments}
    <polygon points="${labelPoints}" fill="url(#supporterLabelGradient)"/>
    <polygon points="${getSupporterLabelPoints(labelX + 2, labelWidth - 4, height, { verticalInset: 3 })}" fill="url(#supporterLabelInnerGradient)" opacity="0.62"/>
    ${stars}
   <text x="${labelX + labelWidth / 2 - 1.5}" y="18.15" text-anchor="middle" font-family="HUN" font-size="15.8" font-weight="950" letter-spacing="0.06" fill="#fffaf3" stroke="rgba(255,250,243,0.58)" stroke-width="0.48" paint-order="stroke fill">SUPPORTER</text>
  </g>`;
}

function renderSupporterBadgeDefs() {
  return `
    <linearGradient id="supporterStarGradient" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#ff7643"/>
      <stop offset="0.34" stop-color="#f3562b"/>
      <stop offset="0.7" stop-color="#df4021"/>
      <stop offset="1" stop-color="#c24d1f"/>
    </linearGradient>
    <linearGradient id="supporterLabelGradient" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#eb5322"/>
      <stop offset="0.34" stop-color="#f56628"/>
      <stop offset="0.7" stop-color="#fc812f"/>
      <stop offset="1" stop-color="#ff9735"/>
    </linearGradient>
    <linearGradient id="supporterLabelInnerGradient" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#ffe0b7"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="supporterBadgeShadow" x="-8%" y="-18%" width="116%" height="150%">
      <feDropShadow dx="0" dy="1.1" stdDeviation="1.1" flood-color="#000000" flood-opacity="0.4"/>
    </filter>`;
}

function getSupporterStarCellPoints(left, width, height) {
  const startX = left;
  const leftEdge = left + 8.5;
  const rightEdge = left + width - 2;
  const rightInner = left + width - 10.5;
  return [
    formatPoint([startX, height / 2]),
    formatPoint([leftEdge, 0.8]),
    formatPoint([rightEdge, 0.8]),
    formatPoint([rightInner, height / 2]),
    formatPoint([rightEdge, height - 0.8]),
    formatPoint([leftEdge, height - 0.8]),
  ].join(' ');
}

function getSupporterLabelPoints(x, width, height, options = {}) {
  const horizontalInset = options.horizontalInset ?? 0;
  const verticalInset = options.verticalInset ?? 0;
  const left = x + horizontalInset;
  const top = verticalInset;
  const right = x + width - horizontalInset;
  const bottom = height - verticalInset;
  const tip = 11 - horizontalInset * 0.5;
  return [
    formatPoint([left + 3, top]),
    formatPoint([right - tip, top]),
    formatPoint([right, height / 2]),
    formatPoint([right - tip, bottom]),
    formatPoint([left + 3, bottom]),
    formatPoint([left - 5 + horizontalInset, height / 2]),
  ].join(' ');
}

function renderHeaderOverlayStrip(imageHref, x, y, totalWidth, height, options = {}) {
  if (!imageHref) {
    return '';
  }

  const tileWidth = options.tileWidth ?? 160;
  const clipPath = options.clipPath ?? 'url(#bannerClip)';
  let markup = '';

  for (let cursorX = x; cursorX < x + totalWidth; cursorX += tileWidth) {
  markup += `<image
    href="${imageHref}"
    x="${cursorX}"
    y="${y}"
    width="${tileWidth}"
    height="${height}"
    preserveAspectRatio="none"
    clip-path="${clipPath}"
    filter="url(#headerOverlayTint)"
  />`;
}

  return markup;
}

function renderProfileStats(stats, x = 720, y = 160) {
  if (!stats.roundItems.length && !stats.timeItem) {
    return '';
  }

  let cursorX = x;
  let body = '';

  if (stats.roundItems.length) {
    body += renderProfileStatsBox(stats.roundItems, cursorX, y, { horizontalPadding: 2 });
    cursorX += getCompactProfileStatsBoxWidth(stats.roundItems, { horizontalPadding: 2 });
  }

  if (stats.timeItem) {
    if (stats.roundItems.length) {
      cursorX += 8;
    }
    body += renderProfileStatsBox([stats.timeItem], cursorX, y);
  }

  return `<g>${body}</g>`;
}

function renderProfileStatsBox(items, x, y, options = {}) {
  const boxHeight = compactProfileStatsBoxHeight;
  const baselineY = y + 17;
  const boxWidth = getCompactProfileStatsBoxWidth(items, options);
  const boxMarkup = `<rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="4" fill="${tetrioPalette.panelBg}" stroke="${tetrioPalette.panelBg}" stroke-width="1.5"/>`;
  if (items.length === 3 && items[1]?.separator === 'slash') {
    const slashX = x + boxWidth / 2;
    return `${boxMarkup}${renderProfileStatsValue(items[0], (x + slashX) / 2, baselineY)}
      <text x="${slashX}" y="${baselineY}" text-anchor="middle" class="profileBoxSeparator" font-size="16" font-weight="900">/</text>
      ${renderProfileStatsValue(items[2], (slashX + x + boxWidth) / 2, baselineY)}`;
  }

  const contentWidth = items.reduce((sum, item) => sum + item.width, 0);
  let cursorX = x + (boxWidth - contentWidth) / 2;
  let body = '';

  for (const item of items) {
    if (item.separator === 'slash') {
      body += `<text x="${cursorX + item.width / 2}" y="${baselineY}" text-anchor="middle" class="profileBoxSeparator" font-size="16" font-weight="900">/</text>`;
      cursorX += item.width;
      continue;
    }

    body += renderProfileStatsValue(item, cursorX + item.width / 2, baselineY);
    cursorX += item.width;
  }

  return `${boxMarkup}${body}`;
}

function renderProfileStatsValue(item, x, y) {
  const valueMarkup = item.suffix
    ? `${renderTetrioNumericTextMarkup(item.value)}<tspan class="${item.suffixClassName ?? 'profileBoxValueSuffix'}">${escapeXml(item.suffix)}</tspan>`
    : renderTetrioNumericTextMarkup(item.value);
  return `<text x="${x}" y="${y}" text-anchor="middle" class="profileBoxValue ${item.className}" font-size="${item.fontSize}" font-weight="900">${valueMarkup}</text>`;
}

function getStarPoints(cx, cy, outerRadius, innerRadius) {
  return Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    return formatPoint([
      cx + Math.cos(angle) * radius,
      cy + Math.sin(angle) * radius,
    ]);
  }).join(' ');
}
function renderBadStandingBanner(y = 204, x = 14, width = 932) {
  const centerX = x + width / 2;
  return `
  <g class="legacyBannerFont">
    <rect x="${x}" y="${y}" width="${width}" height="62" fill="url(#dangerStripe)"/>
    <rect x="${x}" y="${y}" width="${width}" height="62" fill="none" stroke="#ff1d1d" stroke-width="4"/>
    <text x="${centerX}" y="${y + 32}" text-anchor="middle" class="dangerTitle" font-size="24.3" font-weight="900">BAD STANDING</text>
    <text x="${centerX}" y="${y + 52}" text-anchor="middle" class="dangerSub" font-size="12.6" font-weight="900">ONE OR MORE RECENT BANS ON RECORD</text>
  </g>`;
}

function renderBannedBanner(y = 204, x = 14, width = 932) {
  const centerX = x + width / 2;
  return `
  <g class="legacyBannerFont">
    <rect x="${x}" y="${y}" width="${width}" height="62" fill="url(#dangerStripe)"/>
    <rect x="${x}" y="${y}" width="${width}" height="62" fill="#190000" opacity="0.32"/>
    <rect x="${x}" y="${y}" width="${width}" height="62" fill="none" stroke="#ff1d1d" stroke-width="4"/>
    <text x="${centerX}" y="${y + 32}" text-anchor="middle" class="dangerTitle" font-size="25.5" font-weight="900">BANNED</text>
    <text x="${centerX}" y="${y + 52}" text-anchor="middle" class="dangerSub" font-size="12.6" font-weight="900">THIS USER IS CURRENTLY BANNED</text>
  </g>`;
}

function resolveProfileDistinguishment(user, summaries) {
  const explicit = normalizeProfileDistinguishment(user?.distinguishment);
  if (explicit) {
    return explicit;
  }

  const championMatches = [];

  if (summaries?.['40l']?.rank === 1) {
    championMatches.push({ detail: '40l', shortLabel: '40L', text: '40 LINES CHAMPION' });
  }

  if (summaries?.blitz?.rank === 1) {
    championMatches.push({ detail: 'blitz', shortLabel: 'BLITZ', text: 'BLITZ CHAMPION' });
  }

  if (summaries?.league?.standing === 1) {
    championMatches.push({ detail: 'league', shortLabel: 'TL', text: 'TETRA LEAGUE CHAMPION' });
  }

  if (championMatches.length === 0) {
    return null;
  }

  if (championMatches.length > 1) {
    return {
      type: 'champion',
      detail: 'x-multiple',
      text: `${championMatches.map((match) => match.shortLabel).join(' & ')} CHAMPION`,
    };
  }

  return {
    type: 'champion',
    detail: championMatches[0].detail,
    text: championMatches[0].text,
  };
}

function normalizeProfileDistinguishment(distinguishment) {
  if (!distinguishment || typeof distinguishment !== 'object') {
    return null;
  }

  const type = String(distinguishment.type ?? '').trim().toLowerCase();
  if (!type) {
    return null;
  }

  return {
    type,
    detail: String(distinguishment.detail ?? '').trim().toLowerCase(),
    header: String(distinguishment.header ?? ''),
    footer: String(distinguishment.footer ?? ''),
    text: String(distinguishment.text ?? ''),
  };
}

function normalizeDistinguishmentText(value) {
  return String(value ?? '')
    .replace(/%tetrio%/gi, 'TETR.IO')
    .replace(/%osk%/gi, 'OSK')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderDistinguishmentBanner(distinguishment, y, x = 14, width = 932) {
  switch (distinguishment?.type) {
    case 'staff':
      return renderStaffDistinguishmentBanner(distinguishment, y, x, width);
    case 'champion':
      return renderChampionDistinguishmentBanner(distinguishment, y, x, width);
    case 'twc':
      return renderTwcDistinguishmentBanner(distinguishment, y, x, width);
    default:
      return renderGenericDistinguishmentBanner(distinguishment, y, x, width);
  }
}

function renderStaffDistinguishmentBanner(distinguishment, y, x = 14, width = 932) {
  const height = 62;
  const theme = getStaffDistinguishmentTheme(distinguishment.detail);
  const title = normalizeDistinguishmentText(distinguishment.header || distinguishment.text || 'TETR.IO STAFF');
  const footer = normalizeDistinguishmentText(distinguishment.footer);
  const isAlumni = distinguishment.detail === 'alumni';
  const displayTitle = isAlumni && footer
    ? `${title}: ${footer}`
    : title;

  return `
   <g class="legacyBannerFont">
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${theme.outerFill}"/>
    <rect x="${x + 2}" y="${y + 2}" width="${width - 4}" height="${height - 4}" fill="${theme.innerFill}" stroke="${theme.border}" stroke-width="2"/>
    <rect x="${x + 2}" y="${y + 7}" width="${width - 4}" height="2" fill="${theme.accent}"/>
    <rect x="${x + 2}" y="${y + height - 9}" width="${width - 4}" height="2" fill="${theme.accent}"/>
    <polygon points="${renderStaffBannerPanelPoints(x + 12, y + 8, 146, height - 16, false)}" fill="${theme.panelFill}" opacity="0.24"/>
    <polygon points="${renderStaffBannerPanelPoints(x + width - 158, y + 8, 146, height - 16, true)}" fill="${theme.panelFill}" opacity="0.24"/>
    ${renderStaffBannerPanelLines(x + 20, y + 9, 120, height - 18, theme.panelLine, false)}
    ${renderStaffBannerPanelLines(x + width - 140, y + 9, 120, height - 18, theme.panelLine, true)}
    <text x="${x + width / 2}" y="${y + (isAlumni ? 35 : 31)}" text-anchor="middle" font-size="${isAlumni ? 18 : 17}" font-weight="900" fill="${theme.titleFill}" stroke="${theme.titleStroke}" stroke-width="1" paint-order="stroke fill" letter-spacing="0.9">${escapeXml(displayTitle)}</text>
    ${!isAlumni && footer ? `<text x="${x + width / 2}" y="${y + 46}" text-anchor="middle" font-size="14" font-weight="900" fill="${theme.footerFill}" letter-spacing="0.35">${escapeXml(footer)}</text>` : ''}
  </g>`;
}

function renderChampionDistinguishmentBanner(distinguishment, y, x = 14, width = 932) {
  const height = 62;
  const theme = getChampionDistinguishmentTheme(distinguishment.detail);
  const title = normalizeDistinguishmentText(distinguishment.text || 'CHAMPION');
  const idSuffix = `champion-${String(distinguishment.detail || 'default').replace(/[^a-z0-9_-]/gi, '')}-${Math.round(y)}`;
  const outerInsetY = 11;
  const outerNotch = 13;
  const innerInsetX = 8;
  const innerNotch = 16;
  const outerPoints = [
    formatPoint([x, y + outerInsetY]),
    formatPoint([x + outerNotch, y + height / 2]),
    formatPoint([x, y + height - outerInsetY]),
    formatPoint([x + width, y + height - outerInsetY]),
    formatPoint([x + width - outerNotch, y + height / 2]),
    formatPoint([x + width, y + outerInsetY]),
  ].join(' ');
  const innerX = x + innerInsetX;
  const innerWidth = width - innerInsetX * 2;
  const innerPoints = [
    formatPoint([innerX, y]),
    formatPoint([innerX + innerNotch, y + height / 2]),
    formatPoint([innerX, y + height]),
    formatPoint([innerX + innerWidth, y + height]),
    formatPoint([innerX + innerWidth - innerNotch, y + height / 2]),
    formatPoint([innerX + innerWidth, y]),
  ].join(' ');

  return `
  <g class="legacyBannerFont">
    <defs>
      <linearGradient id="${idSuffix}-outer" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="${theme.caa}"/>
        <stop offset="0.5" stop-color="${theme.ca}"/>
        <stop offset="0.5" stop-color="${theme.cb}"/>
        <stop offset="1" stop-color="${theme.cbb}"/>
      </linearGradient>
      <radialGradient id="${idSuffix}-inner" cx="0.5" cy="0.5" r="0.78">
        <stop offset="0" stop-color="${theme.cx}"/>
        <stop offset="1" stop-color="${theme.cy}"/>
      </radialGradient>
      <linearGradient id="${idSuffix}-sheen" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.06"/>
        <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.09"/>
        <stop offset="0.5" stop-color="#000000" stop-opacity="0.06"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0.09"/>
      </linearGradient>
      <linearGradient id="${idSuffix}-stripe" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="${theme.ca}"/>
        <stop offset="1" stop-color="${theme.cb}"/>
      </linearGradient>
      <clipPath id="${idSuffix}-innerClip">
        <polygon points="${innerPoints}"/>
      </clipPath>
    </defs>
    <polygon points="${outerPoints}" fill="url(#${idSuffix}-outer)"/>
    <polygon points="${innerPoints}" fill="url(#${idSuffix}-inner)"/>
    <polygon points="${innerPoints}" fill="url(#${idSuffix}-sheen)"/>
    <g clip-path="url(#${idSuffix}-innerClip)">
      <rect x="${innerX}" y="${y + 5}" width="${innerWidth}" height="3" fill="url(#${idSuffix}-stripe)"/>
      <rect x="${innerX}" y="${y + height - 8}" width="${innerWidth}" height="3" fill="url(#${idSuffix}-stripe)"/>
    </g>
    <text x="${x + width / 2}" y="${y + height / 2 + 3}" text-anchor="middle" dominant-baseline="middle" font-size="28.8" font-weight="900" fill="${theme.cy}" opacity="0.34" letter-spacing="5.6">${escapeXml(title)}</text>
    <text x="${x + width / 2}" y="${y + height / 2 + 3}" text-anchor="middle" dominant-baseline="middle" font-size="28.8" font-weight="900" fill="${theme.cyyy}" stroke="${theme.cyyy}" stroke-width="0.8" paint-order="stroke fill" letter-spacing="5.6">${escapeXml(title)}</text>
<text x="${x + width / 2}" y="${y + height / 2 + 1}" text-anchor="middle" dominant-baseline="middle" font-size="28.8" font-weight="900" fill="${theme.cyy}" stroke="${theme.cyy}" stroke-width="0.6" paint-order="stroke fill" letter-spacing="5.6">${escapeXml(title)}</text>
  </g>`;
}

function renderTwcDistinguishmentBanner(distinguishment, y, x = 14, width = 932) {
  const height = 62;
  const detail = normalizeDistinguishmentText(distinguishment.detail);
  const subtitle = detail
    ? `${detail} TETR.IO WORLD CHAMPIONSHIP`
    : 'TETR.IO WORLD CHAMPIONSHIP';

  return `
  <g class="legacyBannerFont">
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#25130a"/>
    <rect x="${x + 3}" y="${y + 3}" width="${width - 6}" height="${height - 6}" fill="#40200d" stroke="#ffb12a" stroke-width="2"/>
    <rect x="${x + 3}" y="${y + 3}" width="${width - 6}" height="${height - 6}" fill="none" stroke="#ffe08b" stroke-width="1" opacity="0.72"/>
    <polygon points="${renderStaffBannerPanelPoints(x + 18, y + 10, 170, height - 20, false)}" fill="#7a3f11" opacity="0.22"/>
    <polygon points="${renderStaffBannerPanelPoints(x + width - 188, y + 10, 170, height - 20, true)}" fill="#7a3f11" opacity="0.22"/>
    ${renderStaffBannerPanelLines(x + 26, y + 11, 136, height - 22, '#ffcf6a', false)}
    ${renderStaffBannerPanelLines(x + width - 162, y + 11, 136, height - 22, '#ffcf6a', true)}
    <text x="${x + width / 2}" y="${y + 30}" text-anchor="middle" font-size="22" font-weight="900" fill="#fff6dc" stroke="#5e2800" stroke-width="1.2" paint-order="stroke fill" letter-spacing="1.1">TETR.IO WORLD CHAMPION</text>
    <text x="${x + width / 2}" y="${y + 46}" text-anchor="middle" font-size="13.5" font-weight="900" fill="#ffd86f" letter-spacing="0.55">${escapeXml(subtitle)}</text>
  </g>`;
}

function renderGenericDistinguishmentBanner(distinguishment, y, x = 14, width = 932) {
  const height = 62;
  const title = normalizeDistinguishmentText(distinguishment.text || distinguishment.header || 'SPECIAL DISTINGUISHMENT');
  const subtitle = normalizeDistinguishmentText(distinguishment.footer || '');

  return `
  <g class="legacyBannerFont">
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#10261d"/>
    <rect x="${x + 2}" y="${y + 2}" width="${width - 4}" height="${height - 4}" fill="#183329" stroke="#7ec98d" stroke-width="2"/>
    <rect x="${x + 2}" y="${y + 7}" width="${width - 4}" height="2" fill="#b6ffb0" opacity="0.88"/>
    <rect x="${x + 2}" y="${y + height - 9}" width="${width - 4}" height="2" fill="#b6ffb0" opacity="0.88"/>
    <text x="${x + width / 2}" y="${y + (subtitle ? 30 : 36)}" text-anchor="middle" font-size="${subtitle ? 22 : 24}" font-weight="900" fill="#f4fff2" stroke="#163524" stroke-width="0.9" paint-order="stroke fill" letter-spacing="1">${escapeXml(title)}</text>
    ${subtitle ? `<text x="${x + width / 2}" y="${y + 46}" text-anchor="middle" font-size="13.5" font-weight="900" fill="#b8efb8" letter-spacing="0.4">${escapeXml(subtitle)}</text>` : ''}
  </g>`;
}

function renderStaffBannerPanelPoints(x, y, width, height, alignRight = false) {
  const inset = Math.min(36, Math.max(12, width * 0.24));

  return alignRight
    ? [
        formatPoint([x, y]),
        formatPoint([x + width, y]),
        formatPoint([x + width, y + height]),
        formatPoint([x + inset, y + height]),
      ].join(' ')
    : [
        formatPoint([x, y]),
        formatPoint([x + width - inset, y]),
        formatPoint([x + width, y + height]),
        formatPoint([x, y + height]),
      ].join(' ');
}

function renderStaffBannerPanelLines(x, y, width, height, color, alignRight = false) {
  const step = 28;
  const length = 24;
  let markup = '';

  for (let index = 0; index < 5; index += 1) {
    const offset = index * step;
    if (alignRight) {
      const x1 = x + width - offset;
      const x2 = x1 - length;
      markup += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y + height}" stroke="${color}" stroke-width="6" opacity="0.18"/>`;
      continue;
    }

    const x1 = x + offset;
    const x2 = x1 + length;
    markup += `<line x1="${x1}" y1="${y + height}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="6" opacity="0.18"/>`;
  }

  return `<g>${markup}</g>`;
}

function getStaffDistinguishmentTheme(detail) {
  switch (detail) {
    case 'founder':
      return {
        outerFill: '#120b14',
        innerFill: '#1a121c',
        border: '#ffbbd7',
        accent: '#ffd6ec',
        panelFill: '#ff77be',
        panelLine: '#fff2fa',
        titleFill: '#fff7ff',
        titleStroke: '#7c1e73',
        footerFill: '#ffe6f5',
      };
    case 'kagarin':
      return {
        outerFill: '#130c10',
        innerFill: '#1c1214',
        border: '#ffb090',
        accent: '#ffd4c3',
        panelFill: '#ff6f7e',
        panelLine: '#ffe6ea',
        titleFill: '#fff7f4',
        titleStroke: '#7e2a21',
        footerFill: '#ffe0d2',
      };
    case 'administrator':
      return {
        outerFill: '#170b12',
        innerFill: '#211118',
        border: '#ff8bb1',
        accent: '#ffc8dd',
        panelFill: '#ff5e92',
        panelLine: '#ffe3ef',
        titleFill: '#fff8fb',
        titleStroke: '#8a234e',
        footerFill: '#ffd7e5',
      };
    case 'globalmod':
      return {
        outerFill: '#110b18',
        innerFill: '#191325',
        border: '#c595ff',
        accent: '#ebd7ff',
        panelFill: '#9d63ff',
        panelLine: '#f1e7ff',
        titleFill: '#fbf8ff',
        titleStroke: '#51248b',
        footerFill: '#e8d8ff',
      };
    case 'communitymod':
      return {
        outerFill: '#09121a',
        innerFill: '#101b27',
        border: '#8cc8ff',
        accent: '#d9efff',
        panelFill: '#5f97ff',
        panelLine: '#ebf5ff',
        titleFill: '#f7fbff',
        titleStroke: '#284e8e',
        footerFill: '#d4e8ff',
      };
    case 'alumni':
      return {
        outerFill: '#0d111d',
        innerFill: '#12192b',
        border: '#8f9eff',
        accent: '#d6dbff',
        panelFill: '#5d6ce0',
        panelLine: '#edf0ff',
        titleFill: '#fafbff',
        titleStroke: '#31408f',
        footerFill: '#d9ddff',
      };
    case 'team-minor':
      return {
        outerFill: '#171106',
        innerFill: '#21180a',
        border: '#f6cc62',
        accent: '#ffe6a6',
        panelFill: '#eea434',
        panelLine: '#fff0c4',
        titleFill: '#fff6dc',
        titleStroke: '#7d5410',
        footerFill: '#ffe5a4',
      };
    case 'team':
    default:
      return {
        outerFill: '#161206',
        innerFill: '#20190a',
        border: '#f0c34d',
        accent: '#ffdf8c',
        panelFill: '#c48724',
        panelLine: '#ffe5a0',
        titleFill: '#ffd25e',
        titleStroke: '#5f3500',
        footerFill: '#ffd772',
      };
  }
}

function getChampionDistinguishmentTheme(detail) {
  switch (detail) {
    case '40l':
      return {
        caa: '#FFD74A',
        ca: '#EFC01B',
        cb: '#BD9817',
        cbb: '#8F710A',
        cx: '#CCF5F6',
        cy: '#84B7CA',
        cyy: '#638B8C',
        cyyy: '#CAEDEF',
      };
    case 'blitz':
      return {
        caa: '#FF4E4A',
        ca: '#EF2F1B',
        cb: '#BD2717',
        cbb: '#8F130A',
        cx: '#CCF5F6',
        cy: '#84B7CA',
        cyy: '#638B8C',
        cyyy: '#CAEDEF',
      };
    case 'league':
      return {
        caa: '#F46BEF',
        ca: '#E64BE1',
        cb: '#B631B1',
        cbb: '#80227D',
        cx: '#FFDB31',
        cy: '#FFA200',
        cyy: '#C18922',
        cyyy: '#FFE492',
      };
    case 'x-multiple':
      return {
        caa: '#7d79d9',
        ca: '#6650c8',
        cb: '#4d3ca1',
        cbb: '#342873',
        cx: '#FFDB31',
        cy: '#FFA200',
        cyy: '#C18922',
        cyyy: '#FFE492',
      };
    default:
      return {
        caa: '#CCF5F6',
        ca: '#C2E6E7',
        cb: '#ACD5D6',
        cbb: '#84B7CA',
        cx: '#FFDB31',
        cy: '#FFA200',
        cyy: '#C18922',
        cyyy: '#FFE492',
      };
  }
}

function getCountryFlag(country, image) {
  const code = normalizeCountryCode(country);
  return code && image
    ? { code, image }
    : null;
}

function adjustHeaderFlagNameWidth(text, measuredWidth, fontSize) {
  const rawText = String(text ?? '').toUpperCase();
  const underscoreCount = (rawText.match(/_/g) ?? []).length;
  const leadingUnderscoreCount = rawText.match(/^_*/)?.[0]?.length ?? 0;

  // 언더바 없음: 측정폭이 실제보다 살짝 크게 잡혀서 국기가 멀어짐
  if (underscoreCount === 0) {
    return measuredWidth - fontSize * 0.28;
  }

  // _ILIS 같은 케이스: 시작 언더바 1개는 국기가 너무 가까움
  if (leadingUnderscoreCount === 1 && underscoreCount === 1) {
    return measuredWidth + fontSize * 0.12;
  }

  // ___NEKO 같은 케이스: 언더바가 여러 개면 폭이 과하게 커짐
  if (underscoreCount >= 2) {
    return measuredWidth - fontSize * (0.12 + 0.10 * underscoreCount);
  }

  // TENDO_ARISU 같은 일반 1개 언더바 케이스
  return measuredWidth;
}

function renderHeaderFlag(flag, x, y) {
  if (!flag?.image) {
    return '';
  }

  return `<image href="${flag.image}" x="${x}" y="${y}" width="32" height="18" preserveAspectRatio="xMidYMid meet"/>`;
}

async function measureHeaderNameWidth(text, fontSize, fontDataUri = null, fontWeight = 700) {
  const normalizedText = String(text ?? '').trim();
  if (!normalizedText) {
    return 0;
  }

  const cacheKey = [
    'header-v2',
    fontSize,
    fontWeight,
    fontDataUri ? fontDataUri.length : 0,
    normalizedText,
  ].join('|');

  if (headerNameWidthCache.has(cacheKey)) {
    return headerNameWidthCache.get(cacheKey);
  }

  const fallbackWidth = estimateHeaderNameWidth(normalizedText, fontSize);

  try {
    const horizontalPadding = 48;
    const verticalPadding = 36;
    const svgWidth = Math.max(
      320,
      Math.ceil(fallbackWidth + horizontalPadding * 2 + fontSize * 4),
    );
    const svgHeight = Math.max(
      128,
      Math.ceil(fontSize + verticalPadding * 2),
    );
    const baselineY = verticalPadding + fontSize * 0.82;

    const measurementSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
  <defs>
    <style>
      ${renderTetrioFontFace(fontDataUri)}
      text { font-family: ${cardFontFamily}; letter-spacing: 0; ${renderTetrioTextWeightCss()} }
    </style>
  </defs>
  <rect width="${svgWidth}" height="${svgHeight}" fill="transparent"/>
  <text x="${horizontalPadding}" y="${baselineY}" font-family="${escapeXml(cardFontFamily)}" font-size="${fontSize}" font-weight="${fontWeight}" fill="#ffffff" xml:space="preserve">${renderHeaderUsernameInlineMarkup(normalizedText, fontSize)}</text>
</svg>`;

    const { info } = await sharp(renderTetrioSvgToPng(measurementSvg, 1))
      .png()
      .trim()
      .toBuffer({ resolveWithObject: true });

    const trimOffsetLeft = Number.isFinite(info.trimOffsetLeft)
      ? info.trimOffsetLeft
      : horizontalPadding;

    const width = Math.max(
      0,
      Math.ceil(trimOffsetLeft + info.width - horizontalPadding),
    );

    cacheMeasuredTextWidth(headerNameWidthCache, cacheKey, width);
    return width;
  } catch (error) {
    console.warn('[HEADER WIDTH FALLBACK]', normalizedText, error?.message ?? error);
    cacheMeasuredTextWidth(headerNameWidthCache, cacheKey, fallbackWidth);
    return fallbackWidth;
  }
}

function getHeaderUnderscoreMetrics(fontSize) {
  return {
    width: getHeaderCharUnits('_') * fontSize * 1.7,
    height: Math.max(5.0, fontSize * 0.11),
    beforeGap: fontSize * 0.10,
    afterGap: fontSize * 0.15,
  };
}

async function measureRenderedHeaderUsernameWidth({
  text,
  fontSize,
  fontDataUri,
  fontWeight,
}) {
  const rawText = String(text ?? '').toUpperCase();

  return measureHeaderNameWidth(
    rawText,
    fontSize,
    fontDataUri,
    fontWeight,
  );
}

function renderHeaderUsernameInlineMarkup(text, fontSize) {
  const rawText = String(text ?? '').toUpperCase();
  const parts = rawText.split(/(_+)/);

  const underscoreShiftEm = -0.26;        // 높이. 낮으면 -0.38, 높으면 -0.30
  const underscoreDxEm = 0.08;            // 왼쪽으로 당기지 말고 살짝 오른쪽
  const underscoreLetterSpacingEm = 0.18; // 언더바 사이 간격

  let needsBaselineRestore = false;

  return parts.map((part) => {
    if (!part) {
      return '';
    }

    if (/^_+$/.test(part)) {
      needsBaselineRestore = true;

      return `<tspan font-family="Arial" font-size="1em" font-weight="900" dy="${underscoreShiftEm}em" dx="${underscoreDxEm}em" letter-spacing="${underscoreLetterSpacingEm}em">${escapeXml(part)}</tspan>`;
    }

    const restoreDy = needsBaselineRestore
      ? ` dy="${Math.abs(underscoreShiftEm)}em"`
      : '';

    needsBaselineRestore = false;

    return `<tspan${restoreDy}>${renderTetrioTextMarkup(part)}</tspan>`;
  }).join('');
}


async function renderHeaderUsernameMarkup({
  className,
  fontSize,
  fontWeight,
  text,
  x,
  y,
}) {
  const rawText = String(text ?? '').toUpperCase();

  return `<text x="${x}" y="${y}" class="${className}" font-size="${fontSize}" font-weight="${fontWeight}" xml:space="preserve">${renderHeaderUsernameInlineMarkup(rawText, fontSize)}</text>`;
}

function getHeaderUnderscorePullback(previousChar, fontSize) {
  const char = String(previousChar ?? '').toUpperCase();

  // _ILIS 같은 시작 언더바는 오른쪽으로 밀어야 하니까 유지
  if (!char) {
    return fontSize * -0.12;
  }

  // HEBI_, AIRI_ 같은 I 뒤 언더바는 거의 당기면 안 됨
  if (char === 'I' || char === '1') {
    return fontSize * 0.02;
  }

  if (char === 'L' || char === 'J') {
    return fontSize * 0.07;
  }

  // TENDO_ 같은 일반 케이스는 더 왼쪽으로 당김
  return fontSize * 0.28;
}

function estimateHeaderNameWidth(username, fontSize) {
  const text = String(username ?? '').toUpperCase();
  let units = 0;

  for (const char of text) {
    units += getHeaderCharUnits(char);
  }

  return Math.max(0, units * fontSize);
}

function getHeaderCharUnits(char) {
  if (char === 'M' || char === 'W') {
    return 0.72;
  }

  if (char === 'I' || char === 'J' || char === '1') {
    return 0.32;
  }

  if (char === '_' || char === '-' || char === '.') {
    return 0.32;
  }

  if (char === 'O' || char === 'Q' || char === '0') {
    return 0.66;
  }

  if (/[CDGRU]/.test(char)) {
    return 0.58;
  }

  if (/[FJLPTVY]/.test(char)) {
    return 0.5;
  }

  if (/[2-9]/.test(char)) {
    return 0.54;
  }

  if (/[A-HK-NS-XZ]/.test(char)) {
    return 0.55;
  }

  return 0.55;
}

const levelBadgeGradients = [
  ['#A9A9A9', '#C9C9C9', '#E4E4E4', '#C3C3C3'],
  ['#BC3535', '#FD3535', '#FF6D6D', '#F02D2D'],
  ['#BB6A34', '#F56200', '#FFA162', '#EF7320'],
  ['#C6B734', '#E9D41E', '#EDDE5F', '#E9D41E'],
  ['#82B933', '#90DD21', '#B5F856', '#90DD21'],
  ['#31B951', '#23EE53', '#7DF89A', '#23EE53'],
  ['#31A89B', '#22F0DA', '#8AFDF1', '#22F0DA'],
  ['#31599B', '#1F6CEC', '#84B2FE', '#1F6CEC'],
  ['#673ABA', '#8644FF', '#BB96FF', '#8644FF'],
  ['#AA35AB', '#E81BEA', '#FEA4FF', '#E81BEA'],
];

const levelShapeGradients = [
  ['#C9C9C9', '#E4E4E4', '#C9C9C9'],
  ['#FD3535', '#FF6D6D', '#FD3535'],
  ['#F56200', '#FFA162', '#F56200'],
  ['#E9D41E', '#EDDE5F', '#E9D41E'],
  ['#90DD21', '#B5F856', '#90DD21'],
  ['#23EE53', '#7DF89A', '#23EE53'],
  ['#22F0DA', '#8AFDF1', '#22F0DA'],
  ['#1F6CEC', '#84B2FE', '#1F6CEC'],
  ['#8644FF', '#BB96FF', '#8644FF'],
  ['#E81BEA', '#FEA4FF', '#E81BEA'],
];

function renderLevelTagGradients() {
  const badgeGradients = levelBadgeGradients.map((colors, index) => `
    <linearGradient id="levelBadge${index}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${colors[0]}"/>
      <stop offset="50%" stop-color="${colors[1]}"/>
      <stop offset="50%" stop-color="${colors[2]}"/>
      <stop offset="100%" stop-color="${colors[3]}"/>
    </linearGradient>`).join('');
  const shapeGradients = levelShapeGradients.map((colors, index) => `
    <linearGradient id="levelShape${index}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${colors[0]}"/>
      <stop offset="50%" stop-color="${colors[1]}"/>
      <stop offset="100%" stop-color="${colors[2]}"/>
    </linearGradient>`).join('');

  return `${badgeGradients}${shapeGradients}
    <linearGradient id="levelBadgeGolden" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#FFD800"/>
      <stop offset="50%" stop-color="#FFFFFF"/>
      <stop offset="50%" stop-color="#FF7800"/>
      <stop offset="100%" stop-color="#FFD800"/>
    </linearGradient>
    <linearGradient id="levelShapeGolden" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#88BAD9"/>
      <stop offset="50%" stop-color="#FFFFFF"/>
      <stop offset="50%" stop-color="#776DDC"/>
      <stop offset="100%" stop-color="#BBB5F0"/>
    </linearGradient>`;
}

function getLevelTag(xp) {
  const rawLevel = xpToLevel(xp);
  const level = Number.isFinite(rawLevel) ? Math.max(0, Math.floor(rawLevel)) : 0;
  const text = String(level);
  const width = text.length * 12 + 52;

  return {
    level,
    text,
    shape: Math.floor(level / 100) % 5,
    shapeColor: Math.floor(level / 10) % 10,
    badgeColor: Math.floor(level / 500) % 10,
    golden: level >= 5000,
    nullTag: !Number.isFinite(xp) || xp < 0,
    width,
  };
}

function renderLevelTag(tag, x, y) {
  const height = levelTagHeight;
  const unit = 21;
  const bodyWidth = tag.width - 21;
  const itemX = bodyWidth - unit * 0.5;
  const fill = tag.golden ? 'url(#levelBadgeGolden)' : (tag.nullTag ? '#111111' : `url(#levelBadge${tag.badgeColor})`);
  const itemFill = tag.golden ? 'url(#levelShapeGolden)' : (tag.nullTag ? '#111111' : `url(#levelShape${tag.shapeColor})`);
  const textFill = tag.golden || tag.nullTag || [1, 7, 8, 9].includes(tag.badgeColor) ? '#ffffff' : '#111111';
  const textOpacity = tag.nullTag ? 0.55 : 0.9;

  return `
  <g transform="translate(${x} ${y})">
    <polygon points="${getLevelTagBodyPoints(tag.golden ? 'golden' : tag.shape, bodyWidth, height, unit)}" fill="${fill}" opacity="${tag.nullTag ? 0.65 : 1}"/>
    <polygon points="${getLevelTagItemPoints(tag.golden ? 'golden' : tag.shape, itemX, height, unit)}" fill="${itemFill}" opacity="${tag.nullTag ? 0.65 : 1}"/>
    <text
  x="8.5"
  y="22.6"
  font-size="22"
  font-weight="950"
  fill="${textFill}"
  stroke="${textFill}"
  stroke-width="0.55"
  stroke-linejoin="round"
  paint-order="stroke fill"
  opacity="1"
>${escapeXml(tag.text)}</text>
  </g>`;
}

function renderFeaturedAchievements(achievements = [], x, y) {
  const visibleAchievements = achievements.filter(Boolean).slice(0, 3);
  if (visibleAchievements.length === 0) {
    return '';
  }

  const iconSize = 48;
  const gap = 4;

  return `
  <g filter="url(#featuredAchievementShadow)">
    ${visibleAchievements.map((achievement, index) =>
      renderFeaturedAchievementIcon(achievement, x + index * (iconSize + gap), y, iconSize)
    ).join('')}
  </g>`;
}

function renderFeaturedAchievementIcon(achievement, x, y, size) {
  const innerSize = roundSvgNumber(size * achievementIconInnerScale);
  const innerOffset = roundSvgNumber(size * achievementIconInnerOffsetScale);

  return `
    <g transform="translate(${roundSvgNumber(x)} ${roundSvgNumber(y)})">
      <rect x="${innerOffset - 1}" y="${innerOffset - 1}" width="${innerSize + 2}" height="${innerSize + 2}" rx="2" fill="#171f19" opacity="0.58"/>
      ${achievement.frame ? `<image href="${achievement.frame}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>` : `<rect x="0" y="0" width="${size}" height="${size}" rx="4" fill="none" stroke="#9cd69e" stroke-width="2"/>`}
      ${achievement.wreath ? `<image href="${achievement.wreath}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>` : ''}
      ${achievement.icon ? `<image href="${achievement.icon}" x="${innerOffset}" y="${innerOffset}" width="${innerSize}" height="${innerSize}" preserveAspectRatio="xMidYMid meet" opacity="0.88"/>` : ''}
    </g>`;
}

function getLevelTagBodyPoints(shape, width, height, unit) {
  const l = unit * 0.2;
  const bottomLeft = height - unit * 0.2;

  if (shape === 'golden') {
    return [
      [l, 0],
      [width - unit * 0.7, 0],
      [width - unit * 0.35, height / 2],
      [width - unit * 0.7, height],
      [l, height],
      [0, bottomLeft],
      [0, unit * 0.2],
    ].map(formatPoint).join(' ');
  }

  if (shape === 2 || shape === 3) {
    const notch = shape === 2 ? unit * 0.6 : unit * 0.5;
    return [
      [l, 0],
      [width, 0],
      [width - notch, height / 2],
      [width, height],
      [l, height],
      [0, bottomLeft],
      [0, unit * 0.2],
    ].map(formatPoint).join(' ');
  }

  if (shape === 4) {
    return [
      [l, 0],
      [width, 0],
      [width - unit * 0.4, height * 0.3],
      [width - unit * 0.4, height * 0.7],
      [width, height],
      [l, height],
      [0, bottomLeft],
      [0, unit * 0.2],
    ].map(formatPoint).join(' ');
  }

  return [
    [l, 0],
    [width, 0],
    [width - unit * 0.7, height],
    [l, height],
    [0, bottomLeft],
    [0, unit * 0.2],
  ].map(formatPoint).join(' ');
}

function getLevelTagItemPoints(shape, x, height, unit) {
  const points = shape === 'golden'
    ? [[0, 0], [unit * 0.3, 0], [unit * 0.65, height / 2], [unit * 0.3, height], [0, height], [unit * 0.3, height / 2]]
    : [
      [[unit * 0.7, 0], [unit, 0], [unit * 0.3, height], [0, height]],
      [[unit * 0.7, 0], [unit * 1.4, height], [0, height]],
      [[unit * 0.7, 0], [unit * 0.1, height / 2], [unit * 0.7, height], [unit * 1.3, height / 2]],
      [[unit * 0.7, 0], [unit * 0.2, height / 2], [unit * 0.7, height], [unit * 1.2, height * 0.75], [unit * 1.2, height * 0.25]],
      [[unit * 0.75, 0], [unit * 0.25, height * 0.3], [unit * 0.25, height * 0.7], [unit * 0.75, height], [unit * 1.25, height * 0.7], [unit * 1.25, height * 0.3]],
    ][shape];

  return points.map(([pointX, pointY]) => formatPoint([x + pointX, pointY])).join(' ');
}

function formatPoint([x, y]) {
  return `${roundSvgNumber(x)},${roundSvgNumber(y)}`;
}

function roundSvgNumber(value) {
  return Number(value.toFixed(2));
}

function getBadgeLayout(badgeCount, width = 888) {
  const iconSize = 30;
  const gap = 5;
  const padding = 10;
  const inset = 6;
  const badgesPerRow = 25;
  const step = badgesPerRow > 1
    ? (width - inset * 2 - iconSize) / (badgesPerRow - 1)
    : 0;
  const rowCount = Math.max(1, Math.ceil(badgeCount / badgesPerRow));
  const boxHeight = rowCount * iconSize + (rowCount - 1) * gap + padding * 2;

  return {
    badgesPerRow,
    boxHeight,
    gap,
    iconSize,
    inset,
    padding,
    rowCount,
    step,
  };
}

function renderBadgeRow(badges, badgeIcons, y, x = 36, width = 888, layout = getBadgeLayout(badges.length, width)) {
  const { badgesPerRow, boxHeight, gap, iconSize, inset, padding, step } = layout;
  const boxY = y - padding;
  const textX = x + 12;

  if (badges.length === 0) {
    return `
  <g>
    <rect x="${x}" y="${boxY}" width="${width}" height="${boxHeight}" fill="${tetrioPalette.panelBg}" stroke="${tetrioPalette.panelBorder}" stroke-width="2"/>
    <text x="${textX}" y="${y + 18}" font-size="22" font-weight="900" fill="#68a66d">NO BADGES</text>
  </g>`;
  }

  return `
  <g>
    <rect x="${x}" y="${boxY}" width="${width}" height="${boxHeight}" fill="${tetrioPalette.panelBg}" stroke="${tetrioPalette.panelBorder}" stroke-width="2"/>
    ${badges.map((badge, index) => {
      const icon = badgeIcons?.[badge.id];
      const row = Math.floor(index / badgesPerRow);
      const column = index % badgesPerRow;
      const iconX = roundSvgNumber(x + inset + column * step);
      const iconY = y + row * (iconSize + gap);
      return icon
        ? `<image href="${icon}" x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" preserveAspectRatio="xMidYMid meet"/>`
        : `<rect x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" fill="#284f2d" stroke="#6da774" stroke-width="2"/>`;
    }).join('')}
  </g>`;
}

function renderBio(lines, emojiAssets, y, height, x = 36, width = 888) {
  if (lines.length === 0) {
    return '';
  }

  const textX = x + 12;
  const firstBaselineY = y + bioTextBaselineOffsetY;

  return `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${tetrioPalette.panelBg}"/>
    <rect x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${height - 2}" fill="none" stroke="${tetrioPalette.panelBorder}" stroke-width="2"/>
    <text x="${textX}" y="${y + 19}" class="bioTitle" font-size="14.5" font-weight="900">ABOUT ME</text>
    <g clip-path="url(#bioClip)">
      ${lines.map((line, index) => renderBioLine(line, emojiAssets, textX, firstBaselineY + index * bioTextLineHeight)).join('')}
    </g>
  </g>`;
}

function renderBioTextMarkup(value) {
  return String(value ?? '')
    .split('')
    .map((char) => {
      if (/[a-z_@#:/.]/.test(char)) {
        return `<tspan font-family="Arial" font-weight="900" stroke="none">${escapeXml(char)}</tspan>`;
      }

      return escapeXml(char);
    })
    .join('');
}

function renderBioLine(line, emojiAssets, x, baselineY) {
  const parts = [];
  let cursorX = x;
  let textRun = '';
  let textRunX = cursorX;

  const flushTextRun = () => {
    if (!textRun) {
      return;
    }

    parts.push(
  `<text x="${roundSvgNumber(textRunX)}" y="${roundSvgNumber(baselineY)}" class="bioText" font-size="${bioTextFontSize}" font-weight="800">${escapeXml(textRun)}</text>`
);
    textRun = '';
  };

  for (const grapheme of splitGraphemes(line)) {
    const emojiCode = getTwemojiCode(grapheme);
    const emoji = emojiCode ? emojiAssets?.[emojiCode] : null;
    const graphemeWidth = getBioGraphemeWidth(grapheme);

    if (emoji) {
      flushTextRun();
      parts.push(`<image href="${emoji}" x="${roundSvgNumber(cursorX)}" y="${roundSvgNumber(baselineY - bioEmojiSize + 2)}" width="${bioEmojiSize}" height="${bioEmojiSize}" preserveAspectRatio="xMidYMid meet"/>`);
    } else {
      if (!textRun) {
        textRunX = cursorX;
      }

      textRun += grapheme;
    }

    cursorX += graphemeWidth;
  }

  flushTextRun();
  return parts.join('');
}

async function fetchBioEmojiAssets(lines) {
  const emojiCodes = new Set();

  for (const line of lines) {
    for (const grapheme of splitGraphemes(line)) {
      const emojiCode = getTwemojiCode(grapheme);
      if (emojiCode) {
        emojiCodes.add(emojiCode);
      }
    }
  }

  if (emojiCodes.size === 0) {
    return {};
  }

  const entries = await Promise.all([...emojiCodes].map(async (emojiCode) => [
    emojiCode,
    await fetchImageDataUri(`${twemojiBaseUrl}/${emojiCode}.png`),
  ]));

  return Object.fromEntries(entries.filter(([, image]) => Boolean(image)));
}

function splitGraphemes(text) {
  const value = String(text ?? '');
  if (!value) {
    return [];
  }

  return graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(value), ({ segment }) => segment)
    : Array.from(value);
}

function containsBioEmoji(text) {
  return splitGraphemes(text).some((grapheme) => Boolean(getTwemojiCode(grapheme)));
}

function containsJapaneseKana(text) {
  return /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/u.test(String(text ?? ''));
}

function containsCjkBioText(text) {
  return /[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u31f0-\u31ff\u3400-\u9fff\uf900-\ufaff\uff66-\uff9f\uac00-\ud7af]/u.test(String(text ?? ''));
}

function getTwemojiCode(grapheme) {
  if (!isBioEmojiGrapheme(grapheme)) {
    return null;
  }

  return Array.from(grapheme)
    .map((char) => char.codePointAt(0))
    .filter((codePoint) => codePoint !== 0xfe0f)
    .map((codePoint) => codePoint.toString(16))
    .join('-');
}

function isBioEmojiGrapheme(grapheme) {
  const text = String(grapheme ?? '');
  if (!text) {
    return false;
  }

  return emojiPresentationPattern.test(text)
    || extendedPictographicPattern.test(text)
    || isKeycapEmoji(text)
    || isRegionalIndicatorEmoji(text);
}

function isKeycapEmoji(text) {
  return /^[0-9#*]\ufe0f?\u20e3$/u.test(text);
}

function isRegionalIndicatorEmoji(text) {
  const codePoints = Array.from(text).map((char) => char.codePointAt(0));
  return codePoints.length === 2 && codePoints.every((codePoint) => (
    codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff
  ));
}

function renderStatCard(x, y, width, label, rank, value, subtext, options = {}) {
  const valueY = y + 58;
  const lineY = y + 68;
  const cardHeight = 92;
  const valueFontSize = options.valueFontSize ?? (String(value).length > 10 ? 21 : 24);
  const iconValueFontSize = valueFontSize;
  const labelX = x + 12;
  const rankLeftX = getRankLabelLeftX(x, width, rank, options);
  const labelFontSize = getStatLabelFontSize(label, rankLeftX - labelX - 7);
  const rankMarkup = renderRankLabel(x, y, width, rank, options);
  const subtextMarkup = options.subtextMarkup
  ?? `<text x="${x + width / 2}" y="${y + 85}" text-anchor="middle" class="sub">${renderStatSubtextMarkup(subtext)}</text>`;
  const valueMarkup = renderStatCardValueMarkup(x, y, width, valueY, value, valueFontSize, iconValueFontSize, options);

  return `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="${cardHeight}" fill="${tetrioPalette.panelBg}"/>
    <rect x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${cardHeight - 2}" fill="none" stroke="${tetrioPalette.panelBorder}" stroke-width="2"/>
    <text x="${labelX}" y="${y + 21}" class="label" font-size="${labelFontSize}">${renderTetrioTextMarkup(label)}</text>
    ${rankMarkup}
    ${valueMarkup}
    <line x1="${x + 28}" y1="${lineY}" x2="${x + width - 28}" y2="${lineY}" stroke="${tetrioPalette.divider}" stroke-width="2"/>
    ${subtextMarkup}
  </g>`;
}

function getStatLabelFontSize(label, maxWidth) {
  const baseFontSize = 13;
  const minFontSize = 9.8;
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
    return minFontSize;
  }

  const estimatedWidth = estimateStatLabelWidth(label, baseFontSize);
  if (estimatedWidth <= maxWidth) {
    return baseFontSize;
  }

  return roundSvgNumber(Math.max(minFontSize, baseFontSize * maxWidth / estimatedWidth));
}

function estimateStatLabelWidth(label, fontSize) {
  const text = String(label ?? '');
  let units = 0;
  let spaces = 0;

  for (const char of text) {
    if (char === ' ') {
      units += 0.3;
      spaces += 1;
    } else if (/\d/.test(char)) {
      units += 0.55;
    } else if (/[A-Z]/.test(char)) {
      units += 0.62;
    } else {
      units += 0.52;
    }
  }

  return units * fontSize + spaces * getWordSpacingPixels(fontSize);
}

function getWordSpacingPixels(fontSize) {
  const rawValue = String(tetrioPhraseWordSpacing ?? '0').trim();
  const numericValue = Number.parseFloat(rawValue);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return rawValue.endsWith('em')
    ? numericValue * fontSize
    : numericValue;
}

function renderStatCardValueMarkup(x, y, width, valueY, value, valueFontSize, iconValueFontSize, options) {
  if (options.valueFormat === 'leagueWithGlicko') {
    return renderLeagueStatValueMarkup(x, width, valueY, value, iconValueFontSize, options);
  }

  if (options.valueFormat === 'timeSplitDecimal') {
    return renderTimedStatValueText(x + width / 2, valueY, value, valueFontSize, 'middle');
  }

  if (options.valueFormat === 'altitudeWithUnit') {
    return renderAltitudeStatValueText(x + width / 2, valueY, value, valueFontSize, options.unitFontSize ?? valueFontSize, 'middle');
  }

  if (!options.valueIcon) {
    if (options.valueAlign === 'right') {
      const valueX = x + width - (options.valuePaddingEnd ?? 24);
      return renderStatValueText(valueX, valueY, value, valueFontSize, 'end');
    }

    return renderStatValueText(x + width / 2, valueY, value, valueFontSize, 'middle');
  }

  if (options.valueAlign === 'center') {
    const iconSize = Math.max(0, (options.valueIconSize ?? 35) - 1);
    const iconGap = options.valueIconGap ?? 8;
    const valueWidth = getRenderedStatValueWidth(value, iconValueFontSize);
    const groupWidth = iconSize + iconGap + valueWidth;
    const groupLeftX = x + (width - groupWidth) / 2;
    const iconX = roundSvgNumber(groupLeftX);
    const iconY = roundSvgNumber(getStatValueVisualBottomY(valueY, iconValueFontSize) - iconSize + 3);
    const valueX = roundSvgNumber(groupLeftX + iconSize + iconGap);
    return `<image href="${options.valueIcon}" x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" preserveAspectRatio="xMidYMax meet"/>
    ${renderStatValueText(valueX, valueY, value, iconValueFontSize, 'start')}`;
  }

  if (options.valueAlign === 'right') {
    const valueX = x + width - (options.valuePaddingEnd ?? 24);
    const iconSize = options.valueIconSize ?? 35;
    const iconGap = options.valueIconGap ?? 8;
    const valueWidth = getRenderedStatValueWidth(value, iconValueFontSize);
    const iconX = roundSvgNumber(valueX - valueWidth - iconGap - iconSize);
    const iconY = roundSvgNumber(getStatValueVisualCenterY(valueY, iconValueFontSize) - iconSize / 2);
    return `<image href="${options.valueIcon}" x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" preserveAspectRatio="xMidYMid meet"/>
    ${renderStatValueText(valueX, valueY, value, iconValueFontSize, 'end')}`;
  }

  return `<image href="${options.valueIcon}" x="${x + 47}" y="${y + 32}" width="35" height="35" preserveAspectRatio="xMidYMid meet"/>
    ${renderStatValueText(x + 86, valueY, value, iconValueFontSize, 'start')}`;
}

function renderStatSubtextMarkup(value) {
  const text = String(value ?? '');
  let markup = '';
  let tightenNext = false;
  let resetDyEm = 0;

  for (const char of text) {
    if (char === '.') {
      markup += `<tspan dy="0.02em" font-family="Arial" font-size="1.22em" stroke="none">.</tspan>`;
      resetDyEm = 0.02;
      tightenNext = false;
      continue;
    }

    const dx = tightenNext && /\d/.test(char) ? ' dx="-0.5em"' : '';
    const dy = resetDyEm ? ` dy="${roundSvgNumber(-resetDyEm)}em"` : '';

    markup += dx || dy
      ? `<tspan${dx}${dy}>${escapeXml(char)}</tspan>`
      : escapeXml(char);

    resetDyEm = 0;
    tightenNext = char === ',';
  }

  return markup;
}

function renderTetrioCardDecimalTextMarkup(value, options = {}) {
  const text = String(value ?? '');
  const dotFontSize = options.dotFontSize ?? '1.4em';
  const dotDyEm = options.dotDyEm ?? 0.02;

  let markup = '';
  let resetDyEm = 0;

  for (const char of text) {
    if (char === '.') {
      markup += `<tspan dy="${dotDyEm}em" font-family="Arial" font-size="${dotFontSize}" stroke="none">.</tspan>`;
      resetDyEm = dotDyEm;
      continue;
    }

    const dy = resetDyEm ? ` dy="${roundSvgNumber(-resetDyEm)}em"` : '';
    markup += dy
      ? `<tspan${dy}>${escapeXml(char)}</tspan>`
      : escapeXml(char);

    resetDyEm = 0;
  }

  return markup;
}

function renderTetrioCardDecimalNumberMarkup(value, options = {}) {
  const text = String(value ?? '');
  const dotFontSize = options.dotFontSize ?? '1.4em';
  const dotDyEm = options.dotDyEm ?? 0.02;

  let markup = '';
  let resetDyEm = 0;
  let tightenNext = false;

  for (const char of text) {
    if (char === '.') {
      markup += `<tspan dy="${dotDyEm}em" font-family="Arial" font-size="${dotFontSize}" stroke="none">.</tspan>`;
      resetDyEm = dotDyEm;
      tightenNext = false;
      continue;
    }

    const dx = tightenNext && /\d/.test(char) ? ' dx="-0.4em"' : '';
    const dy = resetDyEm ? ` dy="${roundSvgNumber(-resetDyEm)}em"` : '';

    markup += dx || dy
      ? `<tspan${dx}${dy}>${escapeXml(char)}</tspan>`
      : escapeXml(char);

    resetDyEm = 0;
    tightenNext = char === ',';
  }

  return markup;
}


function renderLeagueStatValueMarkup(x, width, valueY, value, fontSize, options) {
  const iconSize = Math.max(0, options.valueIconSize ?? 35);
  const iconGap = 6;
  const iconMetrics = getLeagueIconRenderMetrics(options, iconSize);
  const unitFontSize = getTimedDecimalFontSize(fontSize);
  const valueWidth = estimateLeagueMainValueWidth(value, fontSize, unitFontSize);
  const valueNudgeX = 6;
  const valueAuxGap = 6;
  const auxBracketArmLength = 4;
  const auxBracketInnerPaddingX = 2;
  const auxBracketRightPaddingX = 8;
  const glickoText = formatGlickoValue(options.glicko);
  const rdText = formatRdValue(options.rd);
  const glickoTextWidth = estimateLeagueAuxTextWidth(glickoText, 13);
  const auxTextWidth = Math.max(
    glickoTextWidth,
    estimateLeagueRdRowWidth(rdText),
  );
  const auxBlockWidth = (auxBracketArmLength * 2) + (auxBracketInnerPaddingX * 2) + auxTextWidth + auxBracketRightPaddingX;
  const groupWidth = iconMetrics.renderedWidth + iconGap + valueWidth + valueAuxGap + auxBlockWidth;
  const groupLeftX = x + (width - groupWidth) / 2;
  const iconX = roundSvgNumber(groupLeftX - iconMetrics.xInset);
  const iconY = roundSvgNumber(getStatValueVisualBottomY(valueY, fontSize) - iconSize + 1);
  const valueRightX = roundSvgNumber(groupLeftX + iconMetrics.renderedWidth + iconGap + valueWidth + valueNudgeX);
  const auxBlockLeftX = roundSvgNumber(valueRightX + valueAuxGap);
  const auxOffsetY = -1;
  const glickoY = roundSvgNumber(valueY - 13 + auxOffsetY);
  const rdY = roundSvgNumber(valueY + 1 + auxOffsetY);
  const auxBracketTopY = roundSvgNumber(glickoY - 12);
  const auxBracketBottomY = roundSvgNumber(rdY + 2);
  const auxBracketRightX = roundSvgNumber(auxBlockLeftX + auxBlockWidth - 1);
  const auxBracketLeftInnerX = roundSvgNumber(auxBlockLeftX + auxBracketArmLength);
  const auxBracketRightInnerX = roundSvgNumber(auxBracketRightX - auxBracketArmLength);
  const auxCenterX = roundSvgNumber((auxBlockLeftX + auxBracketRightX) / 2 + 4);
  const glickoTextRightX = roundSvgNumber(auxCenterX + glickoTextWidth / 2);

  debugTetrioCard('league-glicko-layout', {
  platform: process.platform,
  node: process.version,

  x,
  width,
  valueY,
  value,
  iconValueFontSize: fontSize,

  trText: value,
  glickoRaw: options.glicko,
  rdRaw: options.rd,
  glickoText,
  rdText,

  auxCenterX,
  auxBracketLeftX: auxBlockLeftX,
  auxBracketLeftInnerX,
  auxBracketRightX,
  auxBracketRightInnerX,
  auxBracketTopY,
  auxBracketBottomY,

  glickoY,
  rdY,
  glickoTextRightX,

  rdTextWidth: estimateLeagueRdTextWidth(rdText),
  rdRowWidth: estimateLeagueRdRowWidth(rdText),
});

  return `<image href="${options.valueIcon}" x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" preserveAspectRatio="xMidYMax meet"/>
    ${renderLeagueTrStatValueText(valueRightX, valueY, value, fontSize, unitFontSize, 'end')}
    <g stroke="#f6fff5" stroke-width="2" stroke-linecap="square" opacity="0.96">
      <line x1="${auxBlockLeftX}" y1="${auxBracketTopY}" x2="${auxBracketLeftInnerX}" y2="${auxBracketTopY}"/>
      <line x1="${auxBlockLeftX}" y1="${auxBracketTopY}" x2="${auxBlockLeftX}" y2="${auxBracketBottomY}"/>
      <line x1="${auxBlockLeftX}" y1="${auxBracketBottomY}" x2="${auxBracketLeftInnerX}" y2="${auxBracketBottomY}"/>
      <line x1="${auxBracketRightInnerX}" y1="${auxBracketTopY}" x2="${auxBracketRightX}" y2="${auxBracketTopY}"/>
      <line x1="${auxBracketRightX}" y1="${auxBracketTopY}" x2="${auxBracketRightX}" y2="${auxBracketBottomY}"/>
      <line x1="${auxBracketRightInnerX}" y1="${auxBracketBottomY}" x2="${auxBracketRightX}" y2="${auxBracketBottomY}"/>
   </g>
   <text x="${auxCenterX}" y="${glickoY}" text-anchor="middle" class="leagueAux" font-size="13" font-weight="900">${renderTetrioCardDecimalNumberMarkup(glickoText)}</text>
    ${renderLeagueRdAuxText(glickoTextRightX, rdY, rdText)}`;
}

function renderLeagueRdAuxText(rightX, y, rdText) {
  const symbolWidth = 6.6;
  const symbolGap = 2.6;
  const rdTextWidth = estimateLeagueRdTextWidth(rdText);
  const textLeftX = rightX - rdTextWidth;
  const symbolLeftX = textLeftX - symbolGap - symbolWidth;
  const symbolCenterX = roundSvgNumber(symbolLeftX + 2.9);
  const plusY = roundSvgNumber(y - 6.1);
  const minusY = roundSvgNumber(y - 0.7);
  const horizontalHalf = 2.6;
  const verticalHalf = 2.6;

  debugTetrioCard('league-rd-aux-layout', {
  platform: process.platform,
  node: process.version,

  rightX,
  y,
  rdText,

  symbolWidth,
  symbolGap,
  rdTextWidth,
  textLeftX,
  symbolLeftX,
  symbolCenterX,
  plusY,
  minusY,
  horizontalHalf,
  verticalHalf,

  markup: renderTetrioCardDecimalNumberMarkup(rdText),
});

  return `<g>
    <g stroke="#c5efbc" stroke-width="1.15" stroke-linecap="square" opacity="0.98">
      <line x1="${roundSvgNumber(symbolCenterX - horizontalHalf)}" y1="${plusY}" x2="${roundSvgNumber(symbolCenterX + horizontalHalf)}" y2="${plusY}"/>
      <line x1="${symbolCenterX}" y1="${roundSvgNumber(plusY - verticalHalf)}" x2="${symbolCenterX}" y2="${roundSvgNumber(plusY + verticalHalf)}"/>
      <line x1="${roundSvgNumber(symbolCenterX - horizontalHalf)}" y1="${minusY}" x2="${roundSvgNumber(symbolCenterX + horizontalHalf)}" y2="${minusY}"/>
    </g>
    <text x="${rightX}" y="${y}" text-anchor="end" class="leagueAuxMuted" font-size="13" font-weight="900">${renderTetrioCardDecimalNumberMarkup(rdText)}</text>
  </g>`;
}

function estimateLeagueRdTextWidth(rdText) {
  return estimateStatValueWidth(rdText, 13);
}

function estimateLeagueRdRowWidth(rdText) {
  return 6.6 + 2.6 + estimateLeagueRdTextWidth(rdText);
}

function getLeagueIconRenderMetrics(options, iconSize) {
  const sourceWidth = Number(options.valueIconWidth);
  const sourceHeight = Number(options.valueIconHeight);
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0 || iconSize <= 0) {
    return {
      renderedWidth: iconSize,
      xInset: 0,
    };
  }

  const scale = Math.min(iconSize / sourceWidth, iconSize / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  return {
    renderedWidth,
    xInset: Math.max(0, (iconSize - renderedWidth) / 2),
  };
}

function renderLeagueMetricsSubtext(x, y, width, league) {
  return `<text x="${x + width / 2}" y="${y + 85}" text-anchor="middle" class="subMetric">
    <tspan class="subMetricValue">${renderTetrioCardDecimalNumberMarkup(formatDecimal(league?.apm, 2))}</tspan>
    <tspan dx="0.9" class="subMetricLabel">APM</tspan>
    <tspan dx="4.5" class="subMetricValue">${renderTetrioCardDecimalNumberMarkup(formatDecimal(league?.pps, 2))}</tspan>
    <tspan dx="0.9" class="subMetricLabel">PPS</tspan>
    <tspan dx="4.5" class="subMetricValue">${renderTetrioCardDecimalNumberMarkup(formatDecimal(league?.vs, 2))}</tspan>
    <tspan dx="0.9" class="subMetricLabel">VS</tspan>
  </text>`;
}

function getRankLabelLeftX(x, width, fallbackRank, options = {}) {
  const hasLocalRank = isPositiveRank(options.localRank);
  const hasWorldRank = isPositiveRank(options.worldRank);
  const plainRankFontSize = 12.2;
  const plainFlagWidth = 16;
  const rightX = x + width - statRankRightInset;
  const worldText = formatRank(options.worldRank);
  const worldLeftX = hasWorldRank
    ? getWorldRankBadgeLeftX(options.worldRank, worldText, rightX)
      ?? rightX - estimateOrdinalRankWidth(worldText, plainRankFontSize)
    : rightX - estimatePlainRankWidth(fallbackRank, 12);

  if (!hasWorldRank || !options.flag || !hasLocalRank) {
    return worldLeftX;
  }

  const localText = formatRank(options.localRank);
  const localWidth = estimateOrdinalRankWidth(localText, plainRankFontSize);
  const localTextX = worldLeftX - 8;
  return localTextX - localWidth - plainFlagWidth - 4;
}

function renderRankLabel(x, y, width, fallbackRank, options) {
  const hasLocalRank = isPositiveRank(options.localRank);
  const hasWorldRank = isPositiveRank(options.worldRank);
  const plainRankFontSize = 12.2;
  const plainFlagWidth = 16;
  const plainFlagHeight = 11.5;
  const rightX = x + width - statRankRightInset;
  const worldText = formatRank(options.worldRank);
  const worldBadge = hasWorldRank
    ? renderWorldRankBadge(options.worldRank, worldText, rightX, y + 8.5)
    : null;

  if (!hasWorldRank) {
    return renderPlainRankText(rightX, y + 21, fallbackRank, 'end');
  }

  if (!options.flag || !hasLocalRank) {
    return worldBadge
      ? worldBadge.markup
      : renderOrdinalRankText(rightX, y + 21, worldText, { anchor: 'end', className: 'plainRank', fontSize: plainRankFontSize });
  }

  const localText = formatRank(options.localRank);
  const localWidth = estimateOrdinalRankWidth(localText, plainRankFontSize);
  const worldMarkup = worldBadge
    ? worldBadge.markup
    : renderOrdinalRankText(rightX, y + 21, worldText, { anchor: 'end', className: 'plainRank', fontSize: plainRankFontSize });
  const worldLeftX = worldBadge
    ? worldBadge.leftX
    : rightX - estimateOrdinalRankWidth(worldText, plainRankFontSize);
  const localTextX = worldLeftX - 8;
  const flagX = localTextX - localWidth - plainFlagWidth - 4;

  return `
    <image href="${options.flag.image}" x="${flagX}" y="${y + 10}" width="${plainFlagWidth}" height="${plainFlagHeight}" preserveAspectRatio="xMidYMid meet"/>
    ${renderOrdinalRankText(localTextX, y + 21, localText, { anchor: 'end', className: 'plainRank', fontSize: plainRankFontSize })}
    ${worldMarkup}`;
}

function renderWorldRankBadge(rank, label, rightX, y) {
  const badgeStyle = getWorldRankBadgeStyle(rank);
  if (!badgeStyle) {
    return null;
  }

  const badgeFontSize = 11.2;
  const badgeWidth = getWorldRankBadgeWidth(label, badgeFontSize);
  const badgeHeight = 13.6;
  const leftX = rightX - badgeWidth;
  const points = [
    formatPoint([leftX + 6.4, y]),
    formatPoint([rightX, y]),
    formatPoint([rightX, y + badgeHeight]),
    formatPoint([leftX + 3.2, y + badgeHeight]),
    formatPoint([leftX, y + badgeHeight / 2]),
  ].join(' ');

  return {
    leftX,
    markup: `
    <polygon points="${points}" fill="${badgeStyle.fill}"/>
    ${renderOrdinalRankText(leftX + badgeWidth / 2 + 0.8, y + 10.6, label, { anchor: 'middle', fontSize: badgeFontSize, fill: badgeStyle.textFill })}`,
  };
}

function getWorldRankBadgeLeftX(rank, label, rightX) {
  if (!getWorldRankBadgeStyle(rank)) {
    return null;
  }

  return rightX - getWorldRankBadgeWidth(label, 11.2);
}

function getWorldRankBadgeWidth(label, fontSize) {
  const textWidth = estimateOrdinalRankWidth(label, fontSize);
  return Math.max(32, textWidth + 11);
}

function getWorldRankBadgeStyle(rank) {
  if (!Number.isFinite(rank) || rank < 1) {
    return null;
  }

  if (rank === 1) {
    return {
      fill: '#d96eff',
      textFill: '#2f1037',
    };
  }

  if (rank <= 10) {
    return {
      fill: '#f1c34f',
      textFill: '#4f3600',
    };
  }

  if (rank <= 100) {
    return {
      fill: '#c1c6d0',
      textFill: '#2d3644',
    };
  }

  return {
    fill: '#4f8b51',
    textFill: '#d7ffd1',
  };
}

function renderPlainRankText(x, y, value, anchor = 'end') {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="plainRank">${renderTetrioTextMarkup(value)}</text>`;
}

function renderOrdinalRankText(x, y, rankText, options = {}) {
  const fontSize = Number.isFinite(options.fontSize) ? options.fontSize : 13;
  const fontWeight = Number.isFinite(options.fontWeight) ? options.fontWeight : 900;
  const anchor = options.anchor ?? 'end';
  const width = estimateOrdinalRankWidth(rankText, fontSize);
  const leftX = anchor === 'middle'
    ? x - width / 2
    : anchor === 'end'
      ? x - width
      : x;
  const nWidth = fontSize * 0.66;
  const numberX = leftX + nWidth + fontSize * 0.33;
  const degreeRadius = Math.max(1.1, fontSize * 0.095);
  const degreeCx = leftX + nWidth + fontSize * 0.15;
  const degreeCy = y - fontSize * 0.68;
  const textClass = options.className ? ` class="${options.className}"` : '';
  const textFill = options.fill ? ` fill="${options.fill}"` : '';
  const degreeStroke = options.stroke ?? options.fill ?? '#a8e7a7';
  const textAttributes = `${textClass}${textFill} font-size="${fontSize}" font-weight="${fontWeight}"`;

  return `<g>
    <text x="${roundSvgNumber(leftX)}" y="${roundSvgNumber(y)}"${textAttributes}>N</text>
    <circle cx="${roundSvgNumber(degreeCx)}" cy="${roundSvgNumber(degreeCy)}" r="${roundSvgNumber(degreeRadius)}" fill="none" stroke="${degreeStroke}" stroke-width="${roundSvgNumber(Math.max(0.85, fontSize * 0.07))}"/>
    <text x="${roundSvgNumber(numberX)}" y="${roundSvgNumber(y)}"${textAttributes}>${renderTetrioNumericTextMarkup(rankText)}</text>
  </g>`;
}

function estimateOrdinalRankWidth(rankText, fontSize = 11) {
  return Math.ceil(fontSize * 0.99 + String(rankText ?? '').length * fontSize * 0.58);
}

function estimatePlainRankWidth(rankText, fontSize = 13) {
  return Math.ceil(String(rankText ?? '').length * fontSize * 0.56 + 2);
}

function estimateStatValueWidth(value, fontSize) {
  const text = String(value ?? '');
  let units = 0;

  for (const char of text) {
    if (/\d/.test(char)) {
      units += 0.58;
    } else if (char === ':' || char === ';') {
      units += 0.27;
    } else if (char === '.' || char === ',') {
      units += 0.24;
    } else if (char === ' ') {
      units += 0.28;
    } else {
      units += 0.5;
    }
  }

  return Math.ceil(units * fontSize + 2);
}

function estimateLeagueAuxTextWidth(value, fontSize) {
  const text = String(value ?? '');
  let units = 0;

  for (const char of text) {
    if (/\d/.test(char)) {
      units += 0.51;
    } else if (char === '±') {
      units += 0.44;
    } else if (char === '.' || char === ',') {
      units += 0.18;
    } else if (char === ' ') {
      units += 0.2;
    } else {
      units += 0.42;
    }
  }

  return Math.ceil(units * fontSize + 1);
}

function estimateLeagueMainValueWidth(value, fontSize, unitFontSize = fontSize) {
  const text = String(value ?? '');
  const match = text.match(/^(.*?)(TR)$/);
  if (match) {
    return estimateLeagueMainValueTextWidth(match[1], fontSize)
      + estimateLeagueMainValueTextWidth(match[2], unitFontSize);
  }

  return estimateLeagueMainValueTextWidth(text, fontSize);
}

function estimateLeagueMainValueTextWidth(text, fontSize) {
  let units = 0;

  for (const char of text) {
    if (/\d/.test(char)) {
      units += 0.55;
    } else if (char === ' ') {
      units += 0.24;
    } else {
      units += 0.46;
    }
  }

  return Math.ceil(units * fontSize + 1);
}

function getRenderedStatValueWidth(value, fontSize) {
  return estimateStatValueWidth(value, fontSize);
}

function renderStatValueText(x, y, value, fontSize, anchor = 'middle') {
  return renderStatValueTextLayers(x, y, anchor, [
    { text: value, fontSize },
  ]);
}

function renderTimedStatValueText(x, y, value, fontSize, anchor = 'middle') {
  const text = String(value ?? '');
  const splitIndex = text.lastIndexOf('.');
  if (splitIndex < 0 || splitIndex === text.length - 1) {
    return renderStatValueText(x, y, text, fontSize, anchor);
  }

  const segments = [
    { text: text.slice(0, splitIndex + 1), fontSize },
    { text: text.slice(splitIndex + 1), fontSize: getTimedDecimalFontSize(fontSize) },
  ];

  return renderStatValueTextLayers(x, y, anchor, segments);
}

function renderLeagueTrStatValueText(x, y, value, numberFontSize, unitFontSize, anchor = 'middle') {
  const text = String(value ?? '');
  const match = text.match(/^(.*?)(TR)$/);
  if (!match) {
    return renderStatValueText(x, y, text, numberFontSize, anchor);
  }

  const segments = [
    { text: match[1], fontSize: numberFontSize },
    { text: match[2], fontSize: unitFontSize },
  ];

  return renderStatValueTextLayers(x, y, anchor, segments);
}

function getTimedDecimalFontSize(fontSize) {
  return Math.max(1, Math.round(fontSize * 0.756) + 2);
}

function renderAltitudeStatValueText(x, y, value, numberFontSize, unitFontSize, anchor = 'middle') {
  const text = String(value ?? '');
  const match = text.match(/^(.+?)([A-Z]+)$/);
  if (!match) {
    return renderStatValueText(x, y, text, numberFontSize, anchor);
  }

  const segments = [
    { text: match[1], fontSize: numberFontSize },
    { text: match[2], fontSize: unitFontSize },
  ];

  return renderStatValueTextLayers(x, y, anchor, segments);
}

function renderStatValueTextLayers(x, y, anchor, segments) {
  const textX = roundSvgNumber(x);
  const shadowY = roundSvgNumber(y + 2);
  const hasNumericValue = segments.some(({ text }) => /\d/.test(String(text ?? '')));
  const glowMarkup = hasNumericValue
    ? `
    ${renderCompositeStatValueText(textX, y, anchor, 'valueGlowWide', segments, 'filter="url(#statValueGlowWide)"')}
    ${renderCompositeStatValueText(textX, y, anchor, 'valueGlowTight', segments, 'filter="url(#statValueGlowTight)"')}`
    : '';

  return `${renderCompositeStatValueText(textX, shadowY, anchor, 'valueShadow', segments)}${glowMarkup}
    ${renderCompositeStatValueText(textX, y, anchor, 'value', segments)}`;
}

function renderCompositeStatValueText(x, y, anchor, className, segments, attributes = '') {
  const adjustedX = anchor === 'middle'
    ? roundSvgNumber(x + getCenteredStatValueCommaNudgeX(segments))
    : x;
  const segmentMarkup = segments
    .map(({ text, fontSize }) => `<tspan font-size="${fontSize}">${renderTetrioNumericTextMarkup(text)}</tspan>`)
    .join('');
  const attributesMarkup = attributes ? ` ${attributes}` : '';
  return `<text x="${adjustedX}" y="${y}" text-anchor="${anchor}" class="${className}"${attributesMarkup}>${segmentMarkup}</text>`;
}

function getCenteredStatValueCommaNudgeX(segments) {
  const commaDx = Math.abs(Number.parseFloat(tetrioTightCommaDx));
  if (!Number.isFinite(commaDx) || commaDx <= 0) {
    return 0;
  }

  return segments.reduce((sum, { text, fontSize }) => {
    const commaCount = (String(text ?? '').match(/,/g) ?? []).length;
    return sum + commaCount * commaDx * fontSize / 2;
  }, 0);
}

function getStatValueVisualCenterY(valueY, fontSize) {
  return valueY - fontSize * 0.37;
}

function getStatValueVisualBottomY(valueY, fontSize) {
  return valueY + Math.max(1, fontSize * 0.03);
}

function formatTime(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return 'NO RECORD';
  }

  const totalSeconds = milliseconds / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
}

function formatAgo(timestamp) {
  if (!timestamp) {
    return 'NO RECORD';
  }

  const diff = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(diff) || diff < 0) {
    return 'JUST NOW';
  }

  const hour = 3_600_000;
  const day = 86_400_000;
  const month = day * 30;
  const year = day * 365;
  const totalHours = Math.max(1, Math.floor(diff / hour));
  const totalDays = Math.max(1, Math.floor(diff / day));

  if (diff < day) {
    return `${totalHours} HOUR${totalHours === 1 ? '' : 'S'} AGO`;
  }

  if (diff > year) {
    const years = Math.floor(diff / year);
    const remainingAfterYears = diff - years * year;
    const months = Math.floor(remainingAfterYears / month);
    return `${totalDays} DAYS AGO(${years}Y ${months}M)`;
  }

  if (diff > month) {
    const months = Math.floor(diff / month);
    return `${totalDays} DAYS AGO(${months}M)`;
  }

  return `${totalDays} DAY${totalDays === 1 ? '' : 'S'} AGO`;
}

function formatRelativeDate(timestamp) {
  const diff = Date.now() - new Date(timestamp).getTime();
  const hour = 3_600_000;
  const year = 365 * 86_400_000;
  const month = 30 * 86_400_000;
  const day = 86_400_000;
  const totalHours = Math.max(1, Math.floor(diff / hour));
  const totalDays = Math.max(1, Math.floor(diff / day));

  if (!Number.isFinite(diff) || diff < 0) {
    return 'recently';
  }

  if (diff < day) {
    return `${totalHours} hour${totalHours === 1 ? '' : 's'} ago`;
  }

  if (diff > year) {
    const years = Math.floor(diff / year);
    const remainingAfterYears = diff - years * year;
    const months = Math.floor(remainingAfterYears / month);
    return `${totalDays} days ago(${years}y ${months}m)`;
  }

  if (diff > month) {
    const months = Math.floor(diff / month);
    return `${totalDays} days ago(${months}m)`;
  }

  return `${totalDays} day${totalDays === 1 ? '' : 's'} ago`;
}

function formatDecimal(value, digits) {
  return Number.isFinite(value) ? value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }) : '-';
}

function formatGlickoValue(value) {
  return formatDecimal(value, 1);
}

function formatRdValue(value) {
  return formatDecimal(value, 1);
}

function formatAltitude(value) {
  return Number.isFinite(value) ? value.toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }) : '0.0';
}

function formatNumber(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '-';
}

function getPublicStatValue(...values) {
  for (const value of values) {
    if (Number.isFinite(value) && value >= 0) {
      return value;
    }
  }

  return null;
}

function formatCompactProfileCount(...values) {
  const stat = getPublicStatValue(...values);
  return stat === null ? null : formatNumber(stat);
}

function formatCompactPlaytimeHours(value) {
  const stat = getPublicStatValue(value);
  return stat === null ? null : `${formatNumber(stat / 3600)}H`;
}

function getCompactProfileStats(user, league) {
  const wins = formatCompactProfileCount(user?.gameswon);
  const played = formatCompactProfileCount(user?.gamesplayed);
  const time = formatCompactPlaytimeHours(user?.gametime);
  const roundItems = [];

  if (wins) {
    roundItems.push(createCompactProfileStatItem(wins, 'profileBoxValuePrimary'));
  }

  if (wins && played) {
    roundItems.push({ separator: 'slash', width: 12 });
  }

  if (played) {
    roundItems.push(createCompactProfileStatItem(played, 'profileBoxValueSecondary'));
  }

  const timeItem = time ? createCompactProfileStatItem(time, 'profileBoxValuePrimary', { suffix: 'H' }) : null;
  return {
    roundItems,
    timeItem,
    width: getCompactProfileStatsWidth({ roundItems, timeItem }),
  };
}

function createCompactProfileStatItem(value, className = 'profileBoxValuePrimary', options = {}) {
  const normalizedValue = options.suffix && String(value).endsWith(options.suffix)
    ? String(value).slice(0, -options.suffix.length)
    : String(value);
  const displayValue = `${normalizedValue}${options.suffix ?? ''}`;
  const fontSize = displayValue.length >= 7 ? 15 : displayValue.length >= 6 ? 16 : 17;
  return {
    value: normalizedValue,
    className,
    suffix: options.suffix ?? '',
    suffixClassName: options.suffixClassName,
    fontSize,
    width: estimateCompactProfileStatWidth(displayValue, fontSize),
  };
}

function getCompactProfileStatsWidth(stats) {
  const roundWidth = stats.roundItems.length ? getCompactProfileStatsBoxWidth(stats.roundItems, { horizontalPadding: 2 }) : 0;
  const timeWidth = stats.timeItem ? getCompactProfileStatsBoxWidth([stats.timeItem]) : 0;

  if (!roundWidth && !timeWidth) {
    return 0;
  }

  return roundWidth + timeWidth + (roundWidth && timeWidth ? 6 : 0);
}

function getCompactProfileStatsBoxWidth(items, options = {}) {
  if (!items.length) {
    return 0;
  }

  const contentWidth = items.reduce((sum, item) => sum + item.width, 0);
  return contentWidth + (options.horizontalPadding ?? 4);
}

function estimateCompactProfileStatWidth(value, fontSize) {
  return Math.ceil(String(value).length * (fontSize * 0.68) + 2);
}

function xpToLevel(xp) {
  if (!Number.isFinite(xp) || xp < 0) {
    return 0;
  }

  return (xp / 500) ** 0.6 + (xp / (5000 + Math.max(0, xp - 4_000_000) / 5000)) + 1;
}

function formatTrNumber(value) {
  return Number.isFinite(value) ? String(Math.round(value)) : '-';
}

function formatRank(value) {
  return Number.isFinite(value) && value > 0 ? formatNumber(value) : '-';
}

function isPositiveRank(value) {
  return Number.isFinite(value) && value > 0;
}

function getBioHeight(lines) {
  return lines.length === 0
    ? 0
    : bioTextBaselineOffsetY + (lines.length - 1) * bioTextLineHeight + bioTextBottomPadding;
}

async function measureBioHangulWidth(fontSize) {
  return bioCjkReferenceWidth * fontSize / bioCjkReferenceFontSize;
}

async function measureBioSampleWidth(text, fontSize, fontDataUri = null) {
  const normalizedText = String(text ?? '');
  if (!normalizedText) {
    return 0;
  }

  const horizontalPadding = 24;
  const verticalPadding = 20;
  const svgWidth = Math.max(192, Math.ceil(normalizedText.length * fontSize * 1.4 + horizontalPadding * 2));
  const svgHeight = Math.max(72, Math.ceil(fontSize + verticalPadding * 2));
  const baselineY = verticalPadding + fontSize * 0.82;
  const measurementSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
  <defs>
    <style>${renderTetrioFontFace(fontDataUri)}</style>
  </defs>
  <rect width="${svgWidth}" height="${svgHeight}" fill="transparent"/>
  <text x="${horizontalPadding}" y="${baselineY}" font-family="${escapeXml(bioFontFamily)}" font-size="${fontSize}" font-weight="800" fill="#ffffff">${escapeXml(normalizedText)}</text>
</svg>`;
  const { info } = await sharp(renderTetrioSvgToPng(measurementSvg, { zoom: 1 }))
    .png()
    .trim()
    .toBuffer({ resolveWithObject: true });

  return info.width;
}

async function wrapBioText(value, maxWidth = 864, options = {}) {
  const normalizedText = normalizeBioText(value);
  if (!normalizedText) {
    return [];
  }

  const fontDataUri = typeof options.fontDataUri === 'string' && options.fontDataUri
    ? options.fontDataUri
    : null;
  const fontSize = Number.isFinite(options.fontSize) ? options.fontSize : 16;
  const japaneseWrapSafety = 44;
  const generalWrapAllowance = 18;

  const hangulWidth = Number.isFinite(options.hangulWidth) ? options.hangulWidth : null;
  const measurementCache = new Map();
  const lines = [];

  for (const paragraph of normalizedText.split('\n')) {
    if (!paragraph) {
      lines.push('');
      continue;
    }

    const hasJapaneseKana = containsJapaneseKana(paragraph);
    const hasCjkText = containsCjkBioText(paragraph);
    const paragraphMaxWidth = maxWidth + (
      hasJapaneseKana
        ? -japaneseWrapSafety
        : generalWrapAllowance
    );
    const shouldUseMeasuredWrap = fontDataUri
      && paragraph.length <= measuredBioWrapMaxLength
      && !containsBioEmoji(paragraph)
      && !hasCjkText;
    const wrappedLines = shouldUseMeasuredWrap
      ? await wrapBioParagraphMeasured(
        paragraph,
        paragraphMaxWidth,
        fontSize,
        fontDataUri,
        measurementCache,
      )
      : wrapBioParagraphEstimated(paragraph, paragraphMaxWidth, hangulWidth);

    lines.push(...wrappedLines);
  }

  return lines;
}

function normalizeBioText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/gu, '\n')
    .replace(/[ \t\f\v\u00a0\u1680\u2000-\u200f\u202a-\u202f\u205f\u2060\u3000\u3164\ufeff]{3,}/gu, '\n')
    .replace(/[\u00a0\u1680\u2000-\u200f\u202a-\u202f\u205f\u2060\u3000\u3164\ufeff]/gu, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function wrapBioParagraphMeasured(paragraph, maxWidth, fontSize, fontDataUri, measurementCache) {
  const words = paragraph.split(' ');
  const lines = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    const candidateWidth = await measureBioTextWidthCached(
      candidate,
      fontSize,
      fontDataUri,
      measurementCache,
    );

    if (candidateWidth <= maxWidth) {
      line = candidate;
      continue;
    }

    if (line) {
      lines.push(line);
      line = '';
    }

    const wordWidth = await measureBioTextWidthCached(
      word,
      fontSize,
      fontDataUri,
      measurementCache,
    );
    if (wordWidth <= maxWidth) {
      line = word;
      continue;
    }

    const splitWordLines = await splitBioTokenMeasured(
      word,
      maxWidth,
      fontSize,
      fontDataUri,
      measurementCache,
    );
    lines.push(...splitWordLines.slice(0, -1));
    line = splitWordLines.at(-1) ?? '';
  }

  if (line) {
    lines.push(line);
  }

  return lines;
}

async function splitBioTokenMeasured(token, maxWidth, fontSize, fontDataUri, measurementCache) {
  const chars = splitGraphemes(token);
  const lines = [];
  let index = 0;

  while (index < chars.length) {
    let low = index + 1;
    let high = chars.length;
    let nextIndex = index + 1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = chars.slice(index, middle).join('');
      const candidateWidth = await measureBioTextWidthCached(
        candidate,
        fontSize,
        fontDataUri,
        measurementCache,
      );

      if (candidateWidth <= maxWidth) {
        nextIndex = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    lines.push(chars.slice(index, nextIndex).join(''));
    index = nextIndex;
  }

  return lines;
}

async function measureBioTextWidthCached(text, fontSize, fontDataUri, measurementCache) {
  if (measurementCache.has(text)) {
    return measurementCache.get(text);
  }

  const globalCacheKey = [
    fontSize,
    fontDataUri ? fontDataUri.length : 0,
    text,
  ].join('|');
  if (bioTextWidthCache.has(globalCacheKey)) {
    const width = bioTextWidthCache.get(globalCacheKey);
    measurementCache.set(text, width);
    return width;
  }

  const width = await measureBioSampleWidth(text, fontSize, fontDataUri);
  measurementCache.set(text, width);
  cacheMeasuredTextWidth(bioTextWidthCache, globalCacheKey, width);
  return width;
}

function cacheMeasuredTextWidth(cache, key, width) {
  if (!Number.isFinite(width)) {
    return;
  }

  if (cache.size >= measuredTextWidthCacheMaxEntries) {
    cache.delete(cache.keys().next().value);
  }

  cache.set(key, width);
}

function wrapBioParagraphEstimated(paragraph, maxWidth, hangulWidth = null) {
  const lines = [];
  let line = '';
  let lineWidth = 0;

  for (const grapheme of splitGraphemes(paragraph)) {
    const graphemeWidth = getBioGraphemeWidth(grapheme, hangulWidth);
    if (line && lineWidth + graphemeWidth > maxWidth) {
      lines.push(line.trimEnd());
      line = '';
      lineWidth = 0;
    }

    line += grapheme;
    lineWidth += graphemeWidth;
  }

  if (line) {
    lines.push(line.trimEnd());
  }

  return lines;
}

function getBioGraphemeWidth(grapheme, hangulWidth = null) {
  if (isBioEmojiGrapheme(grapheme)) {
    return bioEmojiSize;
  }

  return Array.from(grapheme).reduce((sum, char) => sum + getBioCharWidth(char, hangulWidth), 0);
}

function scaleBioWidth(width) {
  return width * bioTextFontSize / 16;
}

function getBioCharWidth(char, hangulWidth = null) {
  if (/[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/u.test(char)) {
    return hangulWidth ?? scaleBioWidth(9.6);
  }

  if (/[\u1100-\u11ff\u3130-\u318f\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/u.test(char)) {
    return hangulWidth ?? scaleBioWidth(15.9);
  }

  if (/[MW@#%&]/.test(char)) {
    return scaleBioWidth(14.2);
  }

  if (/\s/.test(char)) {
    return scaleBioWidth(5.4);
  }

  if (/[A-Z0-9]/.test(char)) {
    return scaleBioWidth(11.8);
  }

  if (/[a-z]/.test(char)) {
    return scaleBioWidth(10.1);
  }

  if (/[.,!:'";|]/.test(char)) {
    return scaleBioWidth(6.4);
  }

  return scaleBioWidth(9.6);
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
