# 최신 실제 로그의 후속 수정 및 Ubuntu 실행

2026-10-15. 기존 미커밋 변경과 관리 브랜치를 보존했다. 이 문서가 이전 검증 인계 문서의 최신 후속 상태다. commit, push, 배포, PM2 재시작은 실행하지 않았다.

## 확인한 원인과 수정

`tmp/chat-four-live-reviewed.log`를 직접 확인했다. 혼합 질문의 계획 응답은 `answer`와 `localPrompt`가 비어 있었다. 이 값을 자체 요청이 없다는 확정 판정으로 사용한 조기 종료가 자기소개까지 제거했다. 이제 근거 부족 분기에서도 **원래 요청**과 설정·대화·답장·제공 자료를 전달해 `localOnly`로 답할 수 있는 부분을 생성한 뒤 외부 확인 상태를 함께 출력한다. 외부 근거가 있는 일반 완료에도 원래 전체 요청을 사용한다. 검증된 날씨·위키·뉴스의 자체 부분도 계획이 비어 있으면 원래 요청에서 복구한다. 특정 자기소개 문장 정규식이나 고정 자기소개를 추가하지 않았다. 인용 거부 시에도 자체 답변을 별도로 복구한다. 위키 생일·정확한 대상·기준일·계산 나이의 직접 출력은 유지했다.

원래 혼합 질문 전체가 재검색 `subject`가 된 원인은 `preserveOriginalSearchQuery`가 짧고 독립적인 요청이면 계획 검색어를 원래 질문으로 무조건 되돌렸기 때문이다. 현재 질문의 용어와 일치하는 초점 검색어는 유지한다. 이전 주제 용어가 다수 섞인 계획은 배제하며, 전체 제품명·접미사가 중요한 비교 요청은 기존 보존 처리를 유지한다. 실제 handler → 검색 함수 → 재검색 경로에서 `부산 날씨`와 `부산 날씨 official`을 사용하고, 자체 답변 생성에는 원래 혼합 요청을 쓰는 회귀를 추가했다.

날씨 본문은 `page.text.length < 120` 또는 `bodyQuality=insufficient`이면 의미 검토 전에 버려졌다. 이제 비어 있지 않은 본문은 자료 유형 검토를 거친다. 산문 발췌는 기존 40자 기준을 유지하고 날씨·표·구조화 자료에는 해당 산문 기준을 강제하지 않는다. 날씨는 `dataType`, 원문에 있는 `weatherFields`, 실제 지역, 자료 대상 시각, 관측/예보/unknown을 검토한다. 페이지 제목과 `time[datetime]` 등 추출 메타데이터도 지역·시각의 출처로 보존한다. 발췌·필드는 본문에, 지역·시각은 실제 제목/메타데이터/본문에 존재해야 한다. 최종 출력은 실제 지역·종류·시각을 표시하며, 지역·시각·종류가 불완전하면 현재 날씨로 확인할 수 없다고 표시한다. 오래된 자료나 예보를 현재 시 전체의 관측값으로 바꾸지 않는다. 조회 시각을 자료 시각으로 채우지 않는다. 기사에 필요한 게시일·본문·관련성 검사는 완화하지 않았다.

뉴스는 검증된 발췌를 요약 생성 입력으로 사용하고 한국어 1~2문장의 요약을 생성한다. 이어서 요약의 모든 사실이 원문에서 뒷받침되는지 검토한다. 원문 전체 복사·인용 거부·원문에 없는 주장은 요약으로 출력하지 않는다. 실패하면 요약 검증 실패를 표시하며 발췌 복사로 대신하지 않는다. 제목·게시일·URL·1건뿐이라는 범위는 계속 앱에서 출력한다. 무관한 기사 배제와 문서 식별 검사는 유지했다.

## 실제 실패와 예산 구분

기존 로그의 질문별 누적 HTTP 요청은 9 → 22 → 24 → 36회였다. 모델은 1 → 3 → 4 → 5회였다. 마지막 비교에는 API payload 2건 중 응답 1건과 `model-error: Error` 1건이 있다. 비교 계획까지 모델 5회가 실제 요청됐고 본문 검토 요청은 모델 요청 수를 늘리지 못했다. **당시 fetch 래퍼는 HTTP 36회가 되면 모델 요청 카운트를 늘리기 전에 일반 Error를 던졌으므로, 기록과 해당 코드 경로는 마지막 검토 요청의 HTTP 예산 차단에 부합한다.** 이전 로그에는 상세 오류 코드가 없어 API 제공자 응답이나 네트워크 오류라고 확정할 수 없다. 이 결과를 정상 조회 후 근거 부족이나 비교 합격으로 처리하지 않는다.

새 실행은 다음을 구분한다.

- `request-limit`: `VERIFY_QUESTION_HTTP_LIMIT`, `VERIFY_QUESTION_MODEL_LIMIT`, `VERIFY_TOTAL_HTTP_LIMIT`, `VERIFY_TOTAL_MODEL_LIMIT`.
- `time-limit`: `VERIFY_QUESTION_TIME_LIMIT`, `VERIFY_TOTAL_TIME_LIMIT`. 개별 네트워크 중단은 `timeout`으로 별도 분류한다.
- `network`: 허용한 `ENOTFOUND`, `ECONNRESET` 등 코드만 기록한다.
- `api`: 숫자 HTTP status만 기록한다. 오류 본문·헤더·키·임의 오류 메시지는 출력하지 않는다.
- `validator`: 분류 불명 오류나 형식 검증 실패다. 원시 Error만 보고 API/네트워크로 추측하지 않는다.

