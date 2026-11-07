import { randomBytes } from 'node:crypto';

const TOKEN_URL = 'https://discord.com/api/v10/oauth2/token';
const USER_URL = 'https://discord.com/api/v10/users/@me';

export class DiscordAuthError extends Error {
  constructor(message, code = 'AUTH_FAILED', status = 401) { super(message); this.name = 'DiscordAuthError'; this.code = code; this.status = status; }
}
const tokenValue = () => randomBytes(32).toString('base64url');

export function createDiscordAuth({ clientId, clientSecret, fetchImpl = fetch, now = () => Date.now(), sessionTtlMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
  const sessions = new Map();
  async function discordToken(values) {
    if (!clientId || !clientSecret) throw new DiscordAuthError('Discord OAuth2 서버 설정이 없습니다.', 'AUTH_CONFIG', 503);
    const response = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...values }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) throw new DiscordAuthError('Discord 인증 코드를 교환하지 못했습니다. 다시 인증해 주세요.');
    return body;
  }
  async function discordUser(accessToken) {
    const response = await fetchImpl(USER_URL, { headers: { authorization: `Bearer ${accessToken}` } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.id) throw new DiscordAuthError('Discord 사용자 식별을 확인하지 못했습니다. 다시 인증해 주세요.');
    return { id: String(body.id), username: body.username, globalName: body.global_name };
  }
  function issue(token, user) {
    const sessionToken = tokenValue(); const expiresAt = now() + Math.max(1, Number(token.expires_in || 604800)) * 1000;
    sessions.set(sessionToken, { user, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt, sessionUntil: now() + sessionTtlMs });
    return { sessionToken, accessToken: token.access_token, expiresAt, user };
  }
  async function exchangeCode(code) {
    if (typeof code !== 'string' || code.length < 10 || code.length > 4096) throw new DiscordAuthError('인증 코드가 올바르지 않습니다.');
    const token = await discordToken({ grant_type: 'authorization_code', code }); return issue(token, await discordUser(token.access_token));
  }
  function getSession(sessionToken) {
    const session = sessions.get(sessionToken);
    if (!session || session.sessionUntil <= now()) { if (session) sessions.delete(sessionToken); throw new DiscordAuthError('인증 세션이 만료되었습니다. 다시 인증해 주세요.', 'AUTH_EXPIRED'); }
    return session;
  }
  function identify(sessionToken) { const session = getSession(sessionToken); if (session.expiresAt <= now()) throw new DiscordAuthError('Discord access token이 만료되었습니다.', 'TOKEN_EXPIRED'); return session.user; }
  async function refresh(sessionToken) {
    const old = getSession(sessionToken); if (!old.refreshToken) throw new DiscordAuthError('갱신 토큰이 없어 다시 인증해야 합니다.', 'REAUTH_REQUIRED');
    const token = await discordToken({ grant_type: 'refresh_token', refresh_token: old.refreshToken });
    sessions.delete(sessionToken); return issue({ ...token, refresh_token: token.refresh_token || old.refreshToken }, await discordUser(token.access_token));
  }
  return { exchangeCode, identify, refresh, sessionCount: () => sessions.size };
}
