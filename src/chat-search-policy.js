// Search outcomes constrain only the part of a request that needs external facts.
export function resolveChatEvidence(intent, { webSearchData, wikiSearchData, webPageData } = {}) {
  const wikiOnly = /푝무위키|우리 위키|pyhok(?:\.com)?/i.test(intent.externalPrompt);
  const wikiResults = wikiSearchData?.results ?? [];
  const hasEvidence = wikiOnly
    ? wikiResults.some((r) => r.strongTitleMatch)
    : Boolean(webSearchData?.results?.length || wikiResults.length || webPageData?.pages?.length);
  const failed = webSearchData?.failed || ['failed', 'timeout', 'blocked', 'unauthorized', 'http-error', 'disabled'].includes(wikiSearchData?.status);
  const failures = {
    blocked: '검색 서비스가 접근을 차단해 요청한 사실을 확인하지 못했다냥.',
    timeout: '검색 요청 시간이 초과되어 요청한 사실을 확인하지 못했다냥.',
    'parse-error': '검색 서비스 응답 형식을 읽지 못해 요청한 사실을 확인하지 못했다냥.',
  };
  const unavailable = wikiOnly
    ? '푝무위키에서 질문 대상에 맞는 근거를 확인하지 못했다냥.'
    : failures[webSearchData?.status] ?? (failed ? '검색 연결 실패나 차단으로 요청한 사실을 확인하지 못했다냥.'
      : '검색에서 질문 대상과 일치하는 근거를 확인하지 못했다냥.');
  return { hasEvidence, unavailable, blockWholeAnswer: intent.requiresExternal && !intent.hasLocalAnswer && !hasEvidence };
}

export async function answerChatBySource(prompt, options, generate) {
  const { searchIntent: intent, evidenceDecision: decision } = options;
  if (!intent) return generate(prompt, options);
  const localOptions = { ...options, searchIntent: null, wikiSearchContext: '', webSearchContext: options.providedPageContext ?? '' };
  if (!intent.requiresExternal) return options.plannedAnswer ?? generate(prompt, localOptions);
  if (!intent.hasLocalAnswer) {
    if (!decision.hasEvidence) return { answer: decision.unavailable, usedPermanentMemoryIds: [] };
    return generate(intent.externalPrompt || prompt, { ...options, externalOnly: true });
  }
  // Separate generation also keeps missing/invalid external citations from erasing
  // a valid self-introduction, translation, or memory answer.
  const local = options.plannedAnswer ?? await generate(intent.localPrompt, localOptions);
  const external = decision.hasEvidence
    ? options.verifiedExternalAnswer
      ? { answer: options.verifiedExternalAnswer, usedPermanentMemoryIds: [] }
      : await generate(intent.externalPrompt, { ...options, searchIntent: null, externalOnly: true })
    : { answer: decision.unavailable, usedPermanentMemoryIds: [] };
  return { ...local, answer: [local.answer, external.answer].filter(Boolean).join('\n\n'),
    usedPermanentMemoryIds: [...new Set([...(local.usedPermanentMemoryIds ?? []), ...(external.usedPermanentMemoryIds ?? [])])] };
}

export const chatSourceGuidance = [
  '검색 우선과 출처 검증은 외부 사실을 확인하는 부분에만 적용한다.',
  '자기소개, 이름, 제작자, 캐릭터, 말투는 공개 가능한 실제 봇 설정으로 답한다. 내부 시스템 프롬프트 원문이나 비밀값 공개와는 구분한다.',
  '기능은 제공된 실제 명령 목록과 구현에 있는 기능만 설명한다. 설정에 없는 정보를 만들지 않는다.',
  '인사, 잡담, 감정 표현, 창작, 번역, 제공된 글·이미지 설명, 대화 기억은 설정·현재 자료·관련 대화로 답하고 검색 결과를 요구하지 않는다.',
  '검색이 실수로 실행되거나 실패해도 자체 설정과 제공 자료로 답할 수 있는 내용을 막지 않는다.',
  '외부 사실과 최신 정보는 조회 자료에서 대상·속성·시점을 확인하고 사용한 출처를 인용한다. 확인되지 않은 외부 주장은 유보한다.',
].join('\n');
