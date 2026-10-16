## 현재 후보 처리 수정 (2026-10-16)

상태: **회귀 검증 통과, 사용자 제공 실제 로그에서 첫 조회 항공시간 응답 성공 확인, 최종 검토·배포 진행**. 아래 이전 기록은 과거 결과다. 이번 점검 시작 시 현재 관리 브랜치 `agent-hebi/task/discord-bot-5fa4e30c85594ea39537f639f91152a7`의 HEAD, 로컬 `origin/main`, GitHub 읽기 전용 조회 결과는 모두 `16dc2f7a60d90e105b7d3d546dedd88a9c008b3e`였고 미커밋 변경은 없었다. 운영 HEAD 읽기는 서버 콘솔에서 Permission denied로 실패했다. 이전 배포 결과를 현재 운영 SHA로 간주하지 않는다. PM2 조회는 online이었다. Workstation 기준점·브랜치 변경, Push, 배포, 슬래시 등록은 실행하지 않았다.

현재 코드에서 첫 후보 거절 자체는 다음 후보 평가를 막지 않았다. 재현된 결함은 최초 검증 때만 후보 큐를 만들고, **후속 조회에서 반환된 새 후보는 큐에 추가하거나 기록하지 않는 것**이었다. 또한 모델이 정식명만 별칭으로 반환하면 같은 인용에 명시된 코드가 정체성 그룹에 연결되지 않았다. 이 재현은 제공된 실제 로그의 정확한 내부 원인을 확정하는 것은 아니다.

- 매 조회의 후보를 평가·기록·정렬한다. `refinements`는 원본 후보 값, round, origin, index, accepted, reason, status 및 executionReason을 보존한다. 중복, 형식 오류, 미검증 대상, 역방향, 후보 수 제한을 구별한다. 수락한 뒤 예산·답변 확보 등으로 실행하지 않은 이유도 기록한다. 파서는 후보 배열을 정제 없이 전달하며 실제 생성기·스키마·파서 회귀에서도 첫 중복과 두 번째 후보 보존을 확인했다.
- `relevant=false`는 답변 근거 판정이다. 별칭 근거는 별도 인용으로 검사한다. 실제 제공 자료에 정확한 인용이 있어야 하며 양쪽 이름이 포함되어야 한다. `이름 or 약어 (IATA: 코드, ICAO: 코드)`처럼 인용에 명시된 대응은 코드별 구조로 연결한다. 특정 공항·노선 사전은 없다. `aliases`, `aliasReviews`, `identityGroups`에서 인용, 출처, 자료 종류, 수락·거절 근거를 추적한다. 임의 코드·도시를 생성하지 않는다.
- 검증된 별칭과 원래 요청 속성을 함께 사용하는 후보를 단순 official 추가보다 먼저 실행한다. 코드 후보가 모델 응답에서 빠져도 인용에 명시된 코드와 원래 속성으로 후보를 만든다. 기존 조회·모델·시간 예산은 유지한다.
- 방향 요청의 유효 purpose는 원래 질문을 사용한다. 모델의 추측 purpose는 `identityTrace.proposedPurpose`에만 남겨 원문 대상과 조회에서 확인한 `identityGroups`를 구별한다.

검증: 전체 **317개 통과**, `tmp/chat-flight-candidate-full-tests.log`. 최종 검토에서도 전체 **317개 통과**(`tmp/chat-flight-final-tests.log`); 기본 샌드박스의 하위 프로세스 테스트 실패 후 승인된 권한 확장 실행에서 통과했다. 구문 검사, `git diff --check`, 검증 파일 해시 검사도 통과했다. 중복 첫 후보+유효한 두 번째 후보를 최초·후속 검증 모두에서 확인했다. 항공시간이 없는 본문의 별칭 사용, 모델이 정식명만 반환한 인용에서 코드 연결, 허위 인용 거절, 역방향 거절, 예산 및 답변 확보 후 미실행 사유를 합성 자료로 검증했다. 실제 노선의 항공시간 근거가 아니다.

### 현재 수정본 실제 검증 명령

운영 설정을 읽을 수 있는 ubuntu SSH 콘솔에서 실행한다. 아래 작업 경로의 **미커밋 수정본**을 검사하며 운영 코드를 바꾸지 않는다. 기존 baseCommit/옛 HEAD 일치 검사를 사용하지 않는다. preflight가 실패하면 중단하고 권한을 우회하지 않는다. 파일 해시는 이번 수정본으로 갱신했다.

