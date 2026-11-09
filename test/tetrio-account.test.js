import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { MessageFlags } from 'discord.js';
import { TetrioLinkStore } from '../src/tetrio-link-store.js';
import { createTetrioAccountResolver, handleTetrioLogin, handleTetrioLoginDelete, handleTetrioLoginUpdate, TETRIO_LINK_ADMIN_ID } from '../src/tetrio-account.js';
import { findTetrioAccount, findTetrioAccountById, findTetrioUsername, findTetrioUsernameByDiscordId } from '../src/tetrio-card.js';
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

test('login update replaces an existing link with account identity and reports before/after', async (t) => {
  const store = await temporaryStore(t);
  await store.setNickname(id, 'oldname');
  const request = interaction();
  await handleTetrioLoginUpdate(request, {
    store,
    findAccount: async (input) => {
      assert.equal(input, 'Arcane123');
      return { id: '0123456789abcdef01234567', username: 'NewName' };
    },
  });
  assert.match(request.calls.at(-1)[1].content, /oldname → NewName/);
  assert.deepEqual(await store.getLink(id), { id: '0123456789abcdef01234567', username: 'newname' });
});

test('login update preserves the old link for missing accounts, API errors, and save errors', async (t) => {
  const store = await temporaryStore(t);
  await store.setAccount(id, { id: '0123456789abcdef01234567', username: 'original' });
  for (const findAccount of [async () => null, async () => { throw new Error('API unavailable'); }]) {
    const request = interaction();
    await handleTetrioLoginUpdate(request, { store, findAccount });
    assert.deepEqual(await store.getLink(id), { id: '0123456789abcdef01234567', username: 'original' });
  }
  const originalSetAccount = store.setAccount.bind(store);
  store.setAccount = async () => { throw new Error('disk full'); };
  const failedSave = interaction();
  await handleTetrioLoginUpdate(failedSave, { store, findAccount: async () => ({ id: 'fedcba9876543210fedcba98', username: 'newname' }) });
  assert.match(failedSave.calls.at(-1)[1], /기존 연동 정보는 유지/);
  store.setAccount = originalSetAccount;
});

test('login update rejects unlinked users, unauthorized users, and duplicate accounts', async (t) => {
  const store = await temporaryStore(t);
  const missing = interaction();
  await handleTetrioLoginUpdate(missing, { store, findAccount: () => assert.fail('API called') });
  assert.match(missing.calls.at(-1)[1], /기존 TETR\.IO 연동 정보가 없다/);

  const unauthorized = interaction(id);
  await handleTetrioLoginUpdate(unauthorized, { store, findAccount: () => assert.fail('API called') });
  assert.equal(unauthorized.calls[0][1].flags, MessageFlags.Ephemeral);

  await store.setNickname(id, 'old');
  await store.setAccount('223456789012345678', { id: '0123456789abcdef01234567', username: 'first' });
  const duplicate = interaction();
  await handleTetrioLoginUpdate(duplicate, { store, findAccount: async () => ({ id: '0123456789abcdef01234567', username: 'first' }) });
  assert.match(duplicate.calls.at(-1)[1], /이미 다른 Discord 유저/);
  assert.equal(await store.getNickname(id), 'old');
});

test('version 1 string links remain readable and are migrated safely on the next write', async (t) => {
  const store = await temporaryStore(t);
  await fs.writeFile(store.filePath, JSON.stringify({ version: 1, links: { [id]: 'LegacyName' } }));
  assert.deepEqual(await store.getLink(id), { id: null, username: 'legacyname' });
  await store.setAccount(id, { id: '0123456789abcdef01234567', username: 'ModernName' });
  const payload = JSON.parse(await fs.readFile(store.filePath, 'utf8'));
  assert.equal(payload.version, 2);
  assert.deepEqual(payload.links[id], { id: '0123456789abcdef01234567', username: 'modernname' });
});

test('migrating one of several version 1 links preserves every other user and survives reload', async (t) => {
  const store = await temporaryStore(t);
  const secondId = '223456789012345678';
  const thirdId = '323456789012345678';
  await fs.writeFile(store.filePath, JSON.stringify({ version: 1, links: {
    [id]: 'FirstUser', [secondId]: 'SecondUser', [thirdId]: 'ThirdUser',
  } }));
  assert.equal(await store.getNickname(secondId), 'seconduser');
  await store.setAccount(id, { id: '0123456789abcdef01234567', username: 'RenamedFirst' });
  const payload = JSON.parse(await fs.readFile(store.filePath, 'utf8'));
  assert.equal(payload.version, 2);
  assert.deepEqual(payload.links, {
    [id]: { id: '0123456789abcdef01234567', username: 'renamedfirst' },
    [secondId]: { id: null, username: 'seconduser' },
    [thirdId]: { id: null, username: 'thirduser' },
  });
  const restarted = new TetrioLinkStore(store.filePath);
  assert.deepEqual(await restarted.getLink(secondId), { id: null, username: 'seconduser' });
  assert.deepEqual(await restarted.getLink(thirdId), { id: null, username: 'thirduser' });
});

