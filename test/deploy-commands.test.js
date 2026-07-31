import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSlashCommands } from '../src/deploy-commands.js';

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

  assert.ok(setCommand);
  assert.equal(setCommand.description, '이 채널을 매일 일일 체스 퍼즐 알림 채널로 지정합니다.');

  assert.ok(clearCommand);
  assert.equal(clearCommand.description, '이 서버의 일일 체스 퍼즐 알림 채널 지정을 해제합니다.');
});
