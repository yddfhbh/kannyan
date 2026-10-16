import { classifyChatError } from './chat-errors.js';
import { reviewSourceBodies } from './evidence-review.js';

// Search outcomes constrain only the part of a request that needs external facts.
export function resolveChatEvidence(intent, { webSearchData, wikiSearchData, webPageData } = {}) {
  const wikiOnly = /푝무위키|우리 위키|pyhok(?:\.com)?/i.test(intent.externalPrompt);
  const wikiResults = wikiSearchData?.results ?? [];
  const hasEvidence = wikiOnly
    ? wikiResults.some((r) => r.strongTitleMatch)
    : webSearchData?.newsVerification ? Boolean(webSearchData.results?.length)
      : Boolean(webSearchData?.results?.length || wikiResults.length || webPageData?.pages?.length);
  const failed = webSearchData?.failed || ['failed', 'timeout', 'blocked', 'unauthorized', 'http-error', 'disabled'].includes(wikiSearchData?.status);
  const failures = {
    'no-verified-articles': '검색 결과는 얻었지만 제한된 기사 조회에서 최근 14일 이내 게시일과 본문을 확인한 관련 개별 기사를 확보하지 못했다냥. 뉴스룸·포털·태그 목록을 최신 기사로 요약할 수는 없다냥.',
    empty: '검색 요청은 완료했지만 결과가 없어 요청한 사실을 확인하지 못했다냥.',
    failed: '검색 요청 중 연결 오류가 발생해 요청한 사실을 확인하지 못했다냥.',
    'extraction-failed': '검색 결과는 얻었지만 페이지에서 유효한 내용을 추출하지 못했다냥.',
    'retrieval-failed': '자료 조회 요청이 실패해 외부 사실을 확인하지 못했다냥.',
    'review-failed': '자료의 관련성 검증 중 오류가 발생해 외부 사실을 검증하지 못했다냥.',
    'insufficient-evidence': '확보한 검색 자료에서 질문을 뒷받침하는 자료를 확인하지 못했다냥.',
    blocked: '검색 서비스가 접근을 차단해 요청한 사실을 확인하지 못했다냥.',
    timeout: '검색 요청 시간이 초과되어 요청한 사실을 확인하지 못했다냥.',
    'parse-error': '검색 서비스 응답 형식을 읽지 못해 요청한 사실을 확인하지 못했다냥.',
  };
  const unavailable = wikiOnly
    ? '푝무위키에서 질문 대상에 맞는 근거를 확인하지 못했다냥.'
    : failures[webSearchData?.status] ?? (failed ? '조회 또는 검증 과정이 완료되지 않아 요청한 사실을 확인하지 못했다냥.'
      : '검색에서 질문 대상과 일치하는 근거를 확인하지 못했다냥.');
  return { hasEvidence, unavailable, blockWholeAnswer: intent.requiresExternal && !intent.hasLocalAnswer && !hasEvidence };
}

