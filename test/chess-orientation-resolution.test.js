import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleChessAnalysisMessage,
  recognizeFenFromImageWithOrientationFallback,
  resolveBoardOrientationForRecognition,
} from '../src/chess/chess-analysis-command.js';

test('resolveBoardOrientationForRecognition only accepts explicit board orientation', () => {
  assert.equal(resolveBoardOrientationForRecognition('w'), 'w');
  assert.equal(resolveBoardOrientationForRecognition('b'), 'b');
  assert.equal(resolveBoardOrientationForRecognition(''), null);
  assert.equal(resolveBoardOrientationForRecognition(null), null);
  assert.equal(resolveBoardOrientationForRecognition(undefined), null);
});

test('recognizeFenFromImageWithOrientationFallback uses the explicit detected orientation', async () => {
  const calls = [];
  const sampleFen = '8/8/8/8/8/6P1/4K3/7k w - - 0 1';

  const fen = await recognizeFenFromImageWithOrientationFallback('board.png', {
    turn: 'b',
    detectedBoardOrientation: 'b',
    imageToFen: async (_imagePath, options) => {
      calls.push(options);
      return sampleFen;
    },
  });

  assert.equal(fen, '8/8/8/8/8/6P1/4K3/7k b - - 0 1');
  assert.deepEqual(calls, [{
    turn: 'b',
    boardOrientation: 'b',
    returnDetails: true,
  }]);
});

test('recognizeFenFromImageWithOrientationFallback keeps going when both orientations agree', async () => {
  const calls = [];
  const sampleFen = '8/8/8/8/8/6P1/4K3/7k w - - 0 1';

  const fen = await recognizeFenFromImageWithOrientationFallback('board.png', {
    turn: 'w',
    detectedBoardOrientation: null,
    imageToFen: async (_imagePath, options) => {
      calls.push(options.boardOrientation);
      return {
        fen: sampleFen,
        orientationSource: 'fallback',
      };
    },
  });

  assert.equal(fen, sampleFen);
  assert.deepEqual(calls, ['w', 'b']);
});

test('handleChessAnalysisMessage reports a clean failure when fallback FEN is empty', async () => {
  const replies = [];
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer,
  });

  try {
    const handled = await handleChessAnalysisMessage({
      content: '%white best move',
      attachments: new Map([['1', {
        name: 'board.png',
        contentType: 'image/png',
        size: 4,
        url: 'https://example.com/board.png',
      }]]),
      channel: {
        sendTyping: async () => {},
      },
      reply: async (payload) => {
        replies.push(payload);
        return payload;
      },
    }, {
      detectBoardOrientation: async () => null,
      imageToFen: async () => {
        throw new Error('local recognition failed');
      },
      recognizeFenFallback: async () => null,
      analyzeFen: async () => {
        throw new Error('analyzeFen should not be called');
      },
    });

    assert.equal(handled, true);
    assert.equal(replies.length, 1);
    assert.match(replies[0].content, /%fen <FEN>/);
  } finally {
    global.fetch = originalFetch;
  }
});
