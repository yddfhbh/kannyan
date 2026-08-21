import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateMinomuncherReplayFiles,
} from '../src/minomuncher-replay-validation.js';

function makeReplay({
  playerId = '0',
  frame = 1,
  boardwidth = 10,
  boardheight = 40,
} = {}) {
  return JSON.stringify({
    gamemode: 'league',
    id: 'TEST',
    version: 1,

    replay: {
      leaderboard: [],

      rounds: [
        [
          {
            username: 'test',
            id: playerId,
            active: true,
            alive: false,

            replay: {
              options: {
                boardwidth,
                boardheight,
              },

              events: [
                {
                  frame,
                  type: 'end',
                  data: {},
                },
              ],
            },

            stats: {},
          },
        ],
      ],
    },

    users: [
      {
        id: '0',
        username: 'test',
      },
    ],
  });
}

test(
  'MinoMuncher validator accepts sane replay limits',
  () => {
    const files =
      validateMinomuncherReplayFiles([
        {
          name: 'normal.ttrm',
          content: makeReplay(),
        },
      ]);

    assert.equal(
      files.length,
      1,
    );
  },
);

test(
  'MinoMuncher validator blocks huge frame tick-loop input',
  () => {
    assert.throws(
      () =>
        validateMinomuncherReplayFiles([
          {
            name: 'tickloop.ttrm',
            content: makeReplay({
              frame:
                1_000_000_000_000,
            }),
          },
        ]),
      (error) =>
        error?.code ===
        'MINOMUNCHER_REPLAY_REJECTED',
    );
  },
);

test(
  'MinoMuncher validator blocks huge board allocation input',
  () => {
    assert.throws(
      () =>
        validateMinomuncherReplayFiles([
          {
            name: 'board-oom.ttrm',
            content: makeReplay({
              boardwidth:
                200_000,

              boardheight:
                200_000,
            }),
          },
        ]),
      (error) =>
        error?.code ===
        'MINOMUNCHER_REPLAY_REJECTED',
    );
  },
);

test(
  'MinoMuncher validator blocks prototype-like player id',
  () => {
    assert.throws(
      () =>
        validateMinomuncherReplayFiles([
          {
            name: 'proto.ttrm',
            content: makeReplay({
              playerId:
                '__proto__',
            }),
          },
        ]),
      (error) =>
        error?.code ===
        'MINOMUNCHER_REPLAY_REJECTED',
    );
  },
);

test(
  'MinoMuncher validator blocks combined huge board and frame input',
  () => {
    assert.throws(
      () =>
        validateMinomuncherReplayFiles([
          {
            name: 'combo.ttrm',
            content: makeReplay({
              frame:
                1_000_000_000_000,

              boardwidth:
                200_000,

              boardheight:
                200_000,
            }),
          },
        ]),
      (error) =>
        error?.code ===
        'MINOMUNCHER_REPLAY_REJECTED',
    );
  },
);