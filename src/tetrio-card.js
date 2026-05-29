import sharp from 'sharp';

const tetrioApiBaseUrl = 'https://ch.tetr.io/api';
const tetrioContentBaseUrl = 'https://tetr.io/user-content';
const tetrioGameBaseUrl = 'https://tetr.io';
const tetrioHunFontUrl = `${tetrioGameBaseUrl}/res/font/hun2.ttf?v=6`;
const cardFontFamily = '"HUN", "Noto Sans CJK KR", "Noto Sans KR", "Noto Sans CJK", "Malgun Gothic", "Apple SD Gothic Neo", Arial, sans-serif';
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
const bioTextBaselineOffsetY = 44;
const bioTextLineHeight = 23;
const bioTextBottomPadding = 14;
const bioClipTopOffsetY = 25;
const bioClipBottomInset = 6;
let tetrioHunFontDataUriPromise = null;

export async function createTetrioProfileCard(username) {
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
  const image = await sharp(Buffer.from(svg)).png().toBuffer();

  return {
    image,
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
  const response = await fetch(`${tetrioApiBaseUrl}${path}`, {
    headers: tetrioHeaders,
  });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    const error = new Error(body?.error?.msg ?? `TETR.IO API responded with ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return body;
}

async function fetchTetrioAssets(user, summaries) {
  const avatarUrl = user.avatar_revision
    ? `${tetrioContentBaseUrl}/avatars/${user._id}.jpg?rv=${user.avatar_revision}`
    : null;
  const bannerUrl = user.supporter && user.banner_revision
    ? `${tetrioContentBaseUrl}/banners/${user._id}.jpg?rv=${user.banner_revision}`
    : null;
  const countryCode = normalizeCountryCode(user.country);
  const flagUrl = countryCode
    ? `https://flagcdn.com/h40/${countryCode.toLowerCase()}.png`
    : null;
  const badges = user.badges ?? [];
  const leagueRank = summaries?.league?.rank
    ? summaries.league.rank
    : null;
  const [avatar, banner, flag, badgeIconEntries, leagueRankIcon, hunFont] = await Promise.all([
    fetchImageDataUri(avatarUrl),
    fetchImageDataUri(bannerUrl),
    fetchImageDataUri(flagUrl),
    Promise.all(badges.map(async (badge) => [
      badge.id,
      await fetchImageDataUri(`${tetrioGameBaseUrl}/res/badges/${formatTetrioAssetPath(badge.id)}.png`),
    ])),
    fetchImageDataUri(leagueRank ? `${tetrioGameBaseUrl}/res/league-ranks/${formatTetrioAssetPath(leagueRank)}.png` : null, {
      includeMetadata: true,
      trimTransparent: true,
    }),
    fetchTetrioHunFontDataUri(),
  ]);

  return {
    avatar,
    banner,
    flag,
    badgeIcons: Object.fromEntries(badgeIconEntries),
    leagueRankIcon,
    hunFont,
  };
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

async function fetchImageDataUri(url, options = {}) {
  if (!url) {
    return null;
  }

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
      return dataUri;
    }

    return {
      image: dataUri,
      ...(await readImageMetadata(buffer)),
    };
  } catch {
    return null;
  }
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
  tetrioHunFontDataUriPromise ??= fetchFontDataUri(tetrioHunFontUrl);
  return tetrioHunFontDataUriPromise;
}

async function fetchFontDataUri(url) {
  try {
    const response = await fetch(url, { headers: tetrioHeaders });
    if (!response.ok) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:font/ttf;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

async function renderTetrioCardSvg(user, summaries, assets) {
  const contentX = 28;
  const contentWidth = 904;
  const contentRight = contentX + contentWidth;
  const bannerX = 14;
  const bannerY = 18;
  const bannerHeight = 102;
  const bannerWidth = 932;
  const avatarX = 28;
  const avatarY = bannerY;
  const avatarSize = 96;
  const nameX = avatarX + avatarSize + 16;
  const headerNameFontSize = 46;
  const headerNameFontWeight = 700;
  const headerUsername = String(user.username ?? '').toUpperCase();
  const headerNameWidth = await measureHeaderNameWidth(
    headerUsername,
    headerNameFontSize,
    assets.hunFont,
    headerNameFontWeight
  );
  const headerNameClass = assets.banner ? 'headerName' : 'headerName noBannerHeaderName';
  const headerMetaClass = assets.banner ? 'meta' : 'meta noBannerMeta';
  const flag = getCountryFlag(user.country, assets.flag);
  const joined = user.ts ? `JOINED ${formatRelativeDate(user.ts).toUpperCase()}` : 'JOIN DATE HIDDEN';
  const league = summaries.league;
  const fortyLines = summaries['40l'];
  const blitz = summaries.blitz;
  const zenith = summaries.zenith;
  const zenithEx = summaries.zenithex;
  const badges = user.badges ?? [];
  const levelTag = getLevelTag(user.xp);
  const levelProgress = formatLevelProgress(user.xp);
  const xp = formatXp(user.xp);
  const badgeLayout = getBadgeLayout(badges.length, contentWidth);
  const levelTagY = bannerY + bannerHeight + 8;
  const profileStats = getCompactProfileStats(user, league);
  const profileStatsWidth = getCompactProfileStatsWidth(profileStats);
  const profileDistinguishment = resolveProfileDistinguishment(user, summaries);
  const profileStatsRightNudge = !profileStats.timeItem && profileStats.roundItems.length ? 8 : 0;
  const supporterBadgeRightEdge = profileStatsWidth > 0
    ? contentRight - profileStatsWidth - 8 + profileStatsRightNudge
    : contentRight;
  const supporterBadge = user.supporter
    ? getSupporterBadgeLayout(user.supporter_tier ?? 1, supporterBadgeRightEdge, levelTagY + 3)
    : null;
  const profileStatsX = supporterBadge
    ? supporterBadge.x + supporterBadge.width + 8
    : contentRight - profileStatsWidth + profileStatsRightNudge;
  const levelTextY = levelTagY + 20;
  const levelProgressY = levelTagY + 34;
  const noticeStartY = levelProgressY + 8;
  const noticeSlotHeight = 68;
  const noticeMarkup = [];
  let noticeCursorY = noticeStartY;
  if (user.badstanding) {
    noticeMarkup.push(renderBadStandingBanner(noticeCursorY));
    noticeCursorY += noticeSlotHeight;
  }
  if (profileDistinguishment) {
    noticeMarkup.push(renderDistinguishmentBanner(profileDistinguishment, noticeCursorY));
    noticeCursorY += noticeSlotHeight;
  }
  const badgeBoxY = noticeMarkup.length > 0 ? noticeCursorY : levelProgressY + 12;
  const badgeY = badgeBoxY + 10;
  const badgeBoxHeight = badgeLayout.boxHeight;
  const bioTextInset = 12;
  const bioTextWidth = contentWidth - bioTextInset * 2;
  const bioWrapSafety = 12;
  const bioHangulWidth = await measureBioHangulWidth(16, assets.hunFont);
  const bioLines = await wrapBioText(user.bio, bioTextWidth - bioWrapSafety, {
    fontDataUri: assets.hunFont,
    fontSize: 16,
    hangulWidth: bioHangulWidth,
  });
  const hasBio = bioLines.length > 0;
  const bioHeight = getBioHeight(bioLines);
  const bioY = badgeBoxY + badgeBoxHeight + 8;
  const topStatY = bioY + (hasBio ? bioHeight + 8 : 0);
  const bottomStatY = topStatY + 100;
  const svgHeight = bottomStatY + 126;
  const cardHeight = svgHeight - 32;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${svgHeight}" viewBox="0 0 960 ${svgHeight}">
  <defs>
    <clipPath id="avatarClip"><rect x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" rx="8"/></clipPath>
    <clipPath id="bannerClip"><rect x="${bannerX}" y="${bannerY}" width="${bannerWidth}" height="${bannerHeight}" rx="4"/></clipPath>
    <clipPath id="bioClip"><rect x="${contentX + bioTextInset}" y="${bioY + bioClipTopOffsetY}" width="${bioTextWidth}" height="${Math.max(0, bioHeight - bioClipTopOffsetY - bioClipBottomInset)}"/></clipPath>
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
    <filter id="statValueGlowWide" x="-28%" y="-82%" width="156%" height="264%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="4.1"/>
    </filter>
    <filter id="statValueGlowTight" x="-22%" y="-62%" width="144%" height="224%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="1.45"/>
    </filter>
    <pattern id="dangerStripe" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <rect width="24" height="24" fill="#b50808"/>
      <rect width="9" height="24" fill="#8c0505"/>
    </pattern>
    ${renderLevelTagGradients()}
    ${renderSupporterBadgeDefs()}
    <style>
      ${renderTetrioFontFace(assets.hunFont)}
      text { font-family: ${cardFontFamily}; letter-spacing: 0; }
      .tiny { font-size: 11px; font-weight: 900; fill: #a8e7a7; text-shadow: 0 1px 2px #061009; }
      .plainRank { font-size: 13px; font-weight: 900; fill: #a8e7a7; text-shadow: 0 1px 2px #061009; }
      .label { font-size: 14.5px; font-weight: 900; fill: #5d915c; opacity: 0.84; }
      .value {
        font-weight: 900;
        fill: #c9ffc8;
        stroke: rgba(182, 247, 184, 0.58);
        stroke-width: 0.14px;
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
        opacity: 0.44;
      }
      .valueGlowTight {
        font-weight: 900;
        fill: #d8ffd2;
        opacity: 0.66;
      }
      .sub { font-size: 11.9px; font-weight: 900; fill: #9ed99a; text-shadow: 0 1px 2px #061009; }
      .subMetric { font-size: 11.9px; font-family: ${cardFontFamily}; text-shadow: 0 1px 2px #061009; }
      .subMetricValue { fill: #c2efbc; font-weight: 900; letter-spacing: 0.18px; }
      .subMetricLabel { fill: #739d71; font-weight: 800; letter-spacing: 0.8px; opacity: 0.96; }
      .leagueAux { fill: #c5efbc; }
      .leagueAuxMuted { fill: #c5efbc; }
      .white { fill: #f6fff5; text-shadow: 0 2px 4px #061009; }
      .headerName { fill: #fbfff8; filter: url(#headerNameShadow); }
      .meta { fill: #d4f7ff; text-shadow: 0 2px 3px #061009; }
      .noBannerHeaderName { fill: #b7d9af; }
      .noBannerMeta { fill: #82aa7e; }
      .xp { fill: #f7fff1; text-shadow: 0 2px 3px #061009; }
      .profileBoxValue { text-shadow: 0 1px 2px #061009; }
      .profileBoxValuePrimary { fill: #a9ef9e; }
      .profileBoxValueSecondary { fill: #7aa076; }
      .profileBoxValueSuffix { fill: #86a683; }
      .profileBoxSeparator { fill: #5a875d; opacity: 0.92; }
      .dangerTitle { fill: #fff8f0; text-shadow: 0 2px 3px #5d0000; }
      .dangerSub { fill: #fff4ec; text-shadow: 0 2px 3px #5d0000; }
      .bioTitle { fill: #679d63; opacity: 0.88; }
      .bioText { fill: #a7e0a0; text-shadow: 0 1px 2px #07150a; }
    </style>
  </defs>

  <rect width="960" height="${svgHeight}" fill="${tetrioPalette.pageBg}"/>
  <rect x="14" y="16" width="932" height="${cardHeight}" fill="${tetrioPalette.cardBg}" stroke="${tetrioPalette.cardBorder}" stroke-width="4" rx="3"/>
  <rect x="${bannerX}" y="${bannerY}" width="${bannerWidth}" height="${bannerHeight}" fill="url(#bannerFallback)" clip-path="url(#bannerClip)"/>
  ${assets.banner ? `<image href="${assets.banner}" x="${bannerX}" y="${bannerY}" width="${bannerWidth}" height="${bannerHeight}" preserveAspectRatio="xMidYMid slice" clip-path="url(#bannerClip)"/>` : ''}
  <rect x="${bannerX}" y="${bannerY}" width="${bannerWidth}" height="${bannerHeight}" fill="#000000" opacity="0.18" clip-path="url(#bannerClip)"/>

  <rect x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" fill="#26362c" clip-path="url(#avatarClip)"/>
  ${assets.avatar ? `<image href="${assets.avatar}" x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>` : `<text x="${avatarX + avatarSize / 2}" y="${avatarY + 55}" text-anchor="middle" font-size="38" font-weight="900" fill="#9eeaa4">${escapeXml(user.username[0]?.toUpperCase() ?? '?')}</text>`}
  <rect x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" rx="8" fill="none" stroke="#d9ffe2" stroke-width="2" opacity="0.25"/>

  <text x="${nameX}" y="${bannerY + 52}" class="${headerNameClass}" font-size="${headerNameFontSize}" font-weight="${headerNameFontWeight}">${escapeXml(headerUsername)}</text>
  ${renderHeaderFlag(flag, nameX, bannerY + 28, headerNameWidth)}
  <text x="${avatarX + avatarSize + 18}" y="${bannerY + 77}" class="${headerMetaClass}" font-size="15.5" font-weight="800">${escapeXml(joined)} - ${formatNumber(user.friend_count ?? user.friendcount ?? 0)} FRIENDS</text>
  ${renderLevelTag(levelTag, contentX, levelTagY)}
  <text x="${contentX + levelTag.width + 3}" y="${levelTextY}" class="xp" font-size="16.5" font-weight="900">${xp} XP</text>
  <rect x="${contentX}" y="${levelProgressY}" width="186" height="4" fill="${tetrioPalette.progressTrack}"/>
  <rect x="${contentX}" y="${levelProgressY}" width="${Math.round(186 * levelProgress / 100)}" height="4" fill="#bdf9bd"/>
  ${supporterBadge ? renderSupporterBadgeMarkup(supporterBadge) : ''}
  ${renderProfileStats(profileStats, profileStatsX, levelTagY + 4)}

  ${noticeMarkup.join('\n')}

  ${renderBadgeRow(badges, assets.badgeIcons, badgeY, contentX, contentWidth, badgeLayout)}

  ${renderBio(bioLines, bioY, bioHeight, contentX, contentWidth)}
  ${renderStatCard(28, topStatY, 296, 'TETRA LEAGUE', `#${formatRank(league?.standing)}`, `${formatTrNumber(league?.tr)}TR`, `${formatDecimal(league?.apm, 2)} APM   ${formatDecimal(league?.pps, 2)} PPS   ${formatDecimal(league?.vs, 2)} VS`, {
    valueIcon: assets.leagueRankIcon?.image,
    valueIconHeight: assets.leagueRankIcon?.height,
    valueFontSize: 32.3,
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
    subtextMarkup: renderLeagueMetricsSubtext(28, topStatY, 296, league),
  })}
  ${renderStatCard(332, topStatY, 296, '40 LINES', `#${formatRank(fortyLines?.rank)}`, formatTime(fortyLines?.record?.results?.stats?.finaltime), formatAgo(fortyLines?.record?.ts), {
    valueFontSize: 32.3,
    valueFormat: 'timeSplitDecimal',
    flag,
    localRank: fortyLines?.rank_local,
    worldRank: fortyLines?.rank,
  })}
  ${renderStatCard(636, topStatY, 296, 'BLITZ', `#${formatRank(blitz?.rank)}`, formatNumber(blitz?.record?.results?.stats?.score), formatAgo(blitz?.record?.ts), { valueFontSize: 32.3, flag, localRank: blitz?.rank_local, worldRank: blitz?.rank })}
  ${renderStatCard(28, bottomStatY, 448, 'QUICK PLAY', `#${formatRank(zenith?.rank)}`, `${formatAltitude(zenith?.record?.results?.stats?.zenith?.altitude)}M`, `CAREER BEST ${formatAltitude(zenith?.best?.record?.results?.stats?.zenith?.altitude)}M (#${formatRank(zenith?.best?.rank)})`, { valueFontSize: 33.4, unitFontSize: 28.4, valueFormat: 'altitudeWithUnit', flag, localRank: zenith?.rank_local, worldRank: zenith?.rank })}
  ${renderStatCard(484, bottomStatY, 448, 'EXPERT QUICK PLAY', `#${formatRank(zenithEx?.rank)}`, `${formatAltitude(zenithEx?.record?.results?.stats?.zenith?.altitude)}M`, `CAREER BEST ${formatAltitude(zenithEx?.best?.record?.results?.stats?.zenith?.altitude)}M (#${formatRank(zenithEx?.best?.rank)})`, { valueFontSize: 33.4, unitFontSize: 28.4, valueFormat: 'altitudeWithUnit', flag, localRank: zenithEx?.rank_local, worldRank: zenithEx?.rank })}

</svg>`;
}

function getSupporterBadgeLayout(tier, rightEdge = 920, y = 160) {
  const starCount = Math.max(0, Math.min(4, Number(tier) - 1));
  const height = 26;
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

  return `@font-face {
        font-family: "HUN";
        src: url("${fontDataUri}") format("truetype");
        font-weight: 400 900;
        font-style: normal;
      }`;
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
    <text x="${labelX + labelWidth / 2 - 1.5}" y="18.15" text-anchor="middle" font-family="HUN" font-size="15.8" font-weight="900" letter-spacing="0.12" fill="#fffaf3" stroke="#cc6a27" stroke-width="0.24" paint-order="stroke fill">SUPPORTER</text>
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
  const boxHeight = 24;
  const baselineY = y + 17;
  const boxWidth = getCompactProfileStatsBoxWidth(items, options);
  const boxMarkup = `<rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="4" fill="${tetrioPalette.panelBg}" stroke="${tetrioPalette.panelBg}" stroke-width="1.5"/>`;
  const contentWidth = items.reduce((sum, item) => sum + item.width, 0);
  let cursorX = x + (boxWidth - contentWidth) / 2;
  let body = '';

  for (const item of items) {
    if (item.separator === 'slash') {
      body += `<text x="${cursorX + item.width / 2}" y="${baselineY}" text-anchor="middle" class="profileBoxSeparator" font-size="16" font-weight="900">/</text>`;
      cursorX += item.width;
      continue;
    }

    const valueMarkup = item.suffix
      ? `${escapeXml(item.value)}<tspan class="${item.suffixClassName ?? 'profileBoxValueSuffix'}">${escapeXml(item.suffix)}</tspan>`
      : escapeXml(item.value);
    body += `<text x="${cursorX + item.width / 2}" y="${baselineY}" text-anchor="middle" class="profileBoxValue ${item.className}" font-size="${item.fontSize}" font-weight="900">${valueMarkup}</text>`;
    cursorX += item.width;
  }

  return `${boxMarkup}${body}`;
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
function renderBadStandingBanner(y = 204) {
  return `
  <g>
    <rect x="14" y="${y}" width="932" height="62" fill="url(#dangerStripe)"/>
    <rect x="14" y="${y}" width="932" height="62" fill="none" stroke="#ff1d1d" stroke-width="4"/>
    <text x="480" y="${y + 32}" text-anchor="middle" class="dangerTitle" font-size="24.3" font-weight="900">BAD STANDING</text>
    <text x="480" y="${y + 52}" text-anchor="middle" class="dangerSub" font-size="12.6" font-weight="900">ONE OR MORE RECENT BANS ON RECORD</text>
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
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${theme.outerFill}"/>
    <rect x="${x + 2}" y="${y + 2}" width="${width - 4}" height="${height - 4}" fill="${theme.innerFill}" stroke="${theme.border}" stroke-width="2"/>
    <rect x="${x + 2}" y="${y + 7}" width="${width - 4}" height="2" fill="${theme.accent}"/>
    <rect x="${x + 2}" y="${y + height - 9}" width="${width - 4}" height="2" fill="${theme.accent}"/>
    <polygon points="${renderStaffBannerPanelPoints(x + 12, y + 8, 146, height - 16, false)}" fill="${theme.panelFill}" opacity="0.24"/>
    <polygon points="${renderStaffBannerPanelPoints(x + width - 158, y + 8, 146, height - 16, true)}" fill="${theme.panelFill}" opacity="0.24"/>
    ${renderStaffBannerPanelLines(x + 20, y + 9, 120, height - 18, theme.panelLine, false)}
    ${renderStaffBannerPanelLines(x + width - 140, y + 9, 120, height - 18, theme.panelLine, true)}
    <text x="${x + width / 2}" y="${y + (isAlumni ? 35 : 31)}" text-anchor="middle" font-size="${isAlumni ? 18 : 17}" font-weight="900" fill="${theme.titleFill}" stroke="${theme.titleStroke}" stroke-width="0.65" paint-order="stroke fill" letter-spacing="0.9" textLength="${width - 300}" lengthAdjust="spacingAndGlyphs">${escapeXml(displayTitle)}</text>
    ${!isAlumni && footer ? `<text x="${x + width / 2}" y="${y + 46}" text-anchor="middle" font-size="14" font-weight="900" fill="${theme.footerFill}" letter-spacing="0.35" textLength="${Math.max(1, width - 390)}" lengthAdjust="spacingAndGlyphs">${escapeXml(footer)}</text>` : ''}
  </g>`;
}

function renderChampionDistinguishmentBanner(distinguishment, y, x = 14, width = 932) {
  const height = 62;
  const theme = getChampionDistinguishmentTheme(distinguishment.detail);
  const title = normalizeDistinguishmentText(distinguishment.text || 'CHAMPION');
  const outerPoints = [
    formatPoint([x, y + height / 2]),
    formatPoint([x + 15, y + 7]),
    formatPoint([x + width - 15, y + 7]),
    formatPoint([x + width, y + height / 2]),
    formatPoint([x + width - 15, y + height - 7]),
    formatPoint([x + 15, y + height - 7]),
  ].join(' ');
  const innerPoints = [
    formatPoint([x + 10, y + height / 2]),
    formatPoint([x + 24, y + 11]),
    formatPoint([x + width - 24, y + 11]),
    formatPoint([x + width - 10, y + height / 2]),
    formatPoint([x + width - 24, y + height - 11]),
    formatPoint([x + 24, y + height - 11]),
  ].join(' ');

  return `
  <g>
    <polygon points="${outerPoints}" fill="${theme.outerFill}"/>
    <polygon points="${innerPoints}" fill="${theme.innerFill}" stroke="${theme.innerStroke}" stroke-width="2.4"/>
    <line x1="${x + 26}" y1="${y + 13}" x2="${x + width - 26}" y2="${y + 13}" stroke="${theme.lineHighlight}" stroke-width="2.4" opacity="0.92"/>
    <line x1="${x + 26}" y1="${y + height - 13}" x2="${x + width - 26}" y2="${y + height - 13}" stroke="${theme.lineShadow}" stroke-width="2.4" opacity="0.8"/>
    <polygon points="${formatPoint([x + 5, y + height / 2])} ${formatPoint([x + 17, y + 11])} ${formatPoint([x + 29, y + 11])} ${formatPoint([x + 17, y + height / 2])} ${formatPoint([x + 29, y + height - 11])} ${formatPoint([x + 17, y + height - 11])}" fill="${theme.sideFill}"/>
    <polygon points="${formatPoint([x + width - 5, y + height / 2])} ${formatPoint([x + width - 17, y + 11])} ${formatPoint([x + width - 29, y + 11])} ${formatPoint([x + width - 17, y + height / 2])} ${formatPoint([x + width - 29, y + height - 11])} ${formatPoint([x + width - 17, y + height - 11])}" fill="${theme.sideFill}"/>
    <text x="${x + width / 2}" y="${y + height / 2}" text-anchor="middle" dominant-baseline="middle" font-size="28" font-weight="900" fill="${theme.titleFill}" stroke="${theme.titleStroke}" stroke-width="0.9" paint-order="stroke fill" letter-spacing="1.8" textLength="${width - 150}" lengthAdjust="spacingAndGlyphs">${escapeXml(title)}</text>
  </g>`;
}

function renderTwcDistinguishmentBanner(distinguishment, y, x = 14, width = 932) {
  const height = 62;
  const detail = normalizeDistinguishmentText(distinguishment.detail);
  const subtitle = detail
    ? `${detail} TETR.IO WORLD CHAMPIONSHIP`
    : 'TETR.IO WORLD CHAMPIONSHIP';

  return `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#25130a"/>
    <rect x="${x + 3}" y="${y + 3}" width="${width - 6}" height="${height - 6}" fill="#40200d" stroke="#ffb12a" stroke-width="2"/>
    <rect x="${x + 3}" y="${y + 3}" width="${width - 6}" height="${height - 6}" fill="none" stroke="#ffe08b" stroke-width="1" opacity="0.72"/>
    <polygon points="${renderStaffBannerPanelPoints(x + 18, y + 10, 170, height - 20, false)}" fill="#7a3f11" opacity="0.22"/>
    <polygon points="${renderStaffBannerPanelPoints(x + width - 188, y + 10, 170, height - 20, true)}" fill="#7a3f11" opacity="0.22"/>
    ${renderStaffBannerPanelLines(x + 26, y + 11, 136, height - 22, '#ffcf6a', false)}
    ${renderStaffBannerPanelLines(x + width - 162, y + 11, 136, height - 22, '#ffcf6a', true)}
    <text x="${x + width / 2}" y="${y + 30}" text-anchor="middle" font-size="22" font-weight="900" fill="#fff6dc" stroke="#5e2800" stroke-width="1.2" paint-order="stroke fill" letter-spacing="1.1" textLength="${width - 180}" lengthAdjust="spacingAndGlyphs">TETR.IO WORLD CHAMPION</text>
    <text x="${x + width / 2}" y="${y + 46}" text-anchor="middle" font-size="13.5" font-weight="900" fill="#ffd86f" letter-spacing="0.55" textLength="${width - 260}" lengthAdjust="spacingAndGlyphs">${escapeXml(subtitle)}</text>
  </g>`;
}

function renderGenericDistinguishmentBanner(distinguishment, y, x = 14, width = 932) {
  const height = 62;
  const title = normalizeDistinguishmentText(distinguishment.text || distinguishment.header || 'SPECIAL DISTINGUISHMENT');
  const subtitle = normalizeDistinguishmentText(distinguishment.footer || '');

  return `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#10261d"/>
    <rect x="${x + 2}" y="${y + 2}" width="${width - 4}" height="${height - 4}" fill="#183329" stroke="#7ec98d" stroke-width="2"/>
    <rect x="${x + 2}" y="${y + 7}" width="${width - 4}" height="2" fill="#b6ffb0" opacity="0.88"/>
    <rect x="${x + 2}" y="${y + height - 9}" width="${width - 4}" height="2" fill="#b6ffb0" opacity="0.88"/>
    <text x="${x + width / 2}" y="${y + (subtitle ? 30 : 36)}" text-anchor="middle" font-size="${subtitle ? 22 : 24}" font-weight="900" fill="#f4fff2" stroke="#163524" stroke-width="0.9" paint-order="stroke fill" letter-spacing="1" textLength="${width - 140}" lengthAdjust="spacingAndGlyphs">${escapeXml(title)}</text>
    ${subtitle ? `<text x="${x + width / 2}" y="${y + 46}" text-anchor="middle" font-size="13.5" font-weight="900" fill="#b8efb8" letter-spacing="0.4" textLength="${width - 240}" lengthAdjust="spacingAndGlyphs">${escapeXml(subtitle)}</text>` : ''}
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
        outerFill: '#d4b52f',
        innerFill: '#7cd2da',
        innerStroke: '#fff0a8',
        lineHighlight: '#ffe98d',
        lineShadow: '#5ca6b0',
        sideFill: '#f4c721',
        titleFill: '#5c8488',
        titleStroke: '#def8fb',
      };
    case 'blitz':
      return {
        outerFill: '#d94334',
        innerFill: '#7ac6d8',
        innerStroke: '#ffc8b1',
        lineHighlight: '#ffaea1',
        lineShadow: '#4f90a6',
        sideFill: '#bc2214',
        titleFill: '#e9fff9',
        titleStroke: '#4f7b90',
      };
    case 'league':
      return {
        outerFill: '#c52bc6',
        innerFill: '#ffc423',
        innerStroke: '#ff7af1',
        lineHighlight: '#ffe28a',
        lineShadow: '#cf7f00',
        sideFill: '#8e1db0',
        titleFill: '#c6881d',
        titleStroke: '#ffe9a8',
      };
    case 'x-multiple':
      return {
        outerFill: '#7d79d9',
        innerFill: '#ffd03f',
        innerStroke: '#f4f0ff',
        lineHighlight: '#fff2a2',
        lineShadow: '#c79711',
        sideFill: '#6650c8',
        titleFill: '#8f640d',
        titleStroke: '#fff4c0',
      };
    default:
      return {
        outerFill: '#5f8f60',
        innerFill: '#d8f2a2',
        innerStroke: '#edfbd2',
        lineHighlight: '#ffffff',
        lineShadow: '#8bb85c',
        sideFill: '#3f7041',
        titleFill: '#355b23',
        titleStroke: '#f7ffe2',
      };
  }
}

function getCountryFlag(country, image) {
  const code = normalizeCountryCode(country);
  return code && image
    ? { code, image }
    : null;
}

function renderHeaderFlag(flag, nameX, y, nameWidth) {
  if (!flag) {
    return '';
  }

  const flagWidth = 30;
  const flagHeight = 20;
  const maxX = 894;
  const x = Math.min(nameX + nameWidth + 8, maxX);
  const adjustedY = y - 5;

  return `<image href="${flag.image}" x="${x}" y="${adjustedY}" width="${flagWidth}" height="${flagHeight}" preserveAspectRatio="xMidYMid meet"/>`;
}

async function measureHeaderNameWidth(text, fontSize, fontDataUri = null, fontWeight = 700) {
  const normalizedText = String(text ?? '').trim();
  if (!normalizedText) {
    return 0;
  }

  const fallbackWidth = estimateHeaderNameWidth(normalizedText, fontSize);

  try {
    const horizontalPadding = 32;
    const verticalPadding = 24;
    const svgWidth = Math.max(256, Math.ceil(fallbackWidth + horizontalPadding * 2 + fontSize));
    const svgHeight = Math.max(96, Math.ceil(fontSize + verticalPadding * 2));
    const baselineY = verticalPadding + fontSize * 0.82;
    const measurementSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
  <defs>
    <style>${renderTetrioFontFace(fontDataUri)}</style>
  </defs>
  <rect width="${svgWidth}" height="${svgHeight}" fill="transparent"/>
  <text x="${horizontalPadding}" y="${baselineY}" font-family="${escapeXml(cardFontFamily)}" font-size="${fontSize}" font-weight="${fontWeight}" fill="#ffffff">${escapeXml(normalizedText)}</text>
</svg>`;
    const { info } = await sharp(Buffer.from(measurementSvg))
      .png()
      .trim()
      .toBuffer({ resolveWithObject: true });

    return Math.max(fallbackWidth, info.width);
  } catch {
    return fallbackWidth;
  }
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
  const height = 28;
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
    <text x="9" y="20.5" font-size="19" font-weight="900" fill="${textFill}" opacity="${textOpacity}">${escapeXml(tag.text)}</text>
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

function renderBio(lines, y, height, x = 36, width = 888) {
  if (lines.length === 0) {
    return '';
  }

  const textX = x + 12;

  return `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${tetrioPalette.panelBg}"/>
    <rect x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${height - 2}" fill="none" stroke="${tetrioPalette.panelBorder}" stroke-width="2"/>
    <text x="${textX}" y="${y + 19}" class="bioTitle" font-size="14.5" font-weight="900">ABOUT ME</text>
    <text x="${textX}" y="${y + bioTextBaselineOffsetY}" class="bioText" font-size="16" font-weight="800" clip-path="url(#bioClip)">
      ${lines.map((line, index) => `<tspan x="${textX}" dy="${index === 0 ? 0 : bioTextLineHeight}">${escapeXml(line)}</tspan>`).join('')}
    </text>
  </g>`;
}

function renderStatCard(x, y, width, label, rank, value, subtext, options = {}) {
  const valueY = y + 58;
  const lineY = y + 68;
  const cardHeight = 92;
  const valueFontSize = options.valueFontSize ?? (String(value).length > 10 ? 21 : 24);
  const iconValueFontSize = valueFontSize;
  const rankMarkup = renderRankLabel(x, y, width, rank, options);
  const subtextMarkup = options.subtextMarkup
    ?? `<text x="${x + width / 2}" y="${y + 85}" text-anchor="middle" class="sub">${escapeXml(subtext)}</text>`;
  const valueMarkup = renderStatCardValueMarkup(x, y, width, valueY, value, valueFontSize, iconValueFontSize, options);

  return `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="${cardHeight}" fill="${tetrioPalette.panelBg}"/>
    <rect x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${cardHeight - 2}" fill="none" stroke="${tetrioPalette.panelBorder}" stroke-width="2"/>
    <text x="${x + 12}" y="${y + 21}" class="label">${escapeXml(label)}</text>
    ${rankMarkup}
    ${valueMarkup}
    <line x1="${x + 28}" y1="${lineY}" x2="${x + width - 28}" y2="${lineY}" stroke="${tetrioPalette.divider}" stroke-width="2"/>
    ${subtextMarkup}
  </g>`;
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

function renderLeagueStatValueMarkup(x, width, valueY, value, fontSize, options) {
  const iconSize = Math.max(0, (options.valueIconSize ?? 35) - 1);
  const iconGap = 8;
  const iconMetrics = getLeagueIconRenderMetrics(options, iconSize);
  const unitFontSize = getTimedDecimalFontSize(fontSize);
  const valueWidth = estimateLeagueMainValueWidth(value, fontSize, unitFontSize);
  const valueNudgeX = 8;
  const valueAuxGap = 6;
  const auxBracketArmLength = 4;
  const auxBracketInnerPaddingX = 2;
  const auxBracketRightPaddingX = 8;
  const glickoText = formatGlickoValue(options.glicko);
  const rdText = formatRdValue(options.rd);
  const auxTextWidth = Math.max(
    estimateLeagueAuxTextWidth(glickoText, 11.3),
    estimateLeagueAuxTextWidth(`±${rdText}`, 11.3),
  );
  const auxBlockWidth = (auxBracketArmLength * 2) + (auxBracketInnerPaddingX * 2) + auxTextWidth + auxBracketRightPaddingX;
  const groupWidth = iconMetrics.renderedWidth + iconGap + valueWidth + valueAuxGap + auxBlockWidth;
  const groupLeftX = x + (width - groupWidth) / 2;
  const iconX = roundSvgNumber(groupLeftX - iconMetrics.xInset);
  const iconY = roundSvgNumber(getStatValueVisualBottomY(valueY, fontSize) - iconSize + 1);
  const valueRightX = roundSvgNumber(groupLeftX + iconMetrics.renderedWidth + iconGap + valueWidth + valueNudgeX);
  const auxBlockLeftX = roundSvgNumber(valueRightX + valueAuxGap);
  const auxTextX = roundSvgNumber(auxBlockLeftX + auxBracketArmLength + auxBracketInnerPaddingX);
  const auxOffsetY = -1;
  const glickoY = roundSvgNumber(valueY - 13 + auxOffsetY);
  const rdY = roundSvgNumber(valueY + 1 + auxOffsetY);
  const auxBracketTopY = roundSvgNumber(glickoY - 12);
  const auxBracketBottomY = roundSvgNumber(rdY + 2);
  const auxBracketRightX = roundSvgNumber(auxBlockLeftX + auxBlockWidth - 1);
  const auxBracketLeftInnerX = roundSvgNumber(auxBlockLeftX + auxBracketArmLength);
  const auxBracketRightInnerX = roundSvgNumber(auxBracketRightX - auxBracketArmLength);

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
    <text x="${auxTextX}" y="${glickoY}" text-anchor="start" class="leagueAux" font-size="11.3" font-weight="900">${escapeXml(glickoText)}</text>
    <text x="${auxTextX}" y="${rdY}" text-anchor="start" class="leagueAuxMuted" font-weight="900"><tspan font-size="13">${escapeXml('±')}</tspan><tspan font-size="11.3">${escapeXml(rdText)}</tspan></text>`;
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
    <tspan class="subMetricValue">${escapeXml(formatDecimal(league?.apm, 2))}</tspan>
    <tspan dx="0.9" class="subMetricLabel">APM</tspan>
    <tspan dx="4.5" class="subMetricValue">${escapeXml(formatDecimal(league?.pps, 2))}</tspan>
    <tspan dx="0.9" class="subMetricLabel">PPS</tspan>
    <tspan dx="4.5" class="subMetricValue">${escapeXml(formatDecimal(league?.vs, 2))}</tspan>
    <tspan dx="0.9" class="subMetricLabel">VS</tspan>
  </text>`;
}

function renderRankLabel(x, y, width, fallbackRank, options) {
  const hasLocalRank = isPositiveRank(options.localRank);
  const hasWorldRank = isPositiveRank(options.worldRank);
  const plainRankFontSize = 14;
  const plainFlagWidth = 18;
  const plainFlagHeight = 13;
  const rightX = x + width - 10;
  const worldText = `N&#176;${formatRank(options.worldRank)}`;
  const worldBadge = hasWorldRank
    ? renderWorldRankBadge(options.worldRank, worldText, rightX, y + 8)
    : null;

  if (!hasWorldRank) {
    return renderPlainRankText(rightX, y + 22, fallbackRank, 'end');
  }

  if (!options.flag || !hasLocalRank) {
    return worldBadge
      ? worldBadge.markup
      : renderPlainRankText(rightX, y + 22, worldText, 'end');
  }

  const localText = `N&#176;${formatRank(options.localRank)}`;
  const localWidth = estimateRankTextWidth(localText, plainRankFontSize);
  const worldMarkup = worldBadge
    ? worldBadge.markup
    : renderPlainRankText(rightX, y + 22, worldText, 'end');
  const worldLeftX = worldBadge
    ? worldBadge.leftX
    : rightX - estimateRankTextWidth(worldText, plainRankFontSize);
  const localTextX = worldLeftX - 8;
  const flagX = localTextX - localWidth - plainFlagWidth - 4;

  return `
    <image href="${options.flag.image}" x="${flagX}" y="${y + 10}" width="${plainFlagWidth}" height="${plainFlagHeight}" preserveAspectRatio="xMidYMid meet"/>
    ${renderPlainRankText(localTextX, y + 22, localText, 'end')}
    ${worldMarkup}`;
}

function renderWorldRankBadge(rank, label, rightX, y) {
  const badgeStyle = getWorldRankBadgeStyle(rank);
  if (!badgeStyle) {
    return null;
  }

  const badgeFontSize = 12.5;
  const textWidth = estimateRankTextWidth(label, badgeFontSize);
  const badgeWidth = Math.max(36, textWidth + 13);
  const badgeHeight = 15.2;
  const leftX = rightX - badgeWidth;
  const points = [
    formatPoint([leftX + 7.2, y]),
    formatPoint([rightX, y]),
    formatPoint([rightX, y + badgeHeight]),
    formatPoint([leftX + 3.6, y + badgeHeight]),
    formatPoint([leftX, y + badgeHeight / 2]),
  ].join(' ');

  return {
    leftX,
    markup: `
    <polygon points="${points}" fill="${badgeStyle.fill}"/>
    <text x="${leftX + badgeWidth / 2 + 0.9}" y="${y + 11.8}" text-anchor="middle" font-size="${badgeFontSize}" font-weight="900" fill="${badgeStyle.textFill}">${label}</text>`,
  };
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
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="plainRank">${value}</text>`;
}

function estimateRankTextWidth(value, fontSize = 11) {
  return Math.ceil(String(value).replaceAll('&#176;', 'o').length * fontSize * 0.64);
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
    { text: text.slice(0, splitIndex), fontSize },
    { text: text.slice(splitIndex), fontSize: getTimedDecimalFontSize(fontSize) },
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
  const segmentMarkup = segments
    .map(({ text, fontSize }) => `<tspan font-size="${fontSize}">${escapeXml(text)}</tspan>`)
    .join('');
  const attributesMarkup = attributes ? ` ${attributes}` : '';
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${className}"${attributesMarkup}>${segmentMarkup}</text>`;
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

function formatLevelProgress(xp) {
  const level = xpToLevel(xp);
  return Number.isFinite(level) ? Math.floor((level % 1) * 100) : 0;
}

function formatXp(xp) {
  return Number.isFinite(xp) && xp >= 0 ? Math.floor(xp).toLocaleString('en-US') : '0';
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

async function measureBioHangulWidth(fontSize, fontDataUri = null) {
  if (!fontDataUri) {
    return null;
  }

  try {
    const sampleText = '가'.repeat(8);
    const sampleWidth = await measureBioSampleWidth(sampleText, fontSize, fontDataUri);
    return sampleWidth > 0
      ? sampleWidth / sampleText.length
      : null;
  } catch {
    return null;
  }
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
  <text x="${horizontalPadding}" y="${baselineY}" font-family="${escapeXml(cardFontFamily)}" font-size="${fontSize}" font-weight="800" fill="#ffffff">${escapeXml(normalizedText)}</text>
</svg>`;
  const { info } = await sharp(Buffer.from(measurementSvg))
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

  if (fontDataUri) {
    return wrapBioParagraphMeasured(
      normalizedText,
      maxWidth,
      fontSize,
      fontDataUri,
      new Map(),
    );
  }

  const hangulWidth = Number.isFinite(options.hangulWidth) ? options.hangulWidth : null;
  return wrapBioParagraphEstimated(normalizedText, maxWidth, hangulWidth);
}

function normalizeBioText(value) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u00a0\u1680\u2000-\u200f\u2028-\u202f\u205f\u2060\u3000\u3164\ufeff]/gu, ' ')
    .replace(/\s+/g, ' ')
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
  const chars = Array.from(token);
  const lines = [];
  let index = 0;

  while (index < chars.length) {
    let slice = chars[index];
    let nextIndex = index + 1;

    while (nextIndex < chars.length) {
      const candidate = slice + chars[nextIndex];
      const candidateWidth = await measureBioTextWidthCached(
        candidate,
        fontSize,
        fontDataUri,
        measurementCache,
      );
      if (candidateWidth > maxWidth) {
        break;
      }

      slice = candidate;
      nextIndex += 1;
    }

    lines.push(slice);
    index = nextIndex;
  }

  return lines;
}

async function measureBioTextWidthCached(text, fontSize, fontDataUri, measurementCache) {
  if (measurementCache.has(text)) {
    return measurementCache.get(text);
  }

  const width = await measureBioSampleWidth(text, fontSize, fontDataUri);
  measurementCache.set(text, width);
  return width;
}

function wrapBioParagraphEstimated(paragraph, maxWidth, hangulWidth = null) {
  const lines = [];
  let line = '';
  let lineWidth = 0;

  for (const char of paragraph) {
    const charWidth = getBioCharWidth(char, hangulWidth);
    if (line && lineWidth + charWidth > maxWidth) {
      lines.push(line.trimEnd());
      line = '';
      lineWidth = 0;
    }

    line += char;
    lineWidth += charWidth;
  }

  if (line) {
    lines.push(line.trimEnd());
  }

  return lines;
}

function getBioCharWidth(char, hangulWidth = null) {
  if (/[\u1100-\u11ff\u3130-\u318f\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/u.test(char)) {
    return hangulWidth ?? 15.9;
  }

  if (/[MW@#%&]/.test(char)) {
    return 14.2;
  }

  if (/\s/.test(char)) {
    return 5.4;
  }

  if (/[A-Z0-9]/.test(char)) {
    return 11.8;
  }

  if (/[a-z]/.test(char)) {
    return 10.1;
  }

  if (/[.,!:'";|]/.test(char)) {
    return 6.4;
  }

  return 9.6;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}


