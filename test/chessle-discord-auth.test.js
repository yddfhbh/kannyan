import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordAuth, DiscordAuthError } from '../src/chessle/discord-auth.js';

const response = (body, ok = true) => ({ ok, json: async () => body });

test('Discord authorization code is exchanged server-side and user identity is bound to the session', async () => {
  const calls = [];
  const auth = createDiscordAuth({ clientId: 'client-id', clientSecret: 'server-only-secret', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/token') ? response({ access_token: 'discord-access', refresh_token: 'discord-refresh', expires_in: 60 }) : response({ id: '123456789', username: 'player', global_name: 'Player' });
  } });
  const result = await auth.exchangeCode('authorization-code-123');
  assert.equal(result.user.id, '123456789');
  assert.notEqual(result.sessionToken, 'discord-access');
  assert.match(calls[0].options.body.toString(), /client_secret=server-only-secret/);
  assert.equal(auth.identify(result.sessionToken).id, '123456789');
});

test('expired Discord token can be refreshed and invalid sessions cannot identify a user', async () => {
  let now = 0; let tokenCalls = 0;
  const auth = createDiscordAuth({ clientId: 'client-id', clientSecret: 'secret', now: () => now, fetchImpl: async (url) => url.endsWith('/token') ? response({ access_token: `access-${++tokenCalls}`, refresh_token: 'refresh', expires_in: 1 }) : response({ id: 'user-1' }) });
  const first = await auth.exchangeCode('authorization-code-123');
  now = 2_000;
  assert.throws(() => auth.identify(first.sessionToken), (error) => error instanceof DiscordAuthError && error.code === 'TOKEN_EXPIRED');
  const refreshed = await auth.refresh(first.sessionToken);
  assert.equal(auth.identify(refreshed.sessionToken).id, 'user-1');
  assert.notEqual(refreshed.sessionToken, first.sessionToken);
});
