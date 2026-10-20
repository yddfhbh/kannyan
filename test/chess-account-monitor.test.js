import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ChessAccountMonitor, describeStatus, queryAccount } from '../src/chess-account-monitor.js';
import { buildSlashCommands } from '../src/deploy-commands.js';

const response = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300, status, headers: { get: (name) => headers[name] }, json: async () => body,
});

async function fixture(t, fetchImpl) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chess-monitor-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let now = 1_700_000_000_000;
  const alerts = [];
  const monitor = new ChessAccountMonitor({
    filePath: path.join(dir, 'monitor.json'), fetchImpl, now: () => now,
    sendAlert: async (channel, account) => alerts.push([channel, account.closedStatus]),
    logger: { error() {} },
  });
  return { monitor, alerts, advance: (ms = 300_000) => { now += ms; }, filePath: monitor.filePath, now: () => now };
}

test('slash commands include required platform choices and management commands', () => {
  const commands = buildSlashCommands();
  for (const name of ['의심유저', '의심유저중지']) {
    const command = commands.find((item) => item.name === name);
    assert.ok(command);
    assert.equal(command.options[0].name, '닉네임');
    assert.equal(command.options[0].required, true);
    assert.deepEqual(command.options[1].choices.map((choice) => choice.name), ['체닷', '리체스']);
    assert.equal(command.options[1].required, true);
  }
  assert.ok(commands.find((item) => item.name === '의심유저목록'));
});

test('Chess.com normal accounts register and remain monitored; duplicate registration avoids fetch', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; return response({ status: 'premium' }); });
  const input = { platform: 'chesscom', username: 'Alice', channelId: 'ch1', userId: 'user1' };
  assert.equal((await f.monitor.register(input)).kind, 'registered');
  assert.equal((await f.monitor.register(input)).kind, 'duplicate');
  assert.equal((await f.monitor.register({ ...input, channelId: 'ch2' })).kind, 'registered');
  assert.equal(calls, 1);
  f.advance();
  await f.monitor.tick();
  assert.equal(calls, 2);
  assert.equal(f.alerts.length, 0);
  assert.equal((await f.monitor.list('ch2')).length, 1);
});

test('Chess.com fair-play closure alerts each channel once, then removes account', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => response({ status: ++calls === 1 ? 'basic' : 'closed:fair_play_violations' }));
  const base = { platform: 'chesscom', username: 'Alice', userId: 'user1' };
  await f.monitor.register({ ...base, channelId: 'ch1' });
  await f.monitor.register({ ...base, channelId: 'ch2' });
  f.advance();
  await f.monitor.tick();
  await f.monitor.tick();
  assert.deepEqual(f.alerts, [['ch1', 'closed:fair_play_violations'], ['ch2', 'closed:fair_play_violations']]);
  assert.equal((await f.monitor.list('ch1')).length, 0);
  assert.equal(describeStatus('chesscom', 'closed:fair_play_violations'), '공정 플레이 위반에 따른 계정 종료 상태');
  assert.match(describeStatus('chesscom', 'closed'), /사유는 확인할 수 없음/);
});

test('already closed and Lichess disabled accounts are not registered', async (t) => {
  const f = await fixture(t, async (url) => response(url.includes('chess.com') ? { status: 'closed' } : { id: 'b', username: 'B', disabled: true }));
  assert.deepEqual(await f.monitor.register({ platform: 'chesscom', username: 'a', channelId: 'ch', userId: 'u' }), { kind: 'closed', status: 'closed' });
  assert.deepEqual(await f.monitor.register({ platform: 'lichess', username: 'b', channelId: 'ch', userId: 'u' }), { kind: 'closed', status: 'disabled' });
  assert.equal((await f.monitor.list('ch')).length, 0);
});

test('Lichess disabled status detected after normal registration', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => response({ id: 'alice', username: 'Alice', disabled: ++calls > 1 }));
  await f.monitor.register({ platform: 'lichess', username: 'Alice', channelId: 'ch', userId: 'u' });
  f.advance();
  await f.monitor.tick();
  assert.deepEqual(f.alerts, [['ch', 'disabled']]);
});

test('Lichess profile without disabled registers and remains active when checked again', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls++;
    return response({ id: 'alice', username: 'Alice' });
  });
  assert.equal((await f.monitor.register({ platform: 'lichess', username: 'Alice', channelId: 'ch', userId: 'u' })).kind, 'registered');
  assert.equal(f.monitor.accounts.get('lichess:alice').status, 'active');
  f.advance();
  await f.monitor.tick();
  assert.equal(calls, 2);
  assert.equal(f.monitor.accounts.get('lichess:alice').status, 'active');
  assert.equal(f.alerts.length, 0);
  assert.equal((await f.monitor.list('ch')).length, 1);
});

test('Lichess requires valid profile identity and accepts only boolean disabled values', async () => {
  for (const body of [{}, { id: 'alice' }, { username: 'Alice' },
    { id: '', username: 'Alice' }, { id: 'alice', username: ' ' },
    { id: 'alice', username: 'Alice', disabled: null },
    { id: 'alice', username: 'Alice', disabled: 'false' }]) {
    assert.equal((await queryAccount('lichess', 'alice', { fetchImpl: async () => response(body) })).kind, 'error');
  }
  assert.deepEqual(await queryAccount('lichess', 'alice', {
    fetchImpl: async () => response({ id: 'alice', username: 'Alice', disabled: false }),
  }), { kind: 'active', status: 'active' });
});

