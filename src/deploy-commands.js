import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const { DISCORD_TOKEN, CLIENT_ID } = process.env;
const guildId = process.env.GUILD_ID?.trim();
const dailyPuzzleAnnouncementGuildId = '1219197226572840990';

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('DISCORD_TOKEN and CLIENT_ID must be set in .env');
  process.exit(1);
}

const quickPlayRecordChoices = [
  { name: 'top', value: 'top' },
  { name: 'recent', value: 'recent' },
];

const commands = [
  new SlashCommandBuilder()
    .setName('도움말')
    .setDescription('사용 가능한 명령어를 보여줍니다.')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('검색')
    .setDescription('웹 검색 결과를 바탕으로 최신 정보를 정리합니다.')
    .addStringOption((option) =>
      option
        .setName('질문')
        .setDescription('검색할 질문 또는 키워드')
        .setRequired(true)
        .setMaxLength(300)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('가르치기')
    .setDescription('만료되지 않는 영구 기억에 정보를 저장합니다.')
    .addStringOption((option) =>
      option
        .setName('정보')
        .setDescription('봇이 영구적으로 기억할 정보')
        .setRequired(true)
        .setMaxLength(1800)
    )
    .toJSON(),
  new SlashCommandBuilder()
  .setName('일일퍼즐지정')
  .setDescription('이 채널을 매일 일일 체스 퍼즐 알림 채널로 지정합니다.')
  .toJSON(),

new SlashCommandBuilder()
  .setName('일일퍼즐')
  .setDescription('오늘의 일일 체스 퍼즐을 DM으로 받습니다.')
  .toJSON(),
new SlashCommandBuilder()
  .setName('퍼즐리더보드')
  .setDescription('일일퍼즐 참가자 퍼즐 레이팅 상위 10명을 보여줍니다.')
  .toJSON(),
  new SlashCommandBuilder()
    .setName('체닷')
    .setDescription('Chess.com 레이팅을 조회합니다.')
    .addStringOption((option) =>
      option
        .setName('닉네임')
        .setDescription('Chess.com 닉네임 또는 프로필 주소')
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('리체스')
    .setDescription('Lichess 레이팅을 조회합니다.')
    .addStringOption((option) =>
      option
        .setName('멤버이름')
        .setDescription('Lichess 멤버 이름 또는 프로필 주소')
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('테토')
    .setDescription('TETR.IO 프로필 카드를 이미지로 보여줍니다.')
    .addStringOption((option) =>
      option
        .setName('닉네임')
        .setDescription('TETR.IO 닉네임 또는 프로필 주소, 생략하면 연동된 계정')
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('스탯')
    .setDescription('TETR.IO 스탯 카드 형식을 보여줍니다.')
    .addStringOption((option) =>
      option
        .setName('닉네임')
        .setDescription('TETR.IO 닉네임 또는 프로필 주소, 생략하면 연동된 계정')
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('그래프')
    .setDescription('TETR.IO Opener/Plonk/Stride/Inf DS 그래프를 보여줍니다.')
    .addStringOption((option) =>
      option
        .setName('닉네임')
        .setDescription('TETR.IO 닉네임 여러 개 또는 APM PPS VS 숫자 3개, 생략하면 연동된 계정')
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('비교')
    .setDescription('TETR.IO 주요 스탯 비교 그래프를 보여줍니다.')
    .addStringOption((option) =>
      option
        .setName('닉네임')
        .setDescription('TETR.IO 닉네임 여러 개 또는 APM PPS VS 숫자 3개, 생략하면 연동된 계정')
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('분석')
    .setDescription('첨부한 TETR.IO 리플레이 파일을 MinoMuncher 그래프로 분석합니다.')
    .addAttachmentOption((option) =>
      option
        .setName('파일')
        .setDescription('선택사항: TETR.IO .ttrm 리플레이 파일')
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('랭크컷')
    .setDescription('TETRA LEAGUE 랭크컷 이미지를 보여줍니다.')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('전적')
    .setDescription('TETR.IO TETRA LEAGUE 최근 경기 전적을 이미지로 보여줍니다.')
    .addStringOption((option) =>
      option
        .setName('닉네임')
        .setDescription('TETR.IO 닉네임 또는 프로필 주소, 생략하면 연동된 계정')
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName('숫자')
        .setDescription('가져올 경기 순번, 기본값은 1')
        .setRequired(false)
        .setMinValue(1)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('체스비교')
    .setDescription('두 사람의 체스 레이팅과 예상 승률을 비교합니다.')
    .addStringOption((option) =>
      option
        .setName('플랫폼')
        .setDescription('비교할 플랫폼')
        .setRequired(true)
        .addChoices(
          { name: '체닷', value: 'chesscom' },
          { name: '리체스', value: 'lichess' }
        )
    )
    .addStringOption((option) =>
      option
        .setName('타임컨트롤')
        .setDescription('비교할 타임컨트롤')
        .setRequired(true)
        .addChoices(
          { name: '래피드', value: 'rapid' },
          { name: '블리츠', value: 'blitz' },
          { name: '불릿', value: 'bullet' }
        )
    )
    .addStringOption((option) =>
      option
        .setName('닉네임1')
        .setDescription('첫 번째 닉네임 또는 프로필 주소')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('닉네임2')
        .setDescription('두 번째 닉네임 또는 프로필 주소')
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('승률예측')
    .setDescription('점수 두 개로 Elo 기반 예상 승률을 계산합니다.')
    .addIntegerOption((option) =>
      option
        .setName('점수1')
        .setDescription('첫 번째 점수')
        .setRequired(true)
        .setMinValue(1)
    )
    .addIntegerOption((option) =>
      option
        .setName('점수2')
        .setDescription('두 번째 점수')
        .setRequired(true)
        .setMinValue(1)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('알람')
    .setDescription('몇 분 뒤에 알람 내용을 멘션으로 알려줍니다.')
    .addStringOption((option) =>
      option
        .setName('내용')
        .setDescription('알람으로 받을 내용')
        .setRequired(true)
        .setMaxLength(500)
    )
    .addIntegerOption((option) =>
      option
        .setName('분')
        .setDescription('몇 분 뒤에 알람을 받을지, 1분부터 10080분까지')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10080)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('라이브레이팅')
    .setDescription('2700chess 라이브레이팅 순위를 조회합니다.')
    .addStringOption((option) =>
      option
        .setName('종류')
        .setDescription('조회할 레이팅 종류')
        .setRequired(true)
        .addChoices(
          { name: '클래시컬', value: 'classical' },
          { name: '블리츠', value: 'blitz' },
          { name: '래피드', value: 'rapid' }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName('사람수')
        .setDescription('출력할 사람 수, 1명부터 50명까지')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(50)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('퀵플')
    .setDescription('TETR.IO 퀵플레이 top 또는 recent 기록의 고도를 이미지로 보여줍니다.')
    .addStringOption((option) =>
      option
        .setName('닉네임')
        .setDescription('TETR.IO 닉네임 또는 프로필 주소, 생략하면 연동된 계정')
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName('숫자')
        .setDescription('가져올 기록 순번, 기본값은 1')
        .setRequired(false)
        .setMinValue(1)
    )
    .addStringOption((option) =>
      option
        .setName('recent')
        .setDescription('생략하면 top, recent를 고르면 최근 기록 기준으로 가져옵니다.')
        .setRequired(false)
        .addChoices(...quickPlayRecordChoices)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('익스퀵플')
    .setDescription('TETR.IO 익스퍼트 퀵플레이 top 또는 recent 기록의 고도를 이미지로 보여줍니다.')
    .addStringOption((option) =>
      option
        .setName('닉네임')
        .setDescription('TETR.IO 닉네임 또는 프로필 주소, 생략하면 연동된 계정')
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName('숫자')
        .setDescription('가져올 기록 순번, 기본값은 1')
        .setRequired(false)
        .setMinValue(1)
    )
    .addStringOption((option) =>
      option
        .setName('recent')
        .setDescription('생략하면 top, recent를 고르면 최근 기록 기준으로 가져옵니다.')
        .setRequired(false)
        .addChoices(...quickPlayRecordChoices)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('40라인')
    .setDescription('TETR.IO 40 LINES top 또는 recent 기록의 시간을 이미지로 보여줍니다.')
    .addStringOption((option) =>
      option
        .setName('닉네임')
        .setDescription('TETR.IO 닉네임 또는 프로필 주소, 생략하면 연동된 계정')
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName('숫자')
        .setDescription('가져올 기록 순번, 기본값은 1')
        .setRequired(false)
        .setMinValue(1)
    )
    .addStringOption((option) =>
      option
        .setName('recent')
        .setDescription('생략하면 top, recent를 고르면 최근 기록 기준으로 가져옵니다.')
        .setRequired(false)
        .addChoices(...quickPlayRecordChoices)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('블리츠')
    .setDescription('TETR.IO BLITZ top 또는 recent 기록의 점수를 이미지로 보여줍니다.')
    .addStringOption((option) =>
      option
        .setName('닉네임')
        .setDescription('TETR.IO 닉네임 또는 프로필 주소, 생략하면 연동된 계정')
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName('숫자')
        .setDescription('가져올 기록 순번, 기본값은 1')
        .setRequired(false)
        .setMinValue(1)
    )
    .addStringOption((option) =>
      option
        .setName('recent')
        .setDescription('생략하면 top, recent를 고르면 최근 기록 기준으로 가져옵니다.')
        .setRequired(false)
        .addChoices(...quickPlayRecordChoices)
    )
    .toJSON(),
];

const dailyPuzzleAnnouncementCommand = new SlashCommandBuilder()
  .setName('일일퍼즐공지')
  .setDescription('지정 서버의 일일퍼즐 공지를 즉시 강제로 발송합니다.')
  .toJSON();

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

try {
  console.log(`Registering ${commands.length} global slash command(s)...`);

  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('Global slash commands registered. They can take up to an hour to appear.');

  const guildCommandBodies = new Map();

  if (guildId) {
    guildCommandBodies.set(guildId, []);
  }

  guildCommandBodies.set(dailyPuzzleAnnouncementGuildId, [
    dailyPuzzleAnnouncementCommand,
  ]);

  for (const [targetGuildId, body] of guildCommandBodies.entries()) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, targetGuildId), { body });
    console.log(`Guild slash commands registered for ${targetGuildId}.`);
  }
} catch (error) {
  console.error('Failed to register slash commands:');
  console.error(error);
  process.exit(1);
}
