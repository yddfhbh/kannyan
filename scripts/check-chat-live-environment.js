// Read-only ubuntu-console preflight. Never print the PM2 environment, command
// arguments, .env contents, exception messages, or credential names/values.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { parse } from 'dotenv';

let stage = 'ubuntu-identity';
try {
  if (os.userInfo().username !== 'ubuntu') throw 0;
  stage = 'pm2-process';
  const apps = JSON.parse(execFileSync('pm2', ['jlist'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000,
    maxBuffer: 8 * 1024 * 1024,
  }));
  const matches = apps.filter((app) => app.name === 'discord-bot');
  if (matches.length !== 1) throw 0;
  const app = matches[0];
  if (app.pm2_env.status !== 'online' || !(app.pid > 0)) throw 0;
  const proc = `/proc/${app.pid}`;
  if (fs.statSync(proc).uid !== process.getuid()) throw 0;
  stage = 'production-path';
  const cwd = fs.readlinkSync(`${proc}/cwd`);
  if (cwd !== '/home/ubuntu/discord-bot-new' || app.pm2_env.pm_cwd !== cwd
      || app.pm2_env.pm_exec_path !== `${cwd}/src/index.js`) throw 0;
  stage = 'production-git-identity';
  const productionDiskHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 5000 }).trim();
  if (!/^[a-f0-9]{40}$/.test(productionDiskHead)) throw 0;
  const productionDiskDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 5000 }).trim());
  const revision = app.pm2_env.versioning?.revision;
  const pm2ReportedRevision = /^[a-f0-9]{40}$/.test(revision || '') ? revision : null;
  stage = 'dotenv-path-and-precedence';
  const env = Object.fromEntries(fs.readFileSync(`${proc}/environ`, 'utf8').split('\0')
    .filter((item) => item.includes('='))
    .map((item) => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)]));
  const args = fs.readFileSync(`${proc}/cmdline`, 'utf8') + JSON.stringify(app.pm2_env.node_args ?? []) + JSON.stringify(app.pm2_env.args ?? []);
  if (/dotenv_config|--env-file/.test(args) || env.NODE_OPTIONS || env.DOTENV_KEY ||
      env.DOTENV_CONFIG_DOTENV_KEY || env.DOTENV_CONFIG_ENCODING || env.DOTENV_CONFIG_OVERRIDE) throw 0;
  const file = path.resolve(cwd, env.DOTENV_CONFIG_PATH || '.env');
  if (file !== `${cwd}/.env`) throw 0;
  const parsed = parse(fs.readFileSync(file));
  if (parsed.DOTENV_KEY) throw 0;
  for (const [key, value] of Object.entries(env)) {
    if (!/^(GEMINI|GEMMA|WEB_SEARCH|WEB_PAGE|PYHOK|MEILI|CHAT_|SEARCH_)/.test(key)) continue;
    if (Object.hasOwn(parsed, key) && parsed[key] !== value) throw 0;
    if (/^(GEMINI|GEMMA|WEB_SEARCH|WEB_PAGE|PYHOK|MEILI|CHAT_|SEARCH_)/.test(key) && !Object.hasOwn(parsed, key)) throw 0;
  }
  // Startup /proc environ cannot reveal dotenv's later in-process writes. A
  // file changed since launch cannot establish the running process's settings.
  if (fs.statSync(file).mtimeMs > app.pm2_env.pm_uptime) throw 0;
  stage = 'verification-dependencies';
  await import('./lib/chat-verification-runtime.js');
  fs.accessSync(new URL('./verify-chat-live.js', import.meta.url), fs.constants.R_OK);
  console.log(JSON.stringify({ productionDiskHead, productionDiskDirty, pm2ReportedRevision, runningRevisionVerified: false }));
  console.log('preflight passed: ubuntu access, production cwd/.env and startup overrides checked; no secrets printed');
} catch {
  console.error(`preflight failed: ${stage}; no environment values printed`);
  process.exitCode = 1;
}
