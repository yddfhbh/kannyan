# 주제·본문·최종 답변 검증 후속 수정

> 최신 실제 로그 후속 수정과 실행 명령은 [chat-live-final-fixes.md](chat-live-final-fixes.md)를 따른다. 아래는 이전 기록이다.

2026-10-15. 이 문서가 기존 `chat-live-remaining-fixes.md`의 후속 상태다. 기존 미커밋 변경을 보존했다. 관리 브랜치·HEAD를 바꾸거나 commit/push/배포/PM2 재시작을 실행하지 않았다.

## 원인과 변경

뉴스는 `tryBuildWebSearchData` → `collectNewsEvidence` → 검색 URL 조회 → 목록의 같은 사이트 링크 → `fetchWebPageText` → `extractReadablePageText` → 날짜/본문/관련성 판정 → `answerVerifiedNews` 경로였다. 목록의 링크 제목을 확인하지 않고 앞 세 링크를 우선 조회했고, 제목과 전체 추출문 중 검색어 하나만 있어도 관련 기사로 인정했다. 메뉴·추천 기사에서 발견한 AI도 통과할 수 있었다. 이 코드 경로는 확인했지만, 이번 사용자 메시지에는 원본 실행 로그·기사 URL·본문 파일이 없어 **실제 세 기사 각각이 어떤 목록 링크에서 왔는지까지 소급 확정하지는 못했다**.

- 목록에서 따라갈 링크는 제목을 이용해 후보를 좁힌다. 본문 컨테이너를 우선순위대로 선택하고 메뉴·추천·푸터를 제거한다.
- 기사별 발견 URL/제목, 부모 목록 URL, 최종 조회 URL, canonical URL, 추출 제목·본문을 trace에 보존한다. canonical의 경로/기사 식별 쿼리가 다르면 거부한다. 추적용 쿼리와 fragment는 비교에서 제외한다.
- 게시일·본문 확보·문서 식별과 주제 관련성을 각각 기록한다. 최근 14일과 본문 길이 통과가 관련성 통과를 대신하지 않는다.
- 본문들을 한 번의 구조화된 모델 요청으로 검토한다. 기사 핵심 주제가 질문과 직접 관련되는지, 제목과 본문이 일치하는지 판단하고 핵심 원문 인용을 요구한다. ID 중복·누락·원문에 없는 인용·판정 실패는 거부한다. 관련성 검증 실패 시 무관한 기사로 수를 채우지 않는다.
- 뉴스 답변은 통과한 핵심 원문 발췌로 요약한다. 제목·게시일·URL·확보 건수·조회 범위를 앱에서 렌더링한다. 자유 생성 요약의 추가 주장을 막기 위해 현재는 발췌임을 명시한다.

위키는 `sourcePlan.answer`가 비어 있지 않으면 `hasLocalAnswer=true`로 취급해 단순 나이 조회도 복합 질문 분기로 보낼 수 있었다. 그 분기는 원래 전체 질문을 `localOnly`로 다시 생성한 뒤 검증된 계산값을 덧붙였다. 모델의 정보 부정과 계산값이 공존할 수 있는 원인이다. **이번 원본 payload/응답 파일을 확보한 것은 아니며**, 사용자가 알려준 부정 문장과 구조화된 생일을 실제 handler에 주입해 재현했다.

- 검색 계획은 독립된 자체 요청 `localPrompt`와 추가 외부 사실 `additionalExternalPrompt`를 별도로 제공한다. 초안의 문장 존재를 독립 요청의 근거로 삼지 않는다.
- 단순 위키 나이/생일은 정확히 일치한 대상 문서·검증된 생일·요청 기준일·계산값으로 직접 렌더링한다. 조회 후 전체 질문을 다시 생성하거나 초안 뒤에 계산을 붙이지 않는다.
- 복합 질문의 자체 요청만 별도 생성한다. 나이 외 위키 사실은 같은 대상 본문에서 추가 질문을 뒷받침하는 발췌를 선택한다. 검증 계산과 충돌하는 서술은 거부하도록 검토 요청에 계산 결과를 전달한다. 추가 근거가 없으면 계산값은 유지하고 추가 정보만 확인 불가라고 밝힌다.
- 인물·생일·나이는 하드코딩하지 않았다. 다른 대상과 다른 생일의 회귀도 포함한다.

