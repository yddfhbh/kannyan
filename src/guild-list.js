import { EmbedBuilder } from 'discord.js';

export const GUILD_LIST_EMBED_MARKER = 'KanNyan guild-list v2';
const MAX_EMBED_FIELDS = 25;
const MAX_EMBED_TEXT = 5800;

function escapeMarkdown(value) {
  return String(value ?? '이름 알 수 없음')
    .replace(/([\\`*_{}[\]()#+\-.!|>~])/g, '\\$1');
}

function guildEntries(state) {
  return Object.entries(state?.guilds ?? {})
    .map(([id, guild]) => ({ id, ...guild }))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ko');
    });
}

function embedTextLength(embed) {
  const json = embed.toJSON();
  return [
    json.title,
    json.description,
    json.footer?.text,
    ...(json.fields ?? []).flatMap((field) => [field.name, field.value]),
  ].filter(Boolean).join('').length;
}

function createEmbed({ section, entries, page, pageCount, generatedAt, counts }) {
  const status = section === 'active' ? '참가' : '탈퇴';
  const embed = new EmbedBuilder()
    .setColor(section === 'active' ? 0x57f287 : 0x747f8d)
    .setTitle(`${status} 서버 (${page}/${pageCount})`)
    .setDescription([
      `마지막 갱신(KST): ${generatedAt}`,
      `현재 참가: ${counts.active}개 / 탈퇴 기록: ${counts.left}개 / 전체 기록: ${counts.total}개`,
    ].join('\n'))
    .setFooter({ text: GUILD_LIST_EMBED_MARKER });

  for (const guild of entries) {
    const memberText = guild.memberCount == null ? '확인 불가' : String(guild.memberCount);
    embed.addFields({
      name: section === 'active' ? '🟢 참가 서버' : '⚫ 탈퇴 서버',
      value: [
        `**이름:** ${escapeMarkdown(guild.name)}`,
        `**서버 ID:** \`${String(guild.id)}\``,
        `**멤버 수:** ${memberText}`,
        `**상태:** ${status}`,
      ].join('\n'),
      inline: false,
    });
  }

  if (entries.length === 0) {
    embed.addFields({ name: '기록 없음', value: '이 상태의 서버 기록이 없습니다.', inline: false });
  }

  return embed;
}

function splitEntries(sectionEntries, makeEmbed) {
  const pages = [];
  let current = [];

  for (const entry of sectionEntries) {
    if (current.length >= MAX_EMBED_FIELDS) {
      pages.push(current);
      current = [];
    }
    const candidate = [...current, entry];
    const candidateEmbed = makeEmbed(candidate, 1, 1);
    if (
      current.length > 0 &&
      (candidate.length > MAX_EMBED_FIELDS || embedTextLength(candidateEmbed) > MAX_EMBED_TEXT)
    ) {
      pages.push(current);
      current = [entry];
    } else {
      current = candidate;
    }
  }

  if (current.length > 0 || pages.length === 0) pages.push(current);
  return pages;
}

export function buildGuildListEmbeds(state, now = new Date()) {
  const guilds = guildEntries(state);
  const counts = {
    active: guilds.filter((guild) => guild.status === 'active').length,
    left: guilds.filter((guild) => guild.status === 'left').length,
    total: guilds.length,
  };
  const generatedAt = new Date(now).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const embeds = [];

  for (const section of ['active', 'left']) {
    const entries = guilds.filter((guild) => guild.status === section);
    const pages = splitEntries(entries, (pageEntries, page, pageCount) => createEmbed({
      section, entries: pageEntries, page, pageCount, generatedAt, counts,
    }));
    pages.forEach((pageEntries, index) => embeds.push(createEmbed({
      section, entries: pageEntries, page: index + 1, pageCount: pages.length, generatedAt, counts,
    })));
  }

  return embeds;
}

export function validateGuildListEmbeds(embeds) {
  return embeds.every((embed) => {
    const json = embed.toJSON();
    return (json.fields?.length ?? 0) <= MAX_EMBED_FIELDS
      && embedTextLength(embed) <= MAX_EMBED_TEXT
      && (json.description?.length ?? 0) <= 4096
      && (json.fields ?? []).every((field) => field.name.length <= 256 && field.value.length <= 1024);
  });
}
