import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { MessageFlags } from 'discord.js';
import { TetrioLinkStore } from '../src/tetrio-link-store.js';
import { createTetrioAccountResolver, handleTetrioLogin, TETRIO_LINK_ADMIN_ID } from '../src/tetrio-account.js';
import { findTetrioUsername, findTetrioUsernameByDiscordId } from '../src/tetrio-card.js';
import { buildSlashCommands } from '../src/deploy-commands.js';

const id = '123456789012345678';
async function temporaryStore(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kannyan-tetrio-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return new TetrioLinkStore(path.join(dir, 'tetrio-user-links.json'));
}
function interaction(userId = TETRIO_LINK_ADMIN_ID) {
  const calls = [];
  return {
    user: { id: userId }, calls,
    options: { getUser: () => ({ id }), getString: () => ' Arcane123 ' },
    reply: async (value) => calls.push(['reply', value]),
    deferReply: async (value) => calls.push(['defer', value]),
    editReply: async (value) => calls.push(['edit', value]),
  };
}

test('registration requires the exact operator ID before options, API or store access', async () => {
  for (const userId of [id, '842312482622144522']) {
    const request = interaction(userId);
    request.options = null;
    await handleTetrioLogin(request, { store: null, findUsername: () => assert.fail('API called') });
    assert.equal(request.calls.length, 1);
    assert.equal(request.calls[0][1].flags, MessageFlags.Ephemeral);
  }
});

test('registration validates, persists canonical username and updates the same user', async (t) => {
  const store = await temporaryStore(t);
  for (const nickname of ['arcane123', 'replacement']) {
    const request = interaction();
    await handleTetrioLogin(request, { store, findUsername: async (input) => {
      assert.equal(input, 'Arcane123');
      return nickname;
    } });
    assert.equal(request.calls[0][1].flags, MessageFlags.Ephemeral);
    assert.match(request.calls[1][1].content, new RegExp(nickname));
    assert.equal(await store.getNickname(id), nickname);
  }
  const restarted = new TetrioLinkStore(store.filePath);
  assert.equal(await restarted.getNickname(id), 'replacement');
});

test('missing accounts and API failures never modify existing mappings', async (t) => {
  const store = await temporaryStore(t);
  await store.setNickname(id, 'original');
  const missing = interaction();
  await handleTetrioLogin(missing, { store, findUsername: async () => null });
  assert.match(missing.calls[1][1], /유저는 없다/);
  const failed = interaction();
  await handleTetrioLogin(failed, { store, findUsername: async () => { throw new Error('API unavailable'); } });
  assert.match(failed.calls[1][1], /실패/);
  assert.equal(await store.getNickname(id), 'original');
});

test('concurrent saves preserve all users across restarts', async (t) => {
  const store = await temporaryStore(t);
  await Promise.all(Array.from({ length: 30 }, (_, i) => store.setNickname(String(BigInt(id) + BigInt(i)), `player${i}`)));
  const restarted = new TetrioLinkStore(store.filePath);
  for (let i = 0; i < 30; i++) assert.equal(await restarted.getNickname(String(BigInt(id) + BigInt(i))), `player${i}`);
  assert.deepEqual((await fs.readdir(path.dirname(store.filePath))), ['tetrio-user-links.json']);
});

test('corrupt persistent data fails closed instead of overwriting mappings', async (t) => {
  const store = await temporaryStore(t);
  await fs.writeFile(store.filePath, '{broken');
  await assert.rejects(store.setNickname(id, 'newname'));
  assert.equal(await fs.readFile(store.filePath, 'utf8'), '{broken');
});