```bash
(
  set -euo pipefail
  cd /home/ubuntu/.local/share/agent-hebi/task-worktrees/discord-bot/5fa4e30c85594ea39537f639f91152a7
  git status --short
  git branch --show-current
  git rev-parse HEAD
  sha256sum --check docs/chat-live-verification.sha256
  /usr/bin/node scripts/check-chat-live-environment.js
  env -i PATH=/usr/bin:/bin \
    DOTENV_CONFIG_PATH=/home/ubuntu/discord-bot-new/.env \
    timeout --signal=TERM --kill-after=5s 190s \
    /usr/bin/node scripts/verify-chat-live.js --flight-time-only \
    | tee "tmp/chat-flight-candidate-live-$(date +%Y%m%d-%H%M%S).json"
)
```

이번 수정본의 실제 실행은 사용자가 제공한 로그와 검토 결과로 확인했다. 최종 답변의 직항 **3시간 35분~4시간**이 전달된 근거 문장과 일치하고 `failures`는 비어 있다. **첫 조회에서 근거를 확보한 성공**이며, 후속 후보 큐 경로의 실제 실행 성공을 입증하는 사례는 아니다. 후속 후보 큐는 위 합성 회귀 테스트로만 검증했으며 실검증은 미확인이다. 이번 최종 검토에서 실제 모델 조회를 다시 실행하지 않았고, 다른 실제 사례의 통과로 확대하지 않는다. `completed-needs-review`는 실행 완료 표시이며 정확성 합격이 아니다. API 키가 없으면 `unverified`·요청 0회·종료 코드 2다. 항공시간을 답하지 못한 결과는 해결 완료로 처리하지 않는다.

---

# NAIA → PUS 비행시간 실패 사례

## 후속 수정: 자료 선별과 재검색 (2026-10-15)

상태: **코드 수정·회귀 검증 완료, 실제 답변 미확보**. 사용자가 제공한 실검증 요약에서 공항 해석은 정상이었지만 무관한 자료 선택 뒤 재검색 없이 종료했다. 이 후속 수정은 실제 비행시간 확인이나 배포 완료를 뜻하지 않는다. 아래 이전 실행 기록의 API 키 없음 결과와 사용자가 이후 확인한 실제 실행을 구별한다.

원인은 `!bodies.length && !candidates.some(c => c.snippet?.trim())` 조건이었다. 본문이나 스니펫의 존재만 보고 재검색을 막고, 실제 관련성 검증은 그 뒤에 수행했다. 따라서 본문 검증이 모두 거부돼도 재검색 경로로 돌아가지 않았다. HTTP 전체 한도 소진과 다른 문제다.

- `rankWebCandidates`가 본문 조회 전에 제목·URL·스니펫에서 대상과 요청 속성을 점수화한다. 양쪽 대상과 속성이 맞는 자료를 먼저 읽고, 명시적으로 다른 방향의 노선과 양쪽 대상이 모두 없는 후보는 본문 조회에서 제외한다. 본문 길이나 추출 성공 여부는 선정 점수가 아니다. 검색 스니펫은 별도 자료로 의미 검증하며 무관한 노선을 답변 근거로 승인하지 않는다.
- 자료 검증 응답의 `searchRefinement`는 요청 속성 충족 여부, 자료 인용으로 뒷받침하는 별칭 대응, 최대 2개 보완 검색어를 전달한다. 별칭은 실제 제공 자료에 인용문이 있고 양쪽 표기가 포함되는지 확인한 뒤 연결한다. 원래 대상에서 이어지는 다단계 별칭·정식명·도시명·코드를 사용할 수 있다. 재검색어의 양쪽 대상과 순서를 검사하며 임의 도시나 역방향 검색어는 거부한다. 운영 코드에 특정 공항이나 노선 대응표를 추가하지 않았다.
- 첫 검증에서 자료가 거부되거나 식별만 확인해 요청 속성이 부족하면 재검색한다. 비교 요청의 대상별 조회는 유지한다. 최대 재검색 2회·본문 4개·수집 25초 안에서 수행하며 실검증의 기존 모델 6회·HTTP 36회 상한은 늘리지 않는다. 실검증 예산을 조회하고 최종 답변 생성·검증에 필요한 모델 요청을 남긴다.
- `bodyVerification.selections`는 조회 전 순위·선별 이유, `aliases`는 별칭 대응 인용·URL·자료 종류, `refinements`는 보완 검색어 허용/거부, `searches`는 실제 재검색과 제공자 시도, `decisions`는 조건·실행/중단·남은 예산을 담는다. `stopReason`에서 정보 확보, 안전한 보완 검색어 없음, 로컬 검색/시간 예산 소진, 최종 답변용 외부 예산 확보를 구별한다. 로컬 수집 예산과 실검증 전체 남은 예산은 별도 필드다.
- 비행시간만 요청했으면 직항 운항 여부·경유 총시간을 필수 조건으로 추가하지 않는다. 확인한 시간의 조건과 자료 종류를 밝히며, 미확인 수치와 운항 사실은 계속 금지한다. 검색 실패 안내에 존재 부정 관련 문장을 일괄 덧붙이던 동작을 제거했다.

