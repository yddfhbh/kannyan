# 실제 로그 회귀 수정 및 ubuntu 검증

> 최신 후속 수정·네 질문 검증 명령·현재 상태는 [chat-live-remaining-fixes.md](chat-live-remaining-fixes.md)를 따른다. 아래는 이전 기록이다.

> 제품·모델 비교의 추가 조사와 최종 검증 상태는 [chat-product-comparison-regression.md](chat-product-comparison-regression.md)를 따른다. 기존 네 결함 수정은 보존했다. 아래 테스트 수는 당시 기록이다.

2026-10-15. 기반 HEAD는 `fb8ebbb23e22f6382afc5f67671191774c68725b`로 유지한다. 수정은 아직 미커밋 상태다. 기존 검증 스크립트의 요청 제한·비밀값 마스킹과 모의 테스트를 보존했다. 운영 설정·데이터·Discord transport·모델 목록은 변경하지 않았다.

## 수정과 근거

1. 검색 자료 전체에 적용하던 보안 검사가 줄바꿈을 공백으로 합친 뒤, 서로 다른 결과의 `공개`와 `시스템` 같은 단어를 하나의 공격으로 판정할 수 있었다. 실제 `selectGeminiContextSections`가 그 결과를 `contents`에 넣으므로 진단 표시만의 문제가 아니다. 독립 출처와 줄 단위로 범위를 좁히고, 인접 줄로 나뉜 공격 지시도 검사한다. 사용자 입력·대화 기록 검사는 유지한다. `assembledChars → sanitizedChars → selectedChars`와 실제 요청 함수에 전달되는 `api-payload.contents`를 기록한다. 문맥 예산을 줄일 때 본문 안 링크 때문에 본문 전체를 필수 헤더로 오인하지 않도록 수정했다.
2. 생일 항목의 콜론 필수 조건과 `content || raw` 선택을 제거했다. 원문·렌더링 자료를 각각 검사하고, 위키 굵게 표기·표 셀·HTML·공백 없는 프로필을 처리한다. `birthDateEvidence`에 날짜·항목명·근거 구절을 보존한다. 다른 인물 섹션과 그 하위 프로필, 각주·다른 사건·유효하지 않은 날짜·충돌 날짜를 배제한다. 정확한 문서 일치 확인과 서버 날짜 기반 만 나이 계산은 유지한다. 특정 인물이나 날짜는 운영 코드에 하드코딩하지 않았다.
3. 검색 계획 초안은 사용자에게 전달할 완성 답변으로 취급하지 않는다. 혼합 요청은 후속 호출 한 번이 전체 완성 답변을 작성한다. 근거 확보·인용 검증에 실패했거나 결정적으로 검증한 위키 답변이 있으면 독립된 자체 부분만 다시 생성해 결합한다. 초안의 검색 예고를 그대로 덧붙이지 않는다. 정상 숫자 인용의 URL 변환은 실패로 오인하지 않는다.
4. 뉴스 목록은 기사 발견 단계로만 사용한다. 기존 공개 URL/DNS/리다이렉트 차단을 유지한 페이지 조회로 개별 기사 여부, 제목, 게시일, 관련 본문, URL을 확인한다. 검색 한 번 재시도·페이지 최대 6개·기사 최대 3개로 제한한다. 최근 14일 범위만 사용하고 게시일과 확인 범위를 모델에 전달한다. 기사 확보 실패는 `no-verified-articles`로 구분하며 “검색 결과는 얻었지만 … 개별 기사를 확보하지 못했다”고 알린다. 연결 실패와 혼동하지 않는다. 뉴스 요청에 일반 위키 검색 결과만으로 근거가 있다고 판정하지 않는다.

`test/fixtures/chat-live-regressions.json`은 사용자가 전달한 로그 수치와 발췌를 축약한 회귀 사례다. 전체 원본 로그나 실시간 검색 결과를 재현했다고 주장하지 않는다. 제목·URL 일부는 합성 자료다. 모의 테스트는 실제 함수의 API payload를 가로채 제목·URL·본문·게시일 보존을 검증한다. 실제 모델 호출 결과와는 다르다.

## 검증 상태