test('account priority: explicit, official, manual, missing; API failures propagate', async () => {
  const calls = [];
  let official = 'official';
  let manual = 'manual';
  const resolve = createTetrioAccountResolver({
    store: { getNickname: async (value) => { calls.push(['manual', value]); return manual; } },
    findUsername: async (value) => { calls.push(['explicit', value]); return value; },
    findOfficial: async (value) => { calls.push(['official', value]); if (official instanceof Error) throw official; return official; },
  });
  assert.equal(await resolve({ nickname: 'explicit', discordUserId: id }), 'explicit');
  assert.deepEqual(calls.splice(0), [['explicit', 'explicit']]);
  assert.equal(await resolve({ discordUserId: id }), 'official');
  assert.deepEqual(calls.splice(0), [['official', id]]);
  official = null;
  assert.equal(await resolve({ discordUserId: id }), 'manual');
  manual = null;
  assert.equal(await resolve({ discordUserId: id }), null);
  for (const error of [new Error('timeout'), Object.assign(new Error('server'), { status: 503 })]) {
    calls.length = 0;
    official = error;
    await assert.rejects(resolve({ discordUserId: id }), (actual) => actual === error);
    assert.deepEqual(calls, [['official', id]]);
  }
});

test('API lookup preserves hardcoded mapping and rejects malformed successful responses', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => assert.fail('hardcoded mapping must not fetch');
  assert.equal(await findTetrioUsernameByDiscordId('842312482622144522'), 'pyhok');
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) });
  await assert.rejects(findTetrioUsernameByDiscordId('223456789012345678'), /Invalid/);
  await assert.rejects(findTetrioUsername('missingbody'), /Invalid/);
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { users: [] } }) });
  assert.equal(await findTetrioUsernameByDiscordId('323456789012345678'), null);
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ success: false }) });
  assert.equal(await findTetrioUsername('notfoundcase'), null);
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ success: false }) });
  await assert.rejects(findTetrioUsernameByDiscordId('423456789012345678'), { status: 503 });
});

test('slash registration uses required User/String options and default disabled permissions', () => {
  const command = buildSlashCommands().find((entry) => entry.name === '리오로그인');
  assert.equal(command.default_member_permissions, '0');
  assert.deepEqual(command.options.map(({ name, type, required }) => ({ name, type, required })), [
    { name: '유저', type: 6, required: true }, { name: '닉네임', type: 3, required: true },
  ]);
});

const source = await fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf('\n}', start) + 2;
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test('slash profile returns existing unlinked attachment payload and preserves explicit input', async () => {
  let lookups = 0;
  const replies = [];
  const show = vm.runInNewContext(`(${extract('showTetrioProfile')})`, {
    findTetrioUsernameByDiscordId: async () => { lookups++; return null; },
    createUnlinkedTetrioReply: async () => ({ files: ['existing-image'] }),
    createTetrioProfileCard: async (username) => ({ username, image: 'profile' }),
    AttachmentBuilder: class {}, console,
  });
  const request = { user: { id }, options: { getString: () => null }, deferReply: async () => {}, editReply: async (payload) => replies.push(payload) };
  await show(request);
  assert.equal(replies[0].files[0], 'existing-image');
  request.options.getString = () => 'explicit';
  await show(request);
  assert.equal(lookups, 1);
  assert.match(replies[1].content, /explicit/);
});

test('%teto reply and mention targets reach the common linked-account resolver', async () => {
  const seen = [];
  const show = vm.runInNewContext(`(${extract('showLinkedTetrioProfileMessage')})`, {
    findTetrioUsernameByDiscordId: async (target) => { seen.push(target); return 'manual'; },
    showTetrioProfileMessage: async (_message, nickname) => assert.equal(nickname, 'manual'),
    sendUnlinkedTetrioImage: async () => assert.fail('unexpected unlinked image'), console,
  });
  const message = { author: { id }, reply: async () => assert.fail('unexpected error') };
  await show(message, { id: '223456789012345678' });
  await show(message, { id: '323456789012345678' });
  await show(message);
  assert.deepEqual(seen, ['223456789012345678', '323456789012345678', id]);
  assert.match(source, /showLinkedTetrioProfileMessage\(message, repliedUser \?\? message.author\)/);
  assert.match(source, /showLinkedTetrioProfileMessage\(message, mentionedUser\)/);
});