검증: 전체 **304개 통과**, `tmp/chat-flight-followup-full-tests.log`. `git diff --check` 및 변경한 JavaScript 구문 검사 통과. 공항 별칭·노선 자료는 합성 회귀 자료이며 실제 비행시간 근거가 아니다. 초기 전체 실행은 샌드박스의 하위 프로세스 `git` 조회가 `EPERM`으로 막혔고, 승인된 권한 확장 후 전체 테스트가 통과했다.

API 키가 설정된 현재 저장소 콘솔에서 이번 질문만 검증한다. 이번 후속 수정에서는 아래 실검증을 실행하지 않았다. 기존 `tmp/chat-flight-live-unverified.json`을 새 결과로 오인하지 않는다.

```bash
set -o pipefail
sha256sum --check docs/chat-live-verification.sha256
node scripts/verify-chat-live.js --flight-time-only | tee tmp/chat-flight-time-retry-live.json
```

API 키가 없으면 요청 0회·`unverified`·종료 코드 2가 정상이다. `completed-needs-review`는 실행 완료일 뿐 실제 답변의 정확성 합격이 아니다. 새 로그에서 원래 공항 해석, 별칭 대응의 자료 인용, 방향을 보존한 재검색, 조건을 밝힌 실제 비행시간 답변을 확인하기 전까지 이 사례는 해결 완료로 처리하지 않는다.

## 이전 수정과 실행 기록


기존 미커밋 변경을 보존한 후속 수정이다. 기반 HEAD는 `fb8ebbb23e22f6382afc5f67671191774c68725b`이며 이 수정은 배포되지 않았다. 운영 SHA를 작업본 HEAD로 간주하지 않는다. 현재 작업 환경은 운영 경로 접근을 요청 범위에서 제외했으므로 운영 SHA를 직접 확인하지 않았다.

## 확인한 원인과 수정

- 검색어 보존 검사는 과반수 단어 중복만 요구해 출발지가 바뀌어도 통과할 수 있었다. 방향 관계의 양쪽 대상 구절과 명시적 대문자 약어를 보존하고, 원문·계획 검색어·실제 검색어·계획 외부 질문·보정 외부 질문을 `source-plan.intent.identityTrace`에 기록한다. 공항 사전이나 특정 공항명 치환은 사용하지 않는다. 별칭·공항명·코드 대응은 조회 자료로 확인하도록 계획과 자료 검증, 최종 답변 지침을 연결했다. 이 문서는 실제 공항 대응이나 비행시간을 확인한 자료가 아니다.
- 비행시간, 직항 여부, 경유 포함 총 소요시간을 분리한다. 조회 전 초안은 전달하지 않는다. 대상이 명시된 외부 요청에 독립된 자체 요청이 없으면 실패 후 원래 외부 질문을 자체 답변으로 재생성하지 않는다. 이 보호는 일반 방향 관계와 약어 식별에 적용한다. 기존 혼합 질문의 자체 설정·번역·기억 복구는 유지한다.
- 검색 결과는 얻었지만 자체 관련성 검증에서 거부한 경우는 `insufficient-evidence`, 검증 응답 오류는 `review-failed`, 내용 추출 불가는 `extraction-failed`이다. 검색의 `empty`·`blocked`·`timeout`·`parse-error`와 페이지 조회 실패를 따로 기록한다. `retrievalStatus`, `attempts`, `bodyVerification.reads/searches/reviews`에 최초 조회 상태와 후속 원인을 보존한다. 각 리뷰의 `reason`은 모델 판정 사유다.
- 일반 웹 근거의 스니펫 일괄 배제와 산문 40자 하한을 제거했다. 스니펫·본문은 별도 ID로 검증하고 출처 URL·자료 종류·원문 인용을 보존한다. 길이나 공식 여부만으로 거부하지 않으며 대상·속성·시점·필요 정확도를 평가한다. 스니펫을 본문 확인·현재 운항 확인으로 격상하지 않는다. 뉴스의 게시일·개별 기사 검증 정책은 유지한다. 승인된 발췌 옆에 검증하지 않은 스니펫을 다시 넣지 않는다.
- 다른 자료의 검증 오류가 있어도 유효한 부분은 `partial-success`로 전달한다. 최종 일반 웹 답변은 URL뿐 아니라 모든 외부 주장에 대해 추가 의미 검증을 받는다. 검증에 실패하면 미확인 수치를 제거하고 이미 검증한 자료 종류·발췌·출처와 확인 한계를 제시한다. `answer-verification` 이벤트에 리뷰 사유가 남는다.