- 전체 모의 테스트: 263개 통과. 로그는 `tmp/chat-fix-full-tests.log`.
- 이후 자연어 생일 문장·HTML 공백 호환성에 대한 위키 관련 44개를 다시 통과했다. 최종 HTTP body 직렬화까지 확인하는 payload 테스트 결과는 `tmp/chat-fix-payload-tests.log`에 기록한다.
- 기존 모의 검증: 키 없음(요청 0회), 모델 fallback 전체 12회 제한, 반사된 키 마스킹을 유지한다.
- `node --check`, `git diff --check` 확인.
- 실제 세 질문: 미실행. 운영 `.env`와 실행 프로세스 환경을 읽는 서버 콘솔 권한이 없어 운영 설정으로 직접 호출하지 못했다. 서버 콘솔은 `agent-hebi-ops`이며 ubuntu 권한으로 우회하지 않았다.
- 배포·재시작·Discord 테스트 메시지 전송: 실행하지 않았다.

## ubuntu 로그인 콘솔 명령

기존 인계 문서의 이전 검증 명령 대신 다음을 사용한다. SHA 검사는 기반 커밋을, manifest는 미커밋 수정 파일을 확인한다. 기존 스크립트 제한은 모델 HTTP 최대 12회, fetch 최대 36회, 전체 180초다. timeout은 종료 여유를 둔다. HTTP 내부 리다이렉트 연결 수와 fetch 호출 수는 다르다.

```bash
(
  set -eu
  test "$(id -un)" = ubuntu
  cd /home/ubuntu/.local/share/agent-hebi/task-worktrees/discord-bot/5fa4e30c85594ea39537f639f91152a7
  test "$(git rev-parse HEAD)" = fb8ebbb23e22f6382afc5f67671191774c68725b
  sha256sum --check docs/chat-live-verification.sha256
  /usr/bin/node scripts/check-chat-live-environment.js
  env -i HOME=/home/ubuntu PATH=/usr/bin:/bin \
    DOTENV_CONFIG_PATH=/home/ubuntu/discord-bot-new/.env \
    timeout --signal=TERM --kill-after=5s 190s \
    /usr/bin/node scripts/verify-chat-live.js
)
```

사전 검사는 ubuntu의 작업 트리·의존성 접근과 운영 PM2 앱의 cwd/entry/.env 경로, 시작 환경의 우선 적용 값을 확인한다. 값과 환경변수 이름은 출력하지 않는다. `.env`가 프로세스 시작 후 변경됐거나 별도 dotenv/Node 로딩 옵션, 다른 환경 파일 또는 불일치가 있으면 중단한다. `/proc/environ`으로 dotenv가 실행 중 메모리에 넣은 값을 직접 확인할 수는 없으므로 사전 검사 통과를 운영 프로세스의 모든 현재 설정값 검증이라고 해석하지 않는다.

출력에서 세 질문의 `final`, `api-payload`, `citation-validation`, 뉴스의 `newsVerification`, 위키의 `birthDateEvidence`를 확인한다. 날씨의 시점·지역·출처, 뉴스의 실제 기사/게시일/본문과 요약 일치, 위키의 정확한 문서·생일·현재 날짜 기준 나이를 검토한다. `completed-needs-review`와 종료 코드 0은 정확성 합격이 아니다. 기사 확보 실패는 정직한 제한 응답으로 볼 수 있지만 최신 뉴스 요약을 검증한 결과는 아니다.

## 실제 답변 확인 이후 배포

검증 결과를 검토한 뒤 기존 승인된 `server_privileged_operation({operation:"discord_bot_deploy",args:{}})` 경로로 이어간다. **현재 수정은 미커밋이므로 지금 도우미를 실행해도 이 수정이 배포되지 않는다.** 수정 커밋이 origin/main에 포함됐는지 확인하고 검증한 코드와 배포 후보가 일치한 상태에서 진행해야 한다. 도우미의 대상은 `/home/ubuntu/discord-bot-new`, branch는 `main`이며 임의 SHA를 지정할 수 없다. 이전 기반 SHA `fb8ebbb`를 최종 수정 배포 SHA로 요구해서는 안 된다.

배포 후 도우미 반환의 `afterHead`와 수정 커밋, `validation`, `pm2Status`를 확인하고 `curl --max-time 5 -fsS http://127.0.0.1:8080/health`로 `ok`와 `discordReady`를 확인한다. 실제 검증이 끝나기 전에 배포하지 않는다.
