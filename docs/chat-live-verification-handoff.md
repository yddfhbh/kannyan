# fb8ebbb 검증 및 배포 인계

> 최신 후속 수정·네 질문 검증 명령·현재 상태는 [chat-live-remaining-fixes.md](chat-live-remaining-fixes.md)를 따른다. 아래는 이전 기록이다.

> 후속 로그 회귀 수정의 현재 상태와 콘솔 명령은 [chat-live-regression-fixes.md](chat-live-regression-fixes.md)를 따른다. 아래는 수정 전 인계 기록이며, 운영 코드 변경 여부·테스트 수·검증 명령은 현재 상태와 다를 수 있다.

2026-10-15 확인. 작업 시작 시 HEAD는 `fb8ebbb23e22f6382afc5f67671191774c68725b`, 작업 트리는 clean이었다. 이번 변경은 검증 스크립트와 테스트, 이 문서뿐이다. 운영 코드·설정·기억·데이터는 변경하지 않았다.

## 승인된 배포 경로

`server_privileged_diagnostics`에서 broker/module/runner 준비 완료, 설치 파일의 canonical hash 일치를 확인했다. 서버의 `/usr/local/libexec/agent-hebi-privileged-broker`와 `/usr/local/libexec/agent-hebi-discord-bot-deploy.js`를 읽어 허용 범위를 확인했다.

정확한 도구 호출은 `server_privileged_operation({operation:"discord_bot_deploy",args:{}})`다. 인자는 하나도 허용하지 않으며 임의 명령, 환경변수, 검증 스크립트, SHA 지정 옵션은 없다. runner는 별도 실행 기능이 없는 설치 artifact다.

고정 대상은 `/home/ubuntu/discord-bot-new`, origin은 `https://github.com/yddfhbh/kannyan.git`, branch는 `main`, 실행 사용자는 `ubuntu`, PM2 앱은 `discord-bot`이다. tracked 변경이 있으면 중단하고, origin/main fetch → 별도 후보 npm ci/npm test → fast-forward → 검증한 node_modules 활성화 → PM2 restart → HEAD/PM2 확인 순서로 동작한다. untracked/.env/data는 보존한다. health 검사는 도우미에 없으므로 별도 확인해야 한다. health/재시작 실패에 대한 자동 코드 rollback은 없다. 실행 시점의 origin/main을 배포하므로 fb8ebbb 고정 배포로 간주하면 안 된다.

## 스크립트 검토와 결과

`scripts/lib/chat-verification-runtime.js`는 src/index.js에서 실제 함수 선언을 추출한다. Discord 로그인과 transport, 사용자/영구 기억 로딩·저장·검색은 격리한 메모리 구현으로 대체한다. 실제 생성 함수, 모델/키 fallback, 웹 검색·본문, 공개 문서 필터를 적용한 Meilisearch 검색, 문맥 배분, 인용 검증을 실행한다. 운영의 사용자별 기억/Discord 문맥까지 재현하는 검증은 아니다.

원래 스크립트에는 전체 호출·시간 제한과 일괄 비밀값 마스킹이 없었다. 이번 수정으로 모델 HTTP 요청 최대 12회, fetch 호출 최대 36회, 전체 실행 180초를 적용했다. HTTP 리다이렉트 내부 연결은 fetch 호출 수와 별개다. 한도에 도달하면 추가 fetch를 차단하고 실패로 종료한다. 출력은 환경변수 이름이 key/token/secret/password/credential인 값과 쉼표로 나뉜 키, URL 인코딩 표현을 마스킹한다. 설정 전체, 요청 URL/헤더, 오류 응답 본문을 출력하지 않는다. 고정 공개 질문의 답변·근거는 진단 출력에 포함된다.

`completed-needs-review`는 최종 텍스트를 얻었다는 뜻이며 답변 정확성의 자동 합격 판정이 아니다. 조회 실패/잘못된 근거/인용 거부/날짜를 사람이 함께 확인해야 한다.

- 키 없는 실행: `unverified`, 종료 코드 2, 요청 0회.
- 모의 테스트 3개 통과: 키 없음, fallback 전체 12회 제한, 모델 답변에 키가 반사됐을 때 마스킹. 실제 모델·검색 검증 결과는 아니다.
- 구문 검사, git diff --check 통과.
- 운영 PM2 조회: id 5, online, PID 2355891, restarts 19.
- 운영 health: `{"ok":true,"discordReady":true}`.
- 운영 SHA: 미확인. PM2/health는 기존 프로세스의 상태다.
- 실제 세 질문: 미검증. 배포/재시작: 실행하지 않음.

정확히 막힌 단계는 **운영 .env를 사용해 검토된 검증 스크립트를 ubuntu로 실행하는 단계**다. 승인된 배포 도우미에 이 기능이 없으므로 우회하거나 권한을 변경하지 않았다. 실제 검증 후 이상이 없을 때 배포하라는 조건에 따라 배포를 보류했다.

## ubuntu 서버 콘솔 실행

아래는 ubuntu 로그인 콘솔용이다. 배포 모듈의 실제 운영 경로와 `src/index.js`의 `import 'dotenv/config'`를 근거로 운영 `.env`를 직접 로드한다. 키를 복사하거나 셸 source로 평가하지 않는다. 검증 코드는 현재 작업 트리에서 실행하므로 운영 앱에 파일을 설치할 필요가 없다. 이 작업 트리를 보존한 상태에서 실행한다.

```bash
(
  set -eu
  test "$(id -un)" = ubuntu
  git -C /home/ubuntu/discord-bot-new rev-parse HEAD
  git -C /home/ubuntu/discord-bot-new status --short
  cd /home/ubuntu/.local/share/agent-hebi/task-worktrees/discord-bot/5fa4e30c85594ea39537f639f91152a7
  test "$(git rev-parse HEAD)" = fb8ebbb23e22f6382afc5f67671191774c68725b
  test -r /home/ubuntu/discord-bot-new/.env
  env -i HOME=/home/ubuntu PATH=/usr/bin:/bin NODE_ENV=production \
    DOTENV_CONFIG_PATH=/home/ubuntu/discord-bot-new/.env \
    timeout --signal=TERM --kill-after=5s 190s /usr/bin/node scripts/verify-chat-live.js
)
```

세 질문의 `trace`와 `final`을 확인한다: 「너 누구고 오늘 부산 날씨는 어때?」「최신 AI 뉴스 검색해서 요약해줘」「푝무위키 파이호크 나이」. 하나라도 미확인이면 검증 성공으로 보고하지 않는다.

실행 후 종료 코드 0만으로 배포하지 말고 세 답변과 조회 상태·출처·현재 날짜·위키의 정확한 문서를 검토한다. 이상이 없으면 위 전용 도구 호출로 배포하고, 반환된 beforeHead/afterHead/originMain과 validation/pm2Status를 기록한다. afterHead가 fb8ebbb 전체 SHA인지 확인하고 별도로 `curl --max-time 5 -fsS http://127.0.0.1:8080/health`를 실행한다.