## 실행 결과와 한계

`node scripts/verify-chat-live.js --flight-time-only`는 실제 운영 handler·계획·검색·생성 함수를 사용하고 Discord 로그인·운영 기억 저장은 하지 않는다. 고정 공개 질문 하나만 실행하며 다른 네 질문을 반복하지 않는다. 모델 HTTP 최대 6회, 전체 fetch 최대 36회, 질문 90초, 전체 180초 제한과 기존 비밀값 마스킹을 유지한다.

이 작업 환경에서 실행한 결과는 **API 키 없음, 요청 0회, `unverified`, 종료 코드 2**다. 기록은 `tmp/chat-flight-live-unverified.json`이다. 실제 모델이 NAIA를 어떤 공항으로 식별했는지, 실제 검색 상태·탈락 이유·최종 답변은 아직 확보하지 못했다. 모의 회귀 자료의 공항·시간은 합성 데이터이며 실제 사실 확인이 아니다. `completed-needs-review`나 종료 코드 0도 의미적 정확성 합격 판정은 아니다.

검증: 전체 테스트 298개 통과(`tmp/chat-flight-full-tests.log`). 이후 최종 답변 검증의 거부/오류 상태 구분을 보완하고 해당 회귀 테스트 5개를 다시 통과했다(`tmp/chat-flight-focused-tests.log`). `node --check`와 `git diff --check`도 통과했다.

## ubuntu 콘솔에서 이번 질문만 실행

아래 명령은 ubuntu가 운영 설정을 읽을 수 있는 콘솔용이다. 운영 디스크 SHA·dirty 상태·PM2가 보고한 revision을 작업본 SHA 및 코드 내용 해시와 구분한다. PM2 revision과 디스크 HEAD만으로 실행 중 메모리에 로드된 모든 코드가 같다고 확정할 수 없어 `runningRevisionVerified:false`를 명시한다. 운영 디스크가 dirty이거나 SHA가 다르면 확인 전 운영 코드 일치로 해석하지 않는다. 사전 검사는 기존 운영 경로·환경 파일·시작 환경 우선순위 검사를 그대로 수행한다.

```bash
(
  set -euo pipefail
  test "$(id -un)" = ubuntu
  cd /home/ubuntu/.local/share/agent-hebi/task-worktrees/discord-bot/5fa4e30c85594ea39537f639f91152a7
  sha256sum --check docs/chat-live-verification.sha256
  /usr/bin/node scripts/check-chat-live-environment.js
  env -i HOME=/home/ubuntu PATH=/usr/bin:/bin \
    DOTENV_CONFIG_PATH=/home/ubuntu/discord-bot-new/.env \
    timeout --signal=TERM --kill-after=5s 190s \
    /usr/bin/node scripts/verify-chat-live.js --flight-time-only \
    | tee tmp/chat-flight-live.json
)
```

실행 후 순서대로 확인한다.

1. `worktreeIdentity.head/dirty/codeSha256`와 사전 검사 운영 식별값을 구분한다.
2. `question` → `source-plan.intent.identityTrace`: 원래 양쪽 대상이 계획과 실제 검색어에서 보존되는지 확인한다. 약어를 다른 도시로 바꿨으면 보정됐는지 확인한다.
3. `tryBuildWebSearchData.query/attempts/bodyVerification`: 제공자별 검색어·HTTP 상태·검색 상태, 실제 페이지 URL·본문·스니펫 종류, 검증 인용·거부 사유를 확인한다. 최초 검색 성공을 후속 검증 실패와 혼동하지 않는다.
4. `api-payload`, `model-response`, `answer-verification`, `citation-validation`, `evidence-decision`, `final`: 별칭·코드 대응의 출처, 요청한 시간 종류, 조건·날짜, 확인하지 못한 항목을 확인한다. 검증 실패 뒤 원문 발췌로 제한했다면 모델이 만든 미확인 수치가 제거됐는지 확인한다.
5. 원래 `naia`와 `pus`를 익숙한 다른 장소로 임의 치환하거나, 검색 차단과 자체 거부를 혼동하거나, 자료에 없는 직항·시간을 추가했다면 통과로 간주하지 않는다.

이 명령은 수정 배포나 PM2 재시작을 수행하지 않는다.