export async function answerChatBySource(prompt, options, generate) {
  const { searchIntent: intent, evidenceDecision: decision } = options;
  if (!intent) return generate(prompt, options);
  const originalGenerate = generate;
  generate = async (request, config) => {
    if (config.localOnly && !intent.independentLocalPrompt && intent.identityTrace?.anchors?.length) return { answer: '', usedPermanentMemoryIds: [] };
    const result = await originalGenerate(request, config);
    if (!config.completeAnswer || !options.webEvidence?.length || result.citationsValid === false) return result;
    let accepted = false;
    let answerVerification = { status: 'review-failed' };
    try {
      const reviewed = await reviewSourceBodies(options.originalPrompt || prompt, options.webEvidence, originalGenerate, {
        constraints: `검증할 최종 답변: ${result.answer}\n답변의 모든 외부 주장이 이 자료들로 뒷받침되는지 검사한다. 원래 대상의 약어·별칭·코드 대응, 수치, 직항 여부, 시간 종류, 현재성, 조건을 추측해 확장한 주장이 하나라도 있으면 모든 자료에 relevant=false로 답하고 reason에 이유를 적는다. 일부 확인만으로 답변 전체가 확인된 것으로 처리하지 않는다. 자체 설정 부분은 검사 대상에서 제외한다.`,
      });
      answerVerification = { status: 'reviewed', reviews: reviewed.map((s) => ({ url: s.url, ...s.bodyReview })) };
      accepted = reviewed.some((r) => r.bodyReview.relevant) && !reviewed.some((r) => r.bodyReview.status === 'invalid-review');
      answerVerification.status = accepted ? 'success' : reviewed.some((s) => s.bodyReview.status === 'invalid-review') ? 'review-failed' : 'rejected';
    } catch (error) { answerVerification = { status: 'review-failed', error: classifyChatError(error) }; }
    if (accepted) return { ...result, answerVerification };
    return { ...result, answerVerification, answer: (answerVerification.status === 'rejected' ? '답변에 자료로 뒷받침하지 못한 내용이 있어 확인된 자료 범위만 제시한다냥.' : '답변 검증 중 오류가 있어 확인된 자료 범위만 제시한다냥.') + ' 아래 인용 외의 항목·현재 상태는 확인하지 못했다냥.\n' + options.webEvidence.map((s) => `자료 종류: ${s.evidenceKind || 'body'}\n“${s.pageText}”\n${s.url}`).join('\n\n') };
  };
  const localOptions = { ...options, searchIntent: null, wikiSearchContext: '', webSearchContext: options.providedPageContext ?? '' };
  if (!intent.requiresExternal) return options.plannedAnswer ?? generate(prompt, localOptions);
  if (options.verifiedExternalAnswer) {
    // The planner's draft may deny evidence we have since verified. Never append
    // verified facts to that draft or regenerate the original external question.
    const local = await generate(intent.independentLocalPrompt || prompt, { ...localOptions, localOnly: true });
    return { answer: [local?.answer, options.verifiedExternalAnswer].filter(Boolean).join('\n\n'),
      usedPermanentMemoryIds: local?.usedPermanentMemoryIds ?? [] };
  }
  if (options.plannedAnswer && intent.hasLocalAnswer) {
    // A search-plan draft is never a deliverable: it can contain a promise or
    // repeat what the final model already answers. Give completion of the whole
    // request to one generation, including its independent local part.
    if (decision.hasEvidence && !options.verifiedExternalAnswer) {
      const completed = await generate(prompt, { ...options, completeAnswer: true });
      if (completed.citationsValid !== false) return completed;
      const local = await generate(intent.independentLocalPrompt || prompt, { ...localOptions, localOnly: true });
      return { ...local, answer: [local.answer, completed.answer].filter(Boolean).join('\n\n') };
    }
    const local = await generate(intent.independentLocalPrompt || prompt, { ...localOptions, localOnly: true });
    return { ...local, answer: [local.answer, options.verifiedExternalAnswer || decision.unavailable].filter(Boolean).join('\n\n') };
  }
  if (!intent.hasLocalAnswer) {
    if (!decision.hasEvidence) {
      const local = await generate(prompt, { ...localOptions, localOnly: true });
      return { ...local, answer: [local.answer, decision.unavailable].filter(Boolean).join('\n\n') };
    }
    const completed = await generate(prompt, { ...options, completeAnswer: true });
    if (completed.citationsValid !== false) return completed;
    const local = await generate(prompt, { ...localOptions, localOnly: true });
    return { ...local, answer: [local.answer, completed.answer].filter(Boolean).join('\n\n') };
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
  '사용자의 원래 대상 표기·약어·별칭·코드를 보존한다. 대응 관계는 자료에서 확인한 경우만 설명한다. 비행시간·직항 여부·경유 포함 총 소요시간은 각각 다른 사실이다. 요청한 항목과 근거가 뒷받침하는 항목만 답하고 서로 대체하지 않는다. 비행시간만 요청했다면 직항 여부·경유 총시간을 필수 확인 항목으로 추가하지 말고 확인한 시간의 조건을 밝힌다.',
  '자료가 일부 항목만 확인해도 확인한 부분은 출처·자료 종류·날짜·조건과 함께 답한다. 미확인 항목은 명시하고 스니펫을 본문 확인이나 현재 운항 확인으로 확대하지 않는다.',
  '검색 우선과 출처 검증은 외부 사실을 확인하는 부분에만 적용한다.',
  '자기소개, 이름, 제작자, 캐릭터, 말투는 공개 가능한 실제 봇 설정으로 답한다. 내부 시스템 프롬프트 원문이나 비밀값 공개와는 구분한다.',
  '기능은 제공된 실제 명령 목록과 구현에 있는 기능만 설명한다. 설정에 없는 정보를 만들지 않는다.',
  '인사, 잡담, 감정 표현, 창작, 번역, 제공된 글·이미지 설명, 대화 기억은 설정·현재 자료·관련 대화로 답하고 검색 결과를 요구하지 않는다.',
  '검색이 실수로 실행되거나 실패해도 자체 설정과 제공 자료로 답할 수 있는 내용을 막지 않는다.',
  '외부 사실과 최신 정보는 조회 자료에서 대상·속성·시점을 확인하고 사용한 출처를 인용한다. 확인되지 않은 외부 주장은 유보한다.',
  '제품·서비스·모델·버전 비교는 사용자가 쓴 전체 이름과 접미사, 해당 서비스의 맥락을 유지하고 공식 자료를 우선 확인한다. 비슷한 이름이나 접미사 없는 다른 제품의 자료를 같은 대상의 근거로 삼지 않는다.',
  '검색 결과 없음·검색 실패·학습 지식 부재는 존재하지 않음·미출시·가상이라는 증거가 아니다. 부정 주장에도 해당 대상을 명시한 신뢰할 수 있는 근거가 필요하다. 확인하지 못하면 확인 불가라고 답하고, 식별이 모호하면 사용한 서비스나 공식 링크 등 필요한 맥락을 짧게 묻는다.',
  '날씨는 자료의 실제 지역과 관측/예보 대상 시각을 밝힌다. 동 단위 자료를 시 전체의 관측값으로 확대하지 않는다. 시간별 예보는 현재 관측이 아니다. 조회 시각은 자료 시각이 아니다.',
  '비교 자료가 확보되면 확인한 차이까지 실제로 비교한다. 일부만 확인되면 그 부분만 비교하고 나머지는 확인 불가로 남긴다. 공식 설명, 조건이 명시된 측정 평가, 추정을 구분하고 스펙·가격·성능을 추측해서 채우지 않는다.',
].join('\n');
