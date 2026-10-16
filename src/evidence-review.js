// Semantic decisions require exact quotations from the supplied material.
// Evidence kind and limitations travel with every accepted quotation.
export async function reviewSourceBodies(query, sources, generate, options = {}) {
  if (!sources.length) return [];
  const result = await generate(
    `질문: ${query}\n각 자료의 주된 내용이 질문 대상과 사실에 직접 관련되는지 판정한다. 원문 약어·별칭·코드의 대응은 자료에 적힌 경우만 인정하며 익숙한 다른 대상으로 바꾸지 않는다. 일부 항목만 뒷받침해도 그 범위를 quote에 담아 relevant=true로 허용한다. 공식 출처나 긴 산문이라는 조건을 일괄 요구하지 않는다. 자료 종류(본문/검색 스니펫), 시점 변동성, 필요한 정확도에 맞춰 판단한다. 스니펫은 명시된 항목의 제한적 근거로만 허용하며 현재 운항·실시간 상태·가격처럼 시점에 민감한 단정에는 적합한 날짜·조건이 필요하다. 비행시간, 직항 여부, 경유 포함 총 소요시간은 별개로 평가한다. 비행시간만 요청했다면 직항 운항 여부나 경유 총시간을 확인하지 못해도 자료에 명시된 비행시간과 그 조건은 허용한다. 검색 결과에 있다는 사실, 단어 하나, 메뉴·추천·푸터의 언급은 관련성 증거가 아니다. 제목과 본문이 다른 기사도 거부한다. 비교는 각 전체 대상 이름을 개별 식별해야 한다. 영상 제목·푸터는 영상 내용이 아니다. 홈페이지 홍보는 특정 버전 비교 근거가 아니다. relevant=true이면 핵심 사실을 담은 연속된 본문 원문을 quote로 복사한다(자료 종류에 관계없이 필요한 대상·항목을 포함한 1~600자). 해석이나 요약을 quote에 만들지 않는다. 날씨는 region에 실제 자료 지역, validTime에 자료의 관측/예보 대상 시각, kind에 observation/forecast/unknown을 적는다. 지역과 대상 시각은 본문에 적힌 표현을 그대로 복사한다. 기상 자료가 아니거나 모르면 빈 문자열/unknown이다. dataType은 weather/table/structured/prose 중 하나다. 날씨는 질문 지역과 자료 지역, 기준 날짜와 자료 대상 날짜·시각을 비교하고 기온·상태 등 질문에 필요한 필드를 확인하고 weatherFields 배열에 단위·항목명이 포함된 실제 필드 원문을 복사한다. 다른 자료는 빈 배열이다. 제목과 추출 메타데이터도 지역·시각의 근거로 사용할 수 있다. 조회 시각으로 자료 시각을 채우지 않는다. 관측/예보 구분이 없으면 unknown이다.\n추가 검증 조건(위 일반 부분 확인 규칙보다 우선): ${options.constraints || '없음'}`,
    { history: [], evidenceReview: true, retrievalReview: Boolean(options.onRefinement), webSearchContext: sources.map((s, id) => `[${id}] 제목: ${s.title}\nURL: ${s.url}\n발견 제목: ${s.discoveredTitle || s.title}\n발견 URL: ${s.discoveredUrl || s.url}\n메타데이터: ${s.metadataText || ''}\n자료 종류: ${s.evidenceKind || 'body'}\n본문: ${s.pageText}`).join('\n\n') },
  );
  options.onRefinement?.(result.searchRefinement, sources);
  return sources.map((source, id) => {
    const matches = (result.evidenceReviews ?? []).filter((r) => r.id === id);
    const review = matches.length === 1 ? matches[0] : null;
    const quote = String(review?.quote ?? '').trim();
    const provenance = [source.title, source.metadataText, source.pageText].filter(Boolean).join('\n');
    const weatherFields = (Array.isArray(review?.weatherFields) ? review.weatherFields : []).filter((field) => typeof field === 'string' && field.trim() && source.pageText.includes(field));
    const fieldsValid = review?.dataType !== 'weather' || weatherFields.length > 0;
    const valid = fieldsValid && review?.relevant === true && quote.length >= 1 && quote.length <= 600
      && source.pageText.includes(quote);
    return { ...source, bodyReview: { ...review, weatherFields, status: !review || typeof review.relevant !== 'boolean' || (review.relevant && !valid) ? 'invalid-review' : 'reviewed', relevant: valid, quote: valid ? quote : '',
      region: review?.region && provenance.includes(review.region) ? review.region : '',
      validTime: review?.validTime && provenance.includes(review.validTime) ? review.validTime : '',
      kind: ['observation', 'forecast'].includes(review?.kind) ? review.kind : 'unknown',
    } };
  });
}

export async function answerSupplementaryWikiFacts(prompt, data, verifiedAnswer, generate) {
  const sources = (data?.results ?? []).filter((r) => r.exactTitleMatch).map((r) => ({
    title: r.documentTitle || r.title, url: r.url,
    pageText: [r.primaryContent, r.content, r.raw].filter(Boolean).join('\n'),
  }));
  let reviewed = [];
  try { reviewed = await reviewSourceBodies(prompt, sources, generate, {
    constraints: `이미 검증된 답변: ${verifiedAnswer}\n추가 질문의 사실만 선택한다. 검증된 대상·생일·계산 나이를 부정하거나, 오래된 나이 서술처럼 계산 결과와 충돌하는 발췌는 거부한다. 추가 사실이 없으면 relevant=false다.`,
  }); } catch { /* Preserve the verified calculation if supplementary lookup fails. */ }
  const facts = reviewed.filter((r) => r.bodyReview.relevant);
  return facts.length ? facts.map((r) => `추가 확인 내용(위키 본문 발췌): ${r.bodyReview.quote}\n${r.url}`).join('\n\n')
    : '나이·생년월일 외에 요청한 추가 정보는 확보한 본문에서 확인하지 못했다냥.';
}
