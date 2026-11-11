import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { guildStreak, renderChessleLiveBoard, createChessleLiveMonitor, isChessleLiveEvent } from '../src/chessle/live-feed.js';

test('streak counts consecutive KST calendar dates and tolerates today pending', () => {
  const dates=['2026-11-05','2026-11-06','2026-11-07'];
  assert.equal(guildStreak(dates,'2026-11-07'),3);
  assert.equal(guildStreak(dates,'2026-11-08'),3);
  assert.equal(guildStreak(dates,'2026-11-09'),0);
  assert.equal(guildStreak(['2026-12-31','2027-01-01'],'2027-01-01'),2);
});

test('formatted board exposes colors but not the answer', () => {
  const b={date:'2026-11-07',mode:'expert',players:{'123456789012345678':{attempt:1,rows:[Array(10).fill('green')],solved:true}}};
  const t=renderChessleLiveBoard(b,['2026-11-07']);
  assert.match(t,/🟩/);
  assert.match(t,/서버 연속 성공: \*\*1일\*\*/);
  assert.doesNotMatch(t, /Nf3|e4/);
});

test('validates event shape', () => {
  assert.equal(isChessleLiveEvent({}),false);
  const obj={id:'abc', userId:'123456789012345678',date:'2026-11-07',mode:'normal',instanceId:'i-1234567890-gc-123456789012345678-123456789012345679',attempt:1,result:Array(6).fill('gray'),solved:false,finished:false,createdAt:Date.now()};
  assert.equal(isChessleLiveEvent(obj),true);
});

test('poll validates active membership, edits one message, deduplicates and records guild win', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'chessle-live-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const gamesFile=path.join(dir,'chessle.json');
  const stateFile=path.join(dir,'chessle-live-state.json');
  const id='123456789012345678', guild='987654321098765432', channel='987654321098765431';
  const instanceId='i-1234567890-gc-987654321098765432-987654321098765431';
  const base={userId:id,date:'2026-11-07',mode:'normal',instanceId,result:Array(6).fill('gray'),solved:false,finished:false,createdAt:Date.now()};
  const events=[{...base,id:'guess-1',attempt:1},{...base,id:'guess-2',attempt:2,result:Array(6).fill('green'),rows:[Array(6).fill('gray'),Array(6).fill('green')],solved:true,finished:true}];
  await fs.writeFile(gamesFile,JSON.stringify({liveEvents:events}));
  let sent=0,edits=0,verified=0;
  const client={guilds:{cache:{has:g=>g===guild}},channels:{fetch:async()=>({guildId:guild,send:async()=>{sent++;return {id:'111111111111111111'}},messages:{fetch:async()=>({edit:async()=>{edits++}})}})}};
  const monitor=createChessleLiveMonitor({client,botToken:'fake',applicationId:'777777777777777777',gamesFile,stateFile,now:()=>Date.now(),fetchImpl:async()=>{verified++;return {ok:true,json:async()=>({instance_id:instanceId,users:[id],location:{guild_id:guild,channel_id:channel}})}}});
  await monitor.tick();
  await monitor.tick();
  assert.equal(sent,1);
  assert.equal(edits,1);
  assert.equal(verified,2);
  const state=JSON.parse(await fs.readFile(stateFile,'utf8'));
  assert.deepEqual(state.guildWins[guild]['2026-11-07'],[id]);
  assert.equal(Object.keys(state.processed).length,2);
  const board=state.boards[`${guild}:${channel}:2026-11-07:normal`];
  assert.equal(board.players[id].attempt,2);
  assert.deepEqual(board.players[id].rows,[Array(6).fill('gray'),Array(6).fill('green')]);
});