test('a failed migration write preserves both the old file and in-memory links', async (t) => {
  const store = await temporaryStore(t);
  const secondId = '223456789012345678';
  await fs.writeFile(store.filePath, JSON.stringify({ version: 1, links: {
    [id]: 'FirstUser', [secondId]: 'SecondUser',
  } }));
  const before = await fs.readFile(store.filePath, 'utf8');
  store.writeLinks = async () => { throw new Error('disk full'); };
  await assert.rejects(store.setAccount(id, { id: '0123456789abcdef01234567', username: 'newfirst' }), /disk full/);
  assert.equal(await fs.readFile(store.filePath, 'utf8'), before);
  assert.deepEqual(await store.getLink(id), { id: null, username: 'firstuser' });
  assert.deepEqual(await store.getLink(secondId), { id: null, username: 'seconduser' });
});

test('concurrent saves preserve all users across restarts', async (t) => {
  const store = await temporaryStore(t);
  await Promise.all(Array.from({ length: 30 }, (_, i) => store.setNickname(String(BigInt(id) + BigInt(i)), `player${i}`)));
  const restarted = new TetrioLinkStore(store.filePath);
  for (let i = 0; i < 30; i++) assert.equal(await restarted.getNickname(String(BigInt(id) + BigInt(i))), `player${i}`);
  assert.deepEqual((await fs.readdir(path.dirname(store.filePath))), ['tetrio-user-links.json']);
});

test('deletes only the requested v1 link and preserves other users', async (t) => {
  const store = await temporaryStore(t);
  const secondId = '223456789012345678';
  await fs.writeFile(store.filePath, JSON.stringify({ version: 1, links: {
    [id]: 'LegacyName', [secondId]: 'OtherName',
  } }));
  assert.deepEqual(await store.deleteLink(id), { id: null, username: 'legacyname' });
  assert.equal(await store.getLink(id), null);
  assert.deepEqual(await store.getLink(secondId), { id: null, username: 'othername' });
  const restarted = new TetrioLinkStore(store.filePath);
  assert.equal(await restarted.getLink(id), null);
  assert.deepEqual(await restarted.getLink(secondId), { id: null, username: 'othername' });
});

test('deletes a v2 account link completely and permits re-registration', async (t) => {
  const store = await temporaryStore(t);
  await store.setAccount(id, { id: '0123456789abcdef01234567', username: 'OldName' });
  assert.deepEqual(await store.deleteLink(id), { id: '0123456789abcdef01234567', username: 'oldname' });
  assert.equal(await store.getLink(id), null);
  await store.setAccount(id, { id: 'fedcba9876543210fedcba98', username: 'NewName' });
  assert.deepEqual(await store.getLink(id), { id: 'fedcba9876543210fedcba98', username: 'newname' });
});

test('missing and failed deletions preserve the existing link', async (t) => {
  const store = await temporaryStore(t);
  assert.equal(await store.deleteLink(id), null);
  await store.setAccount(id, { id: '0123456789abcdef01234567', username: 'Original' });
  const before = await fs.readFile(store.filePath, 'utf8');
  store.writeLinks = async () => { throw new Error('disk full'); };
  await assert.rejects(store.deleteLink(id), /disk full/);
  assert.equal(await fs.readFile(store.filePath, 'utf8'), before);
  assert.deepEqual(await store.getLink(id), { id: '0123456789abcdef01234567', username: 'original' });
});

test('concurrent register, update, and delete operations serialize without losing other links', async (t) => {
  const store = await temporaryStore(t);
  const secondId = '223456789012345678';
  await Promise.all([
    store.setNickname(id, 'first'),
    store.setNickname(secondId, 'second'),
  ]);
  await Promise.all([
    store.setAccount(id, { id: '0123456789abcdef01234567', username: 'updated' }),
    store.deleteLink(secondId),
  ]);
  assert.deepEqual(await store.getLink(id), { id: '0123456789abcdef01234567', username: 'updated' });
  assert.equal(await store.getLink(secondId), null);
});

test('deletion handler is restricted, ephemeral, reports the old nickname, and handles missing links', async (t) => {
  const store = await temporaryStore(t);
  const unauthorized = interaction(id);
  await handleTetrioLoginDelete(unauthorized, { store });
  assert.equal(unauthorized.calls[0][1].flags, MessageFlags.Ephemeral);

  const missing = interaction();
  await handleTetrioLoginDelete(missing, { store });
  assert.match(missing.calls.at(-1)[1], /삭제할 수동 TETR\.IO 연동 정보가 없다/);

  await store.setAccount(id, { id: '0123456789abcdef01234567', username: 'OldName' });
  const request = interaction();
  await handleTetrioLoginDelete(request, { store });
  assert.equal(request.calls[0][1].flags, MessageFlags.Ephemeral);
  assert.match(request.calls.at(-1)[1].content, /기존 TETR\.IO 닉네임: oldname/);
  assert.match(request.calls.at(-1)[1].content, /수동 연동 정보 삭제 완료/);
  assert.equal(await store.getLink(id), null);
});

