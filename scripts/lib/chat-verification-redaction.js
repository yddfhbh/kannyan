// Redact values before serialization so replacements cannot invalidate JSON.
export function createVerificationSerializer(env) {
  const secretName = /(?:^|_)(?:API_KEYS?|ACCESS_TOKEN|REFRESH_TOKEN|BOT_TOKEN|TOKEN|SECRET|PASSWORD|CREDENTIALS?)(?:_|$)/i;
  const configName = /(?:^|_)(?:MAX|MIN|LIMIT|TIMEOUT|COUNT|LENGTH|BUDGET)(?:_|$)/i;
  const secrets = Object.entries(env)
    .filter(([name, value]) => secretName.test(name) && !configName.test(name) && value.length >= 4)
    .flatMap(([, value]) => [value, ...value.split(',').map(v => v.trim())])
    .filter(value => value.length >= 4)
    .flatMap(value => [value, encodeURIComponent(value)])
    .sort((a, b) => b.length - a.length);
  return value => JSON.stringify(value, (_key, item) => {
    if (typeof item === 'number' && secrets.includes(String(item))) return '[REDACTED]';
    if (typeof item !== 'string') return item;
    for (const secret of secrets) item = item.split(secret).join('[REDACTED]');
    return item;
  }, 2);
}