test('recognizes verified Activity start events without guess rows', () => {
  const start = {
    id: 'start:abc', type: 'start',
    userId: '123456789012345678',
    instanceId: 'i-1234567890-gc-987654321098765432-987654321098765431',
    date: '2026-11-11', mode: 'expert', createdAt: Date.now(),
  };
  assert.equal(isChessleLiveEvent(start), true);
  assert.equal(isChessleLiveEvent({ ...start, type: 'unknown' }), false);
  assert.equal(isChessleLiveEvent({ ...start, instanceId: 'bad' }), false);
});

test('a new play re-posts just the daily board while preserving prior wins and rows', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chessle-rotate-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const gamesFile = path.join(dir, 'chessle.json');
  const stateFile = path.join(dir, 'chessle-live-state.json');
  const first = '123456789012345678', second = '123456789012345679';
  const guild = '987654321098765432', channelId = '987654321098765431';
  const instanceId = 'i-1234567890-gc-987654321098765432-987654321098765431';
  const date = '2026-11-11';
  const createdAt = Date.now();
  const events = [
    { id:'win-1', userId:first, instanceId, date, mode:'normal', attempt:1,
      result:Array(6).fill('green'), rows:[Array(6).fill('green')],
      solved:true, finished:true, createdAt },
    { id:'start-2', type:'start', userId:second, instanceId,
      date, mode:'normal', createdAt:createdAt + 1 },
  ];
  await fs.writeFile(gamesFile, JSON.stringify({ liveEvents:events }));
  const messages = new Map(), sent = [], deleted = [], edited = [];
  const channel = {
    guildId:guild,
    send:async payload => {
      const id = String(111111111111111111n + BigInt(sent.length));
      const message = { id, edit:async next => { edited.push(id); message.payload = next; },
        delete:async () => { deleted.push(id); messages.delete(id); } };
      message.payload = payload;
      messages.set(id, message);
      sent.push(id);
      return message;
    },
    messages:{ fetch:async id => {
      const message = messages.get(id);
      if (!message) throw Object.assign(new Error('Unknown message'), { code:10008 });
      return message;
    } },
  };
  const client = {
    guilds:{ cache:{ has:id => id === guild } },
    channels:{ fetch:async id => id === channelId ? channel : null },
  };
  const monitor = createChessleLiveMonitor({
    client, botToken:'fake', applicationId:'777777777777777777',
    gamesFile, stateFile, now:() => createdAt,
    fetchImpl:async () => ({ ok:true, json:async () => ({
      instance_id:instanceId, users:[first, second],
      location:{ guild_id:guild, channel_id:channelId },
    }) }),
  });
  await monitor.tick();
  assert.equal(sent.length, 2);
  assert.deepEqual(deleted, [sent[0]]);
  assert.equal(edited.length, 0);
  assert.equal(messages.size, 1);
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  const board = state.boards[`${guild}:${channelId}:${date}:normal`];
  assert.equal(board.messageId, sent[1]);
  assert.equal(board.players[first].solved, true);
  assert.equal(board.players[first].attempt, 1);
  assert.deepEqual(board.players[first].rows, [Array(6).fill('green')]);
  assert.equal(board.players[second].attempt, 0);
  assert.deepEqual(state.guildWins[guild][date], [first]);
  assert.match(messages.get(sent[1]).payload.content, /참여 2명/);
  assert.match(messages.get(sent[1]).payload.content, /서버 연속 성공: \*\*1일\*\*/);
  await monitor.tick();
  assert.equal(sent.length, 2);
  assert.equal(deleted.length, 1);
  // Subsequent guesses edit the latest message instead of moving it again.
  events.push({ id:'guess-2', userId:second, instanceId, date, mode:'normal',
    attempt:1, result:Array(6).fill('gray'), rows:[Array(6).fill('gray')],
    solved:false, finished:false, createdAt:createdAt + 2 });
  await fs.writeFile(gamesFile, JSON.stringify({ liveEvents:events }));
  await monitor.tick();
  assert.equal(sent.length, 2);
  assert.deepEqual(edited, [sent[1]]);
  assert.equal(messages.size, 1);
});