test('deletion handler keeps the link after a save failure', async (t) => {
  const store = await temporaryStore(t);
  await store.setNickname(id, 'original');
  store.writeLinks = async () => { throw new Error('disk full'); };
  const request = interaction();
  await handleTetrioLoginDelete(request, { store });
  assert.match(request.calls.at(-1)[1], /기존 연동 정보는 유지/);
  assert.equal(await store.getNickname(id), 'original');
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

test('manual links with an account ID resolve the current nickname after a rename', async (t) => {
  const store = await temporaryStore(t);
  await store.setAccount(id, { id: '0123456789abcdef01234567', username: 'oldname' });
  const resolve = createTetrioAccountResolver({
    store,
    findOfficial: async () => null,
    findAccountById: async (accountId) => {
      assert.equal(accountId, '0123456789abcdef01234567');
      return { id: accountId, username: 'newname' };
    },
  });
  assert.equal(await resolve({ discordUserId: id }), 'newname');
});

test('version 1 links use the stored nickname only, while version 2 links use the stable ID lookup', async (t) => {
  const store = await temporaryStore(t);
  await fs.writeFile(store.filePath, JSON.stringify({ version: 1, links: { [id]: 'OldName' } }));
  const v1Calls = [];
  const v1Resolve = createTetrioAccountResolver({
    store,
    findOfficial: async () => null,
    findAccountById: async () => { v1Calls.push('id'); return { username: 'unexpected' }; },
  });
  assert.equal(await v1Resolve({ discordUserId: id }), 'oldname');
  assert.deepEqual(v1Calls, []);

  await store.setAccount(id, { id: '0123456789abcdef01234567', username: 'OldName' });
  const v2Calls = [];
  const v2Resolve = createTetrioAccountResolver({
    store,
    findOfficial: async () => null,
    findAccountById: async (accountId) => {
      v2Calls.push(accountId);
      return { id: accountId, username: 'renamed' };
    },
  });
  assert.equal(await v2Resolve({ discordUserId: id }), 'renamed');
  assert.deepEqual(v2Calls, ['0123456789abcdef01234567']);
});

test('ID lookup failures do not alter the saved v2 link', async (t) => {
  const store = await temporaryStore(t);
  await store.setAccount(id, { id: '0123456789abcdef01234567', username: 'oldname' });
  const resolve = createTetrioAccountResolver({
    store,
    findOfficial: async () => null,
    findAccountById: async () => { throw Object.assign(new Error('API unavailable'), { status: 503 }); },
  });
  await assert.rejects(resolve({ discordUserId: id }), { status: 503 });
  assert.deepEqual(await store.getLink(id), { id: '0123456789abcdef01234567', username: 'oldname' });
});

test('account ID lookup requests the ID endpoint and returns the current nickname', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let requestedUrl;
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return { ok: true, status: 200, json: async () => ({
      success: true, data: { _id: '0123456789abcdef01234567', username: 'RenamedUser' },
    }) };
  };
  assert.deepEqual(await findTetrioAccountById('0123456789abcdef01234567'), {
    id: '0123456789abcdef01234567', username: 'renameduser',
  });
  assert.match(requestedUrl, /\/users\/0123456789abcdef01234567$/);
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

test('official user lookup returns the stable account ID and current username', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    success: true,
    data: { _id: '0123456789abcdef01234567', username: 'RenamedUser' },
  }) });
  assert.deepEqual(await findTetrioAccount('OldUser'), {
    id: '0123456789abcdef01234567', username: 'renameduser',
  });
});

test('slash registration uses required User/String options and default disabled permissions', () => {
  const command = buildSlashCommands().find((entry) => entry.name === '리오로그인');
  assert.equal(command.default_member_permissions, '0');
  assert.deepEqual(command.options.map(({ name, type, required }) => ({ name, type, required })), [
    { name: '유저', type: 6, required: true }, { name: '닉네임', type: 3, required: true },
  ]);
});

test('slash login update uses the same restricted required options', () => {
  const command = buildSlashCommands().find((entry) => entry.name === '리오로그인수정');
  assert.equal(command.default_member_permissions, '0');
  assert.deepEqual(command.options.map(({ name, type, required }) => ({ name, type, required })), [
    { name: '유저', type: 6, required: true }, { name: '닉네임', type: 3, required: true },
  ]);
});

test('slash login delete uses the same restricted required user option', () => {
  const command = buildSlashCommands().find((entry) => entry.name === '리오로그인삭제');
  assert.equal(command.default_member_permissions, '0');
  assert.deepEqual(command.options.map(({ name, type, required }) => ({ name, type, required })), [
    { name: '유저', type: 6, required: true },
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
