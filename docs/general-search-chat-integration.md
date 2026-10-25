# 범용 검색 챗봇 개발 통합

`GENERAL_SEARCH_MODE`의 기본값은 `off`다. 허용 값은 `off`, `shadow`, `on`이며 그 밖의 값도 `off`로 처리한다. 운영 설정은 변경하지 않았다.

일반 대화에서는 기존 `classifyWebSearchIntent` 및 `sourcePlan`이 외부 사실 조회 여부를 정한다. `tryBuildWebSearchData`는 기존 `searchWeb`의 DuckDuckGo → Naver 검색과 `collectWebBodyEvidence`의 본문 읽기 및 기존 검토를 수행한다. 범용 분기는 이 결과의 `bodyVerification.reads`를 재사용한다. `selectGeneralSearchSources`가 URL을 선별하고 `selectRelevantSourceSpans`가 관련 구간을 뽑는다. `createGeminiEvidenceExtractor`가 구조화된 인용을 생성하며 `validateExtractedEvidenceFact(..., { strictSemantic: true })`가 URL·인용·주체·관계·수치·날짜를 다시 확인한다. 통과한 사실의 원문 인용과 URL만 챗봇 답변으로 전송한다.

`off`에서는 새 분기를 건너뛴다. `shadow`는 기본적으로 기존 답변을 그대로 보내며 추가 HTTP/Gemini 요청을 하지 않는다. `GENERAL_SEARCH_SHADOW_REPLAY_FILE`에 저장된 실험 결과 JSON 경로를 지정하면 질문 문자열이 일치하는 `results[].methodB.facts`만 현재 확보한 본문에 다시 대조하고 판정을 로그에 남긴다. 파일이 없거나 질문/원문이 다르면 비교 불가로 기록하고 기존 답변을 유지한다. `on`에서는 기존 검색이 확보한 본문에 대해 Gemini 근거 추출을 최대 한 번 호출한다. 검증된 근거가 있으면 Complete/Partial/Hold를 조립한다. 검색·본문·Gemini 자체가 실패하면 기존 fallback으로 돌아가며, 그 fallback 결과를 범용 검증 사실로 기록하지 않는다.

기상청 날씨, 뉴스 전용 흐름, Pyhok 위키, 나이 검증, 체스, 이미지 및 지역 대화는 새 분기에서 제외한다. 기존 Discord 명령어와 기억·이력 구조는 유지한다. 범용 답변은 기존 `sendChatFactReply`를 거쳐 기억에 남으며, 해당 응답만 검증 출처 URL을 화면에도 보인다.

오프라인 통합 테스트는 `node test/general-search-chat.test.js`, `node test/general-search-semantic-generalization.test.js`, `node scripts/replay-general-search-focused-gemini.js --output=/tmp/general-search-focused-integration-replay.json`으로 실행한다. 저장 입력의 집중 질문 5개는 챗봇 단계에서 Hold/Partial/Hold/Hold/Partial로 처리된다. 그중 실제 Gemini 후보가 있던 두 질문의 strictSemantic 재생 결과는 Partial 2건, 승인 사실 8건이다. 독립 사실 정확도는 여전히 `null`이다. 기존 18개 개발 질문의 평가 결과와 Holdout 8개는 이 통합 테스트에서 수정하거나 읽지 않는다.

예시: Complete는 `확인된 근거는 다음과 같다냥. - 고양이는 포유류이다. 출처: https://example.org/fact`, Partial은 `일부만 확인했다냥. ... 확인하지 못한 항목: ...`, Hold는 `요청한 사실을 확인할 근거를 찾지 못했다냥.`이다. 예시 도메인은 합성 테스트 자료다.

제한적인 Discord 테스트 서버 검증은 개발 봇 인스턴스에만 `GENERAL_SEARCH_MODE=shadow`와 저장 replay 파일을 지정해 동일 질문의 기존 응답과 판정 로그를 비교한 뒤, 개발 봇에서만 `on`으로 바꾸고 일반 사실 질문, 날짜가 있는 질문, 검색 실패, 날씨·위키·체스 질문을 각각 확인한다. 테스트 서버의 봇 토큰과 채널만 사용하고 운영 PM2에는 적용하지 않는다. 실제 `on` 호출은 웹 검색 및 Gemini 사용량·지연을 늘릴 수 있으며, 원문 선별 실패나 독립 정확도 미측정 위험이 남아 있다.