본문 검토의 예외·형식 오류는 `review-failed`, 본문 연결 실패는 `retrieval-failed`로 기록한다. 근거와 무관하다는 정상 판정은 `insufficient-evidence`와 구분한다. 생성 실패는 handler가 오류 답변을 출력해도 검증 `status=failed`, 종료 코드 1이다. 정상 생성은 `completed-needs-review`이며 자동 합격이 아니다.

기본 네 질문은 각각 **HTTP 9회, 모델 5회, 40초**다. 질문별 카운터·실패 상태는 새로 시작한다. 전체는 **HTTP 36회, 모델 20회, 180초**다. HTTP·전체 시간 상한은 기존과 같다. 모델 상한은 단순히 실패를 피하려고 늘린 것이 아니라, 기사 1건의 계획·관련성 검토·요약·요약의 원문 대조·누락된 자체 답변 복구라는 5단계를 질문별로 배정한 것이다. 모델 fallback도 모두 이 한도에 포함한다. 2~3건 요약이나 많은 fallback이 필요하면 해당 질문은 명시적으로 예산 실패할 수 있다. 한 질문이 다른 질문의 HTTP 할당을 사용하지 않는다.

`--model-comparison-only`는 보고된 비교 **한 질문만** 실행하므로 다른 질문의 호출이 없다. 동일한 전체 HTTP 36회 안에서 그 질문에 HTTP 36회·모델 5회·40초를 배정한다. 전체 HTTP 상한을 높이지 않는다. `--product-comparisons`는 기존 추가 5개 질문 옵션이며 각 HTTP 할당은 floor(36/5)=7회다. 질문 시간 초과는 실행 중 요청을 취소하고 남은 질문을 `not-run`으로 기록한 뒤 종료한다. 제한 우회를 막기 위해 종료된 작업을 백그라운드로 계속 실행하지 않는다.

## 검증 상태

- 전체 `npm test`: 292/292 통과 (`tmp/chat-followup-all-tests.log`). 구문 검사와 `git diff --check`도 통과했다.
- 회귀에는 빈 자체 계획 뒤의 자기소개·대화 조건·제공문 번역 보존, 초점 재검색 subject, 짧은 날씨/표, 제목 지역·메타데이터 시각, 누락/조작된 날씨 메타데이터, 뉴스의 지원되는 요약과 원문 복사/추가 주장 거부, 기존 위키 나이, 질문/전체 예산과 오류 구분을 포함한다.
- 실제 API/검색 의미 판정은 아직 재검증하지 않았다. 로컬 비교 단독 진입은 API 키가 없어 `unverified`, 종료 코드 2, 요청 0회였다 (`tmp/chat-comparison-followup-unverified.json`). 모의 회귀 성공을 실제 답변 검증 성공으로 보고하지 않는다.
- 실제 로그의 최종 답변·근거·오류·예산을 검토하기 전에는 배포하지 않는다.

## Ubuntu 로그인 콘솔 명령

실제 환경 파일을 작업 트리에 복사하거나 출력하지 않는다. 다음 명령은 작업 트리 코드를 실행하며 배포하지 않는다. 실패 종료 코드를 감추지 않으므로 한도가 소진되면 로그를 확인한다. 기존 실제 로그를 보존하도록 새 출력 파일명을 사용한다.

네 질문 실행:

```bash
(
  set -eu
  test "$(id -un)" = ubuntu
  cd /home/ubuntu/.local/share/agent-hebi/task-worktrees/discord-bot/5fa4e30c85594ea39537f639f91152a7
  sha256sum --check docs/chat-live-verification.sha256
  env -i PATH=/usr/bin:/bin NODE_ENV=production \
    DOTENV_CONFIG_PATH=/home/ubuntu/discord-bot-new/.env \
    timeout --signal=TERM --kill-after=5s 190s \
    /usr/bin/node scripts/verify-chat-live.js > tmp/chat-four-followup-live.log
)
```

모델 비교만 별도로 실행:

```bash
(
  set -eu
  test "$(id -un)" = ubuntu
  cd /home/ubuntu/.local/share/agent-hebi/task-worktrees/discord-bot/5fa4e30c85594ea39537f639f91152a7
  sha256sum --check docs/chat-live-verification.sha256
  env -i PATH=/usr/bin:/bin NODE_ENV=production \
    DOTENV_CONFIG_PATH=/home/ubuntu/discord-bot-new/.env \
    timeout --signal=TERM --kill-after=5s 190s \
    /usr/bin/node scripts/verify-chat-live.js --model-comparison-only \
    > tmp/chat-comparison-followup-live.log
)
```

로그에서 `questionCounts`와 누적 `counts`, `failures`, `generation-failed`, `model-error`, `http-error`, `bodyVerification`, `newsVerification`, 최종 `final`을 함께 확인한다. 날씨의 자료 시각이 서버 기준일과 맞는지, 동 단위 관측/예보의 범위가 유지되는지 확인한다. 뉴스가 발췌 복사가 아닌 실제 원문 지원 요약인지, 위키 계산 나이가 유지되는지, 비교의 전체 이름이 보존되는지 검토한다. `failed`·`not-run`·`unverified` 또는 확인 불가 문장이 있다는 사실만으로 검증 합격으로 처리하지 않는다.
