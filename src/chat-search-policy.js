import { independentPlannedAnswer } from './chat-source-plan.js';
import { chatTimeRemaining } from './chat-time-budget.js';
import { classifyChatError } from './chat-errors.js';
import { reviewSourceBodies, isExamFeeRequest } from './evidence-review.js';
import { renderWeatherEvidence } from './web-evidence.js';

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
  let unavailable = wikiOnly
    ? '푝무위키에서 질문 대상에 맞는 근거를 확인하지 못했다냥.'
    : failures[webSearchData?.status] ?? (failed ? '조회 또는 검증 과정이 완료되지 않아 요청한 사실을 확인하지 못했다냥.'
      : '검색에서 질문 대상과 일치하는 근거를 확인하지 못했다냥.');
  if (!wikiOnly && webSearchData?.status === 'no-verified-articles' && webSearchData.newsVerification?.failures?.pageReads) {
    unavailable += ` 일부 후보의 본문 조회도 ${webSearchData.newsVerification.failures.pageReads}건 실패했다냥.`;
  }
  const body = webSearchData?.bodyVerification;
  const scope = !wikiOnly && body?.scopeEvidence?.find(s => s.scope === 'location-dependent-registration-fee');
  if (!wikiOnly && !hasEvidence && body) {
    const termination = {
      'search-budget-exhausted': '검색 횟수 한도에 도달했지만 요청 조건을 확인할 근거를 확보하지 못했다냥.',
      'read-budget-exhausted': '본문 조회 횟수 한도에 도달했지만 요청 조건을 확인할 근거를 확보하지 못했다냥.',
      'time-budget-exhausted': '자료 확인 시간 한도에 도달해 요청 조건을 검증하지 못했다냥.',
      'external-budget-reserved-for-answer': '답변을 위한 호출 예약 때문에 추가 근거 검토를 중단해 요청 조건을 확인하지 못했다냥.',
      'model-budget-reserved-for-answer': '답변·최종 검증용으로 남겨 둔 모델 호출을 제외하면 추가 근거 검토에 사용할 모델 호출이 없다냥.',
      'model-budget-exhausted': '모델 호출 횟수 한도에 도달해 추가 근거 검토를 진행하지 못했다냥.',
      'http-budget-reserved-for-answer': '답변용 HTTP 호출 예약 때문에 추가 자료 확인을 진행하지 못했다냥.',
      'http-budget-exhausted': 'HTTP 요청 횟수 한도에 도달해 추가 자료 확인을 진행하지 못했다냥.',
      'completion-time-reserved': '답변을 마칠 시간을 남겨 두기 위해 추가 자료 확인을 중단했다냥.',
      'no-safe-query-refinement': '확보한 검색 후보와 안전한 후속 검색으로 요청 조건을 확인하지 못했다냥.',
    }[body.stopReason];
    if (termination) unavailable = termination;
    if (body.exhaustedBudgets?.includes('searches') && body.exhaustedBudgets?.includes('reads')) unavailable = '내부 검색 횟수와 본문 조회 횟수 한도에 도달했지만 요청 조건을 확인할 근거를 확보하지 못했다냥.';
    if (scope) {
      const country = [body.originalQuestion, intent.externalPrompt].filter(Boolean).join('\n').match(/한국|대한민국|미국|일본|중국|South Korea|United States|Japan|China/i)?.[0];
      unavailable = `ETS 공식 안내에서 TOEFL iBT 등록비는 시험 장소를 선택해야 확인할 수 있다는 범위까지 확인했다냥. ${country ? `${country}의 현재 기본 응시료 금액은 확인하지 못했다냥.` : '현재 기본 응시료 금액은 확인하지 못했다냥. 응시할 국가·지역을 알려달라냥.'}\n공식 원문: “${scope.quote}”\n${scope.url}`;
    }
    if (body.error?.status === 503 || body.reviewCalls?.some(e => e.error?.status === 503) || body.reviews?.some(r => r.repairError?.status === 503)) unavailable += ' 확보한 자료의 근거 검토 중 검토 모델이 일시적으로 응답하지 못했다냥(503).';
    if (body.reviews?.some(r => r.validationFailures?.includes('missing-or-duplicate-review'))) unavailable += ' 일부 자료는 검토 응답에서 ID가 누락되거나 중복되어 채택하지 못했다냥.';
    if (body.reads?.some(r => r.error?.category === 'timeout')) unavailable += ' 일부 후보의 본문 조회는 시간 초과로 실패했다냥.';
    if (body.failureEvents?.some(e => e.stage === 'search' && e.status === 'parse-error')) unavailable += ' 일부 검색 응답은 결과 형식을 해석하지 못했다냥.';
  }
  return { hasEvidence, hasPartialEvidence: Boolean(scope), unavailable,
    ...(!hasEvidence && scope ? { answerVerification: {status:'sourced-partial', requestedAmountVerified:false, sources:[scope]} } : {}),
    blockWholeAnswer: intent.requiresExternal && !intent.hasLocalAnswer && !hasEvidence && !scope };
}

