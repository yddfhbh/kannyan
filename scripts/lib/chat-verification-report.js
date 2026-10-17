export function summarizeTimings(events, elapsedMs) {
  const sum = (predicate) => events.filter(predicate).reduce((n, e) => n + (e.durationMs || 0), 0);
  const collection = events.filter((e) => ['tryBuildWebSearchData', 'tryBuildPyhokWikiSearchData', 'collectWebBodyEvidence'].includes(e.event));
  const intervals = collection.filter((e) => e.startedAt && e.endedAt).map((e) => [e.startedAt, e.endedAt]).sort((a,b) => a[0]-b[0]);
  let union = 0, end = 0;
  for (const [a,b] of intervals) { union += Math.max(0,b-Math.max(a,end)); end = Math.max(end,b); }
  return { elapsedMs, planningMs: sum((e) => ['model-response','model-error'].includes(e.event) && e.stage === 'planning'),
    searchMs: sum((e) => e.event === 'searchWeb'),
    evidenceCollectionMs: intervals.length ? union : null,
    evidenceCollectionWorkMs: collection.reduce((n,e) => n+(e.durationMs || 0),0),
    evidenceReviewMs: sum((e) => ['model-response','model-error'].includes(e.event) && e.stage === 'evidence-review'),
    finalVerificationMs: sum((e) => ['model-response','model-error'].includes(e.event) && e.stage === 'final-verification'),
    finalAnswerMs: sum((e) => ['model-response','model-error'].includes(e.event) && e.stage === 'answer'),
    answerVerificationMs: sum((e) => e.event === 'answer-verification'),
    serviceUnavailableMs: sum((e) => e.event === 'model-error' && e.status === 503) };
}
export function summarizeVerification(events, sent) {
  const retrieval = events.filter((e) => ['tryBuildWebSearchData', 'tryBuildPyhokWikiSearchData'].includes(e.event));
  const attempted = events.filter((e) => e.event === 'searchWeb' || e.event === 'http-attempt' && e.service === 'retrieval');
  const hasEvidence = retrieval.some((e) => e.result?.results?.some((r) => r.pageText || r.content || r.raw || r.bodyReview?.relevant || r.exactTitleMatch || r.strongTitleMatch)
    || e.result?.bodyVerification?.reads?.some((r) => r.extractedBody?.trim()));
  const bodyReviews = retrieval.flatMap(e => e.result?.bodyVerification?.reviews || []);
  const reviewErrors = events.filter(e => e.event === 'model-error' && e.stage === 'evidence-review');
  const reviewedEvidence = retrieval.some((e) => e.result?.results?.some((r) => r.bodyReview?.relevant));
  const searchSuccess = events.some((e) => e.event === 'searchWeb' && ['success','empty'].includes(e.status))
    || retrieval.some((e) => ['success','empty','partial-success'].includes(e.result?.retrievalStatus || e.result?.status) || e.result?.bodyVerification?.retrievalStatus === 'success' || e.result?.results?.length);
  const verifications = events.filter((e) => e.event === 'answer-verification' && e.result?.status !== 'not-applicable');
  const sourced = sent.some((a) => /https?:\/\//.test(a));
  const sourcedPartial = verifications.some(e => e.result.status === 'sourced-partial');
  const claim = verifications.length ? verifications.every((e) => e.result.status === 'success') ? 'success' : 'failure'
    : sourced ? 'unverified' : hasEvidence ? 'unverified' : 'not-applicable';
  const planningFailed = events.some(e => e.event === 'generation-failed' && e.stage === 'planning');
  const finalCheckFailed = verifications.some(e => !['success','sourced-partial'].includes(e.result.status));
  const externalFailed = planningFailed || finalCheckFailed || retrieval.some(e => ['review-failed','retrieval-failed','insufficient-evidence','no-verified-articles'].includes(e.result?.status));
  return { searchExecuted: attempted.length > 0 || retrieval.some(e => e.result?.attempts?.length),
    failurePath: planningFailed ? 'planning-call-failure' : finalCheckFailed ? 'final-verification-failure' : sourcedPartial ? null : reviewErrors.length && !reviewedEvidence ? 'evidence-review-call-failure' : bodyReviews.length && !reviewedEvidence ? 'evidence-review-validation-failure' : externalFailed ? 'evidence-unavailable' : null,
    terminationReasons: retrieval.map(e => ({ status: e.result?.status, stopReason: e.result?.bodyVerification?.stopReason, requestedSatisfied: e.result?.bodyVerification?.requestedSatisfied, remaining: e.result?.bodyVerification?.remaining, reviewError: e.result?.bodyVerification?.error })),
    answerDelivered: sent.length > 0, qualityStatus: externalFailed ? 'failed' : sourcedPartial ? 'sourced-partial' : claim === 'success' ? 'source-claims-verified' : 'unassessed',
    search: searchSuccess ? 'success' : attempted.length || retrieval.some((e) => e.result && e.result.status !== 'skipped') ? 'failure' : 'not-applicable',
    evidence: hasEvidence ? 'success' : attempted.length || retrieval.length ? 'unverified' : 'not-applicable',
    evidenceReview: reviewedEvidence ? 'success' : sourcedPartial ? 'partial' : bodyReviews.length || reviewErrors.length ? 'failure' : hasEvidence ? 'unverified' : 'not-applicable',
    finalAnswer: !sent.length || externalFailed ? 'failure' : sourcedPartial ? 'sourced-partial' : claim === 'success' ? 'success' : 'delivered-unverified', claimSourceMatch: sourcedPartial && !externalFailed ? 'partial' : claim,
    qualityPassed: sent.length > 0 && claim === 'success' && !externalFailed, searchSuccess, evidenceAcquired:hasEvidence, finalAnswerGenerated:sent.length > 0 && !planningFailed };
}