test('404, malformed data, and network errors cannot trigger alerts', async (t) => {
  const results = [response({ status: 'basic' }), response({}, 404), response({}), new Error('offline')];
  const f = await fixture(t, async () => {
    const item = results.shift();
    if (item instanceof Error) throw item;
    return item;
  });
  assert.equal((await f.monitor.register({ platform: 'chesscom', username: 'Alice', channelId: 'ch', userId: 'u' })).kind, 'registered');
  for (let i = 0; i < 3; i++) { f.advance(5 * 60_000 * 2 ** i); await f.monitor.tick(); }
  assert.equal(f.alerts.length, 0);
  assert.equal((await f.monitor.list('ch')).length, 1);
  assert.equal((await queryAccount('lichess', 'missing', { fetchImpl: async () => response({}, 404) })).kind, 'not_found');
  assert.equal((await queryAccount('lichess', 'bad', { fetchImpl: async () => response({}) })).kind, 'error');
});

test('429 honors Retry-After and 5xx backs off without removing subscriptions', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls++;
    if (calls === 1) return response({ status: 'basic' });
    if (calls === 2) return response({}, 429, { 'retry-after': '900' });
    return response({}, 503);
  });
  await f.monitor.register({ platform: 'chesscom', username: 'Alice', channelId: 'ch', userId: 'u' });
  f.advance(); await f.monitor.tick();
  f.advance(); await f.monitor.tick();
  assert.equal(calls, 2);
  f.advance(600_000); await f.monitor.tick();
  assert.equal(calls, 3);
  assert.equal((await f.monitor.list('ch')).length, 1);
  assert.equal(f.alerts.length, 0);
});

test('stop removes only the relevant owner or channel and survives restart', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; return response({ status: 'basic' }); });
  const base = { platform: 'chesscom', username: 'Alice', userId: 'u1' };
  await f.monitor.register({ ...base, channelId: 'ch1' });
  await f.monitor.register({ ...base, channelId: 'ch2' });
  await f.monitor.register({ ...base, channelId: 'ch1', userId: 'u2' });
  assert.equal(await f.monitor.remove({ ...base, channelId: 'ch1', userId: 'outsider' }), 'forbidden');
  assert.equal(await f.monitor.remove({ ...base, channelId: 'ch1' }), 'removed');
  assert.equal((await f.monitor.list('ch1')).length, 1);
  assert.equal(await f.monitor.remove({ ...base, channelId: 'ch1', userId: 'u2' }), 'removed');
  assert.equal((await f.monitor.list('ch1')).length, 0);
  const restored = new ChessAccountMonitor({ filePath: f.filePath, fetchImpl: async () => response({ status: 'basic' }), now: f.now, sendAlert: async () => {}, logger: { error() {} } });
  assert.equal((await restored.list('ch2')).length, 1);
  f.advance(); await restored.tick();
  assert.equal((await restored.list('ch2')).length, 1);
  assert.equal(calls, 1);
});

test('failed channel delivery is retried without repeating successful channel alerts', async (t) => {
  let checks = 0;
  const f = await fixture(t, async () => response({ status: ++checks === 1 ? 'basic' : 'closed' }));
  const input = { platform: 'chesscom', username: 'Alice', userId: 'u' };
  await f.monitor.register({ ...input, channelId: 'one' });
  await f.monitor.register({ ...input, channelId: 'two' });
  let failed = false;
  f.monitor.sendAlert = async (channel, account) => {
    if (channel === 'two' && !failed) { failed = true; throw new Error('Discord unavailable'); }
    f.alerts.push([channel, account.closedStatus]);
  };
  f.advance(); await f.monitor.tick();
  assert.deepEqual(f.alerts, [['one', 'closed']]);
  assert.equal((await f.monitor.list('one')).length, 0);
  assert.equal((await f.monitor.list('two')).length, 1);
  f.advance(); await f.monitor.tick();
  assert.deepEqual(f.alerts, [['one', 'closed'], ['two', 'closed']]);
  assert.equal(checks, 2);
});

test('initial 404 does not register, JSON errors remain unknown, and cooldown survives restart', async (t) => {
  const f = await fixture(t, async () => response({}, 429, { 'retry-after': '900' }));
  const input = { platform: 'lichess', username: 'Alice', channelId: 'ch', userId: 'u' };
  assert.equal((await f.monitor.register(input)).kind, 'error');
  const restored = new ChessAccountMonitor({ filePath: f.filePath, fetchImpl: async () => response({ disabled: false }), now: f.now, sendAlert: async () => {}, logger: { error() {} } });
  assert.equal((await restored.register(input)).kind, 'error');
  assert.equal((await queryAccount('chesscom', 'missing', { fetchImpl: async () => response({}, 404) })).kind, 'not_found');
  assert.equal((await queryAccount('chesscom', 'bad', { fetchImpl: async () => ({ ...response({}), json: async () => { throw new Error('bad JSON'); } }) })).kind, 'error');
});