export async function answerChatBySource(prompt, options, generate) {
  const { searchIntent: intent, evidenceDecision: decision } = options;
  options = { ...options, plannedAnswer: options.plannedAnswer ? { ...options.plannedAnswer, answer: intent?.requiresExternal ? independentPlannedAnswer(options.plannedAnswer.answer) : options.plannedAnswer.answer } : null };
  if (!intent) return generate(prompt, options);
  const originalGenerate = generate;
  generate = async (request, config) => {
    if (config.localOnly && !intent.independentLocalPrompt && intent.identityTrace?.anchors?.length) return { answer: '', usedPermanentMemoryIds: [] };
    const evidenceExcerpt = () => options.webEvidence.filter((s) => s.bodyReview?.relevant === true && s.bodyReview?.quote).map((s) => `“${s.bodyReview.quote}”\n${s.url}`).join('\n\n');
    let result;
    try {
      if (config.completeAnswer && options.webEvidence?.length && chatTimeRemaining() < 5000) throw new Error('Answer time reserved');
      result = await originalGenerate(request, config);
    } catch (error) {
      if (!config.completeAnswer || !options.webEvidence?.length) throw error;
      if (isExamFeeRequest(options.originalPrompt || prompt)) return {
        answer: '현재 적용되는 응시료의 국가·시험 종류·적용 시점을 검증하지 못했다냥. 응시 국가와 시험 종류를 알려주면 그 조건으로 확인해야 한다냥.',
        usedPermanentMemoryIds: [], answerVerification: {status:'review-failed', error:classifyChatError(error)},
      };
      return { answer: `확인한 자료에서는 다음 내용까지 확인할 수 있다냥.\n${evidenceExcerpt()}`,
        usedPermanentMemoryIds: [], answerVerification: { status: 'excerpt-only', error: classifyChatError(error) } };
    }
    if (result.citationsValid === false) return { ...result, answerVerification: { status: 'citation-rejected' } };
    if (!config.completeAnswer || !options.webEvidence?.length || isPureEvidenceAbstention(result.answer)) return result;
    const estimatesOnly = isExamFeeRequest(options.originalPrompt || prompt)
      && options.webEvidence.every(s => s.bodyReview?.feeApplicability?.scope === 'estimate');
    if (estimatesOnly && (!/블로그|비공식|자료/.test(result.answer)
        || !/대략|약|전후|추정/.test(result.answer)
        || !/(?:현재|공식).{0,30}(?:미확인|확인하지 못|확인되지 않|확인할 수 없)/.test(result.answer))) {
      return { ...result, answer: '확보한 자료로 현재 공식 응시료를 확인하지 못했다냥.', answerVerification: { status: 'rejected', reason: 'fee-estimate-expanded-to-current-price' } };
    }
    let accepted = false;
    let answerVerification = { status: 'review-failed' };
    try {
      const reviewed = await reviewSourceBodies(options.originalPrompt || prompt, options.webEvidence, originalGenerate, {
        finalVerification: true, now: options.now,
        constraints: `검증할 최종 답변: ${result.answer}\n답변의 모든 외부 주장이 이 자료들로 뒷받침되는지 검사한다. 원래 대상의 약어·별칭·코드 대응, 수치, 직항 여부, 시간 종류, 현재성, 국가·지역, 시험/제품 종류·버전, 조건을 추측해 확장한 주장이 하나라도 있으면 모든 자료에 relevant=false로 답하고 reason에 이유를 적는다. 일부 확인만으로 답변 전체가 확인된 것으로 처리하지 않는다. 가격 자료가 특정 국가·시험 종류·유효 시점을 명시하지 않으면 현재의 일반 요금으로 단정하지 않는다. 자료가 안내한 금액과 미확인 조건을 구분한 제한적 설명은 허용한다. 자체 설정 부분은 검사 대상에서 제외한다.`,
      });
      answerVerification = { status: 'reviewed', reviews: reviewed.map((s) => ({ url: s.url, ...s.bodyReview })) };
      accepted = reviewed.some((r) => r.bodyReview.relevant) && !reviewed.some((r) => r.bodyReview.status === 'invalid-review');
      answerVerification.status = accepted ? 'success' : reviewed.some((s) => s.bodyReview.status === 'invalid-review') ? 'review-failed' : 'rejected';
    } catch (error) { answerVerification = { status: 'review-failed', error: { ...classifyChatError(error), reviewMetrics: error.reviewMetrics } }; }
    if (accepted) return { ...result, answerVerification };
    if (answerVerification.status === 'review-failed' && !isExamFeeRequest(options.originalPrompt || prompt)) return {
      ...result, answer: `최종 답변 검토를 완료하지 못해 이미 검증한 원문만 제공한다냥.\n${evidenceExcerpt()}`,
      answerVerification: { ...answerVerification, status: 'excerpt-only', generatedAnswerAccepted: false },
    };
    // A failed verifier cannot authorize a different answer or resurrect a planner draft.
    return { ...result, answerVerification, answer: isPureEvidenceAbstention(result.answer) ? result.answer : '확보한 자료로 요청한 사실을 검증하지 못했다냥.' };
  };
  const localOptions = { ...options, searchIntent: null, wikiSearchContext: '', webSearchContext: options.providedPageContext ?? '' };
  if (!intent.requiresExternal) return options.plannedAnswer ?? generate(prompt, localOptions);
  if (options.verifiedExternalAnswer) {
    const weather = renderWeatherEvidence({results:options.webEvidence}, options.originalPrompt || prompt, options.now);
    const answerVerification = weather && weather === options.verifiedExternalAnswer ? {
      status:'success', method:'validated-weather-excerpt',
      reviews:options.webEvidence.filter(s => s.bodyReview?.relevant).map(s => ({url:s.url, ...s.bodyReview})),
    } : undefined;
    // The planner's draft may deny evidence we have since verified. Never append
    // verified facts to that draft or regenerate the original external question.
    if (!intent.independentLocalPrompt) {
      return { answer: options.verifiedExternalAnswer, usedPermanentMemoryIds: [], answerVerification };
    }
    const local = options.plannedAnswer?.answer ? options.plannedAnswer : await generate(intent.independentLocalPrompt, { ...localOptions, localOnly: true });
    return { answer: [local?.answer, options.verifiedExternalAnswer].filter(Boolean).join('\n\n'),
      usedPermanentMemoryIds: local?.usedPermanentMemoryIds ?? [], answerVerification };
  }
  if (options.plannedAnswer?.answer && intent.hasLocalAnswer) {
    const external = decision.hasEvidence
      ? await generate(prompt, { ...options, completeAnswer: true })
      : { answer: decision.unavailable, answerVerification:decision.answerVerification };
    return { ...external, answer: external.answer?.includes(options.plannedAnswer.answer) ? external.answer : [options.plannedAnswer.answer, external.answer].filter(Boolean).join('\n\n') };
  }
  if (!intent.hasLocalAnswer) {
    if (!decision.hasEvidence) {
      return { answer: decision.unavailable, usedPermanentMemoryIds: [], answerVerification:decision.answerVerification };
    }
    const completed = await generate(prompt, { ...options, completeAnswer: true });
    if (completed.citationsValid !== false) return completed;
    if (!intent.independentLocalPrompt) return completed;
    const local = options.plannedAnswer?.answer ? options.plannedAnswer : await generate(intent.independentLocalPrompt, { ...localOptions, localOnly: true });
    return { ...local, answer: [local.answer, completed.answer].filter(Boolean).join('\n\n') };
  }
  // Separate generation also keeps missing/invalid external citations from erasing
  // a valid self-introduction, translation, or memory answer.
  const local = options.plannedAnswer?.answer ? options.plannedAnswer : await generate(intent.independentLocalPrompt || intent.localPrompt, { ...localOptions, localOnly: true });
  const external = decision.hasEvidence
    ? options.verifiedExternalAnswer
      ? { answer: options.verifiedExternalAnswer, usedPermanentMemoryIds: [] }
      : await generate(prompt, { ...options, completeAnswer: true, externalOnly: true })
    : { answer: decision.unavailable, usedPermanentMemoryIds: [], answerVerification:decision.answerVerification };
  return { ...local, answerVerification: external.answerVerification, answer: [local.answer, external.answer].filter(Boolean).join('\n\n'),
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

// Only standalone statements of missing evidence may survive a failed review.
// Numeric estimates, URLs, additional assertions and planner text cannot enter.
export function isPureEvidenceAbstention(answer) {
  const text = String(answer || '').trim();
  return text.length <= 300 && !/[\d$]|https?:|하지만|그러나|일반적으로|대략|보통/.test(text)
    && text.split(/(?<=[.!?。])\s+/).every((sentence) => /^(?:제공된|확보한|현재|검색|이 자료|해당 자료).*(?:확인할 수 없|확인하지 못|확인되지 않|알 수 없)[^.!?。]*[.!?。]?$/.test(sentence));
}
