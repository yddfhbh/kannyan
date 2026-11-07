import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHESSLE_INVITE_BUTTON,
  buildChessleInvitePayload,
  handleChessleInviteInteraction,
} from '../src/chessle-invite.js';

test('invite message contains a playable button', () => {
  const payload=buildChessleInvitePayload();
  const button=payload.components[0].components[0];

  assert.equal(button.custom_id,CHESSLE_INVITE_BUTTON);
  assert.equal(button.style,1);
  assert.deepEqual(payload.allowedMentions,{parse:[]});
});

test('/체슬 launches and posts a persistent invite', async () => {
  let launches=0;
  let invitations=0;

  const interaction={
    commandName:'체슬',
    isButton:()=>false,
    isChatInputCommand:()=>true,
    isPrimaryEntryPointCommand:()=>false,
    launchActivity:async()=>{launches++;},
    followUp:async payload=>{
      invitations++;
      assert.equal(
        payload.components[0].components[0].custom_id,
        CHESSLE_INVITE_BUTTON
      );
    },
  };

  assert.equal(
    await handleChessleInviteInteraction(interaction),
    true
  );
  assert.equal(launches,1);
  assert.equal(invitations,1);
});

test('invite button launches without reposting', async () => {
  let launches=0;

  const interaction={
    isButton:()=>true,
    customId:CHESSLE_INVITE_BUTTON,
    launchActivity:async()=>{launches++;},
    followUp:async()=>{
      throw new Error('Unexpected duplicate invite');
    },
  };

  assert.equal(
    await handleChessleInviteInteraction(interaction),
    true
  );
  assert.equal(launches,1);
});

test('Activity Entry Point is supported', async () => {
  let launches=0;
  let invitations=0;

  const interaction={
    isButton:()=>false,
    isChatInputCommand:()=>false,
    isPrimaryEntryPointCommand:()=>true,
    launchActivity:async()=>{launches++;},
    followUp:async()=>{invitations++;},
  };

  assert.equal(
    await handleChessleInviteInteraction(interaction),
    true
  );
  assert.equal(launches,1);
  assert.equal(invitations,1);
});

test('other interactions are ignored', async () => {
  const interaction={
    isButton:()=>false,
    isChatInputCommand:()=>false,
    isPrimaryEntryPointCommand:()=>false,
  };

  assert.equal(
    await handleChessleInviteInteraction(interaction),
    false
  );
});

test('failed follow-up uses channel message fallback', async () => {
  let sent=0;

  const interaction={
    commandName:'체슬',
    isButton:()=>false,
    isChatInputCommand:()=>true,
    isPrimaryEntryPointCommand:()=>false,
    launchActivity:async()=>{},
    followUp:async()=>{throw new Error('mock follow-up error');},
    channel:{
      send:async()=>{sent++;},
    },
  };

  assert.equal(
    await handleChessleInviteInteraction(interaction),
    true
  );
  assert.equal(sent,1);
});
