import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSlashCommands,
  buildPreservingCommandPlan,
  getGuildRegistrationPlan,
  getGlobalRegistrationPlan,
  registerSlashCommands,
} from '../src/deploy-commands.js';

const command = (name, description = `${name} 기존 명령어`) => ({
  name,
  description,
  type: 1,
});

test('buildSlashCommands includes 스타일 command with optional 닉네임 option', () => {
  const commands = buildSlashCommands();
  const styleCommand = commands.find((command) => command.name === '스타일');

  assert.ok(styleCommand);
  assert.equal(styleCommand.description, 'TETR.IO 공격/속도/수비/치즈 스타일 그래프를 보여줍니다.');
  assert.equal(styleCommand.options?.length, 1);
  assert.equal(styleCommand.options[0].name, '닉네임');
  assert.equal(styleCommand.options[0].required, false);
});

test('buildSlashCommands includes daily puzzle clear command', () => {
  const commands = buildSlashCommands();
  const setCommand = commands.find((command) => command.name === '일일퍼즐지정');
  const clearCommand = commands.find((command) => command.name === '일일퍼즐해제');
  const resetCommand = commands.find((command) => command.name === '일일퍼즐기록초기화');

  assert.ok(setCommand);
  assert.equal(setCommand.description, '이 채널을 매일 일일 체스 퍼즐 알림 채널로 지정합니다.');

  assert.ok(clearCommand);
  assert.equal(clearCommand.description, '이 서버의 일일 체스 퍼즐 알림 채널 지정을 해제합니다.');

  assert.ok(resetCommand);
  assert.equal(resetCommand.description, '오늘 일일퍼즐 기록을 지워 다시 풀 수 있게 합니다.');
  assert.equal(resetCommand.default_member_permissions, String(8n));
  assert.equal(resetCommand.options?.length, 1);
  assert.equal(resetCommand.options[0].name, '유저');
  assert.equal(resetCommand.options[0].required, false);
});

test('buildSlashCommands replaces 검색 with 말걸기 conversation command', () => {
  const commands = buildSlashCommands();
  const searchCommand = commands.find((command) => command.name === '검색');
  const talkCommand = commands.find((command) => command.name === '말걸기');

  assert.equal(searchCommand, undefined);
  assert.ok(talkCommand);
  assert.equal(talkCommand.description, '깐냥이에게 말을 겁니다.');
  assert.equal(talkCommand.options?.find((option) => option.name === '질문')?.required, true);
  assert.equal(talkCommand.options?.find((option) => option.name === '질문')?.type, 3);
  assert.equal(talkCommand.options?.find((option) => option.name === '이미지')?.required, false);
  assert.equal(talkCommand.options?.find((option) => option.name === '이미지')?.type, 11);
});

test('command registration plan preserves unknown existing commands and never schedules deletion', () => {
  const desired = [command('신규명령')];
  const plan = buildPreservingCommandPlan([
    command('기존명령'),
    command('신규명령', '기존 정의'),
  ], desired);

  assert.deepEqual(plan.body.map((item) => item.name), ['기존명령', '신규명령']);
  assert.deepEqual(plan.preserved, ['기존명령']);
  assert.deepEqual(plan.replaced, ['신규명령']);
  assert.deepEqual(plan.added, []);
  assert.deepEqual(plan.deleted, []);
});

test('guild registration preserves existing commands and fixed daily puzzle command', () => {
  const plan = getGuildRegistrationPlan([
    command('길드전용'),
    command('일일퍼즐공지', '기존 정의'),
  ], [{ name: '일일퍼즐공지', description: '새 정의', type: 1 }]);

  assert.deepEqual(plan.body.map((item) => item.name), ['길드전용', '일일퍼즐공지']);
  assert.deepEqual(plan.preserved, ['길드전용']);
  assert.deepEqual(plan.replaced, ['일일퍼즐공지']);
  assert.deepEqual(plan.deleted, []);
});

test('global registration keeps Activity and existing commands while adding all TETR.IO login commands', () => {
  const existing = [
    command('기존글로벌'),
    { name: 'KanNyan', description: 'Activity', type: 4, handler: 2 },
  ];
  const plan = getGlobalRegistrationPlan(existing);
  const names = plan.body.map((item) => item.name);

  assert.ok(names.includes('기존글로벌'));
  assert.ok(names.includes('KanNyan'));
  assert.ok(names.includes('리오로그인'));
  assert.ok(names.includes('리오로그인수정'));
  assert.ok(names.includes('리오로그인삭제'));
  assert.equal(plan.deleted.length, 0);
  assert.equal(new Set(plan.body.map((item) => `${item.type}:${item.name}`)).size, plan.body.length);
});

test('registration reads every scope before PUT and does not delete on API failure', async () => {
  const calls = [];
  const rest = {
    async get(route) {
      calls.push(['get', route]);
      if (route.includes('/guilds/')) return [];
      return [{ name: 'KanNyan', description: 'Activity', type: 4, handler: 2 }];
    },
    async put(route, payload) {
      calls.push(['put', route, payload]);
      throw new Error('simulated Discord API failure');
    },
  };

  await assert.rejects(
    registerSlashCommands({ rest, clientId: 'client-id', guildId: 'configured-guild', log: () => {} }),
    /simulated Discord API failure/
  );

  assert.equal(calls.filter(([method]) => method === 'get').length, 3);
  assert.equal(calls.some(([method]) => method === 'delete'), false);
  assert.equal(calls.filter(([method]) => method === 'put').length, 1);
  assert.equal(calls[0][0], 'get');
  assert.equal(calls[1][0], 'get');
  assert.equal(calls[2][0], 'get');
});

test('TETR.IO login commands retain restricted administrator permission', () => {
  const commands = buildSlashCommands();
  for (const name of ['리오로그인', '리오로그인수정', '리오로그인삭제']) {
    assert.equal(commands.find((item) => item.name === name)?.default_member_permissions, '0');
  }
});