일반 검색은 제목·스니펫을 발견 후보로만 사용한다. 실제 조회한 제목·최종 URL·본문으로 근거를 새로 조립하고, 본문 관련성 검토를 통과한 원문 발췌만 최종 입력에 제공한다. 비교 질문은 각 전체 대상 이름으로 공식 문서 검색을 한 번씩 추가한다. 영상 푸터와 제품 비교를 담지 않은 홈페이지는 근거가 되지 않는다. 본문 확인은 공식 출처 인증과 구분하며, 확보 실패를 대상 부존재로 바꾸지 않는다. 일반 조회는 기본 두 페이지 + 비교 대상별 한 페이지(최대 네 페이지), 뉴스는 재검색 한 번·총 여섯 페이지 한도를 유지한다.

날씨 검토는 실제 자료 지역, 자료 대상 시각, observation/forecast/unknown을 구조화한다. 지역·시각은 본문에 존재하는 표현만 채택한다. 최종 답변은 해당 지역·자료 종류·대상 시각과 원문 발췌를 렌더링한다. 시간별 예보를 현재 부산 전체 관측값으로 재서술하지 않는다. 시각을 확인하지 못하면 확인 불가로 표시한다.

## 검증 상태

- 회귀는 `test/evidence-quality.test.js`, 실제 API schema/본문 전달 검사는 `test/chat-source-plan.test.js`에 있다. 무관한 세 기사 유형은 사용자 설명을 바탕으로 만든 **합성 본문**이며 원본 기사 전문이라고 주장하지 않는다. 실제 의미 판정 모델 검증과는 별개다.
- `npm test`: 280/280 통과 (`tmp/chat-evidence-full-tests.log`). `node --check src/index.js`, `node --check scripts/verify-chat-live.js`, `git diff --check`도 통과했다.
- 로컬 네 질문 실행은 키가 없어 `unverified`, 모델/HTTP 요청 0회, 종료 코드 2다. `tmp/chat-four-relevance-unverified.json`에 기록했다. 실제 답변 검증 합격이 아니다.
- 실제 검증 trace는 본문 검토 요청과 최종 요청의 `api-payload.contents`, `responseSchema`, 실제 `model-response.raw`, 검색 경로, 판정과 `final`을 함께 남긴다.
- 전체 실제 실행 제한은 기존과 같은 모델 요청 12회·fetch 36회·180초다. `completed-needs-review`는 자동 합격 표시가 아니다.

## ubuntu 콘솔에서 실제 네 질문 재실행

현재 작업본을 그대로 실행한다. 환경 파일을 작업 트리로 복사하거나 키를 출력하지 않는다. 이 명령은 배포하지 않는다.

```bash
(
  set -eu
  test "$(id -un)" = ubuntu
  cd /home/ubuntu/.local/share/agent-hebi/task-worktrees/discord-bot/5fa4e30c85594ea39537f639f91152a7
  sha256sum --check docs/chat-live-verification.sha256
  env -i PATH=/usr/bin:/bin NODE_ENV=production \
    DOTENV_CONFIG_PATH=/home/ubuntu/discord-bot-new/.env \
    timeout --signal=TERM --kill-after=5s 190s \
    /usr/bin/node scripts/verify-chat-live.js > tmp/chat-four-live-reviewed.log
)
```

`tmp/chat-four-live-reviewed.log`의 네 답변과 실제 본문을 함께 검토해야 한다. 무관한 뉴스가 0건인지, 제목/URL/본문이 같은 기사인지, 최종 요약이 실제 발췌와 일치하는지, 위키 부정 문장이 계산과 함께 나오지 않는지, 비교 링크가 실제 전체 모델 이름을 설명하는지, 용당동 예보라면 지역·시각·예보임이 밝혀지는지 확인한다. 관련 기사를 못 찾거나 모델 이름을 식별하지 못하면 확인 불가가 허용된다. 실제 결과를 검토하기 전에는 배포하지 않는다.
