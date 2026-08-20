export const defaultCouncilStatusChannelId = '1539799743398420521';

export const councilAgentDefinitions = Object.freeze({
  kanna: Object.freeze({
    key: 'kanna',
    label: 'kanna',
    role: 'Council 조정 및 최종 응답',
    aliases: Object.freeze(['kanna', 'kannya', 'kannyan', '깐나', '깐냥']),
  }),
  isharong: Object.freeze({
    key: 'isharong',
    label: 'isharong',
    role: 'Council 조사 및 분석',
    aliases: Object.freeze(['isharong', '이샤롱']),
  }),
  gangji: Object.freeze({
    key: 'gangji',
    label: 'gangji',
    role: 'Council 비판 및 검증',
    aliases: Object.freeze(['gangji', '강지']),
  }),
});

const councilStatusMarkerPrefix = 'AI Council 8A status';

export function normalizeCouncilAgentKey(value) {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (!normalized) {
    return '';
  }

  for (const definition of Object.values(councilAgentDefinitions)) {
    if (definition.aliases.some((alias) => normalized.includes(alias))) {
      return definition.key;
    }
  }

  return '';
}

export function isCouncilStatusChannelMessage(
  message,
  channelId = defaultCouncilStatusChannelId
) {
  return Boolean(channelId) && String(message?.channelId ?? '') === String(channelId);
}

export function buildCouncilStatusMarker(agentKey) {
  return `[${councilStatusMarkerPrefix}:${agentKey}]`;
}

export function buildCouncilStatusMessageContent(options = {}) {
  const definition = councilAgentDefinitions[options.agentKey];

  if (!definition) {
    throw new TypeError(`Unsupported Council agent: ${options.agentKey}`);
  }

  const responseAt = options.lastResponseAt instanceof Date
    && Number.isFinite(options.lastResponseAt.getTime())
    ? formatCouncilDateTime(options.lastResponseAt)
    : '기록 없음';
  const latencyMs = Number(options.latencyMs);
  const latency = Number.isFinite(latencyMs) && latencyMs >= 0
    ? `${Math.round(latencyMs)}ms`
    : '측정 불가';

  return [
    buildCouncilStatusMarker(definition.key),
    `**${definition.label} Council 상태**`,
    `Discord 표시 이름: ${sanitizePublicStatusValue(options.displayName, definition.label)}`,
    `상태: ${options.online ? 'Online' : 'Offline'}`,
    `모델: ${sanitizePublicStatusValue(options.model, '미설정')}`,
    `역할: ${sanitizePublicStatusValue(options.role, definition.role)}`,
    `마지막 AI 결과: ${formatAiOutcome(options.lastAiOutcome)}`,
    `마지막 응답 시각: ${responseAt}`,
    `Latency: ${latency}`,
  ].join('\n');
}

export function createCouncilStatusBoard(options = {}) {
  const client = options.client;
  const channelId = String(
    options.channelId ?? defaultCouncilStatusChannelId
  ).trim();
  const logger = options.logger ?? console;
  const refreshIntervalMs = Math.max(15_000, Number(options.refreshIntervalMs) || 30_000);
  let agentKey = normalizeCouncilAgentKey(options.agentKey);
  let statusMessage = null;
  let timer = null;
  let updateQueue = Promise.resolve();
  let lastAiOutcome = 'none';
  let lastResponseAt = null;
  let latencyMs = null;

  async function start() {
    agentKey ||= inferAgentKey(client);

    if (!agentKey || !channelId) {
      logger.warn?.('[COUNCIL STATUS] updater disabled because the agent identity or channel is unavailable.');
      return false;
    }

    await update();
    stopTimer();
    timer = setInterval(() => {
      void update();
    }, refreshIntervalMs);
    timer.unref?.();
    return true;
  }

  async function stop() {
    stopTimer();

    if (!statusMessage || !agentKey) {
      return;
    }

    await enqueueUpdate(false);
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function recordAiResult(result = {}) {
    lastAiOutcome = result.ok ? 'success' : 'failure';
    lastResponseAt = result.at instanceof Date ? result.at : new Date();
    const measuredLatencyMs = Number(result.latencyMs);
    latencyMs = Number.isFinite(measuredLatencyMs) && measuredLatencyMs >= 0
      ? measuredLatencyMs
      : null;
    return update();
  }

  function update() {
    return enqueueUpdate(Boolean(client?.isReady?.()));
  }

  function enqueueUpdate(online) {
    updateQueue = updateQueue
      .catch(() => undefined)
      .then(() => updateStatusMessage(online))
      .catch((error) => {
        statusMessage = null;
        logger.error?.('[COUNCIL STATUS] status message update failed.');
        logger.error?.(error);
      });

    return updateQueue;
  }

  async function updateStatusMessage(online) {
    if (!agentKey || !channelId) {
      return;
    }

    const channel = statusMessage?.channel
      ?? await fetchCouncilStatusChannel(client, channelId);

    if (!channel) {
      return;
    }

    statusMessage ??= await resolveCouncilStatusMessage(
      channel,
      client?.user?.id,
      agentKey
    );

    const definition = councilAgentDefinitions[agentKey];
    const displayName = channel.guild?.members?.me?.displayName
      || client?.user?.displayName
      || client?.user?.globalName
      || client?.user?.username
      || definition.label;
    const content = buildCouncilStatusMessageContent({
      agentKey,
      displayName,
      online,
      model: options.agentModel,
      role: options.agentRole || definition.role,
      lastAiOutcome,
      lastResponseAt,
      latencyMs: latencyMs ?? client?.ws?.ping,
    });

    if (statusMessage) {
      await statusMessage.edit({ content, allowedMentions: { parse: [] } });
      return;
    }

    statusMessage = await channel.send({
      content,
      allowedMentions: { parse: [] },
    });
  }

  return Object.freeze({
    start,
    stop,
    update,
    recordAiResult,
  });
}

async function fetchCouncilStatusChannel(client, channelId) {
  const channel = await client?.channels?.fetch?.(channelId).catch(() => null);

  if (!channel?.isTextBased?.() || !channel.messages || typeof channel.send !== 'function') {
    return null;
  }

  return channel;
}

async function resolveCouncilStatusMessage(channel, authorId, agentKey) {
  if (!authorId) {
    return null;
  }

  const marker = buildCouncilStatusMarker(agentKey);
  let before;

  while (true) {
    const messages = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
    });
    const reusable = messages.find((message) => (
      message.author?.id === authorId
      && String(message.content ?? '').includes(marker)
    ));

    if (reusable) {
      return reusable;
    }

    if (messages.size < 100) {
      return null;
    }

    before = messages.last()?.id;
    if (!before) {
      return null;
    }
  }
}

function inferAgentKey(client) {
  return normalizeCouncilAgentKey([
    client?.user?.displayName,
    client?.user?.globalName,
    client?.user?.username,
  ].filter(Boolean).join(' '));
}

function formatAiOutcome(value) {
  if (value === 'success') {
    return '성공';
  }

  if (value === 'failure') {
    return '실패';
  }

  return '기록 없음';
}

function sanitizePublicStatusValue(value, fallback) {
  const normalized = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/(?:token|api[_ -]?key|secret|authorization)\s*[:=]\s*\S+/gi, '[redacted]')
    .trim()
    .slice(0, 160);

  return normalized || fallback;
}

function formatCouncilDateTime(date) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}
