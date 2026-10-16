# 후속 재검증 결함 수정과 실제 검증 인계

> 최신 후속 상태와 재실행 명령은 [chat-evidence-quality-fixes.md](chat-evidence-quality-fixes.md)를 따른다. 아래 테스트 결과는 이전 작업 기록이다.

2026-10-15. 기존 미커밋 변경을 보존했다. 현재 HEAD는 `fb8ebbb23e22f6382afc5f67671191774c68725b`이며, 수정사항은 아직 미커밋이다. 이 문서의 명령과 상태가 이전 인계 문서보다 우선한다.

## 수정

- 원래 질문 `originalPrompt`, 모델 검색어 `plannedQuery`, 위키 대상명 `targetName`, 속성 `attribute`를 분리했다. 명시한 위키 대상은 원래 질문에서 결정하며 재작성 문장으로 바꾸지 않는다. 제목 비교·생일 추출은 대상명을 사용한다. 나이 답변은 원래 질문의 대상과 정확히 일치하는 문서가 하나일 때만 그 문서의 검증된 생일과 서버 요청 기준일을 연결한다. 첫 생일·최고 점수만으로 선택하지 않는다. 혼합 질문의 위키 부분도 처리하며, 요청어 정규식 목록은 추가하지 않았다.
- 뉴스는 확인한 기사별로 격리된 본문을 모델에 제공해 요약한다. 제목·게시일·URL·확보 건수·최근 14일 조회 범위는 애플리케이션에서 출력하여 모델의 생략을 막는다. 1건이면 `1건뿐`이라고 명시한다. 인용 검증 실패 시 해당 본문의 발췌로 제한한다. 기존 관련성·게시일·본문 검증과 읽기 한도는 유지한다.
- 짧은 독립 질문은 원래 질문을 조회에 사용하고, 문맥 의존 질문은 모델의 검색어를 사용한다. 둘을 무조건 연결하지 않는다. 현재 질문과 계획 검색어는 trace에 따로 남긴다.
- 기본 실제 실행 목록은 날씨 → AI 뉴스 → 위키 나이 → `gpt 6 sol vs gpt 6.1 sol` 네 질문이다. 같은 격리 세션에서 실행하므로 이전 주제의 검색어 혼입도 확인할 수 있다. `--product-comparisons`는 별도의 추가 탐색 목록이다.
- 환경 사전 검사에서 `.env`와의 값 비교는 챗봇 조회·모델 관련 변수에만 적용한다. 아래 실제 실행 명령은 clean environment에서 지정한 `.env`를 읽으며, PM2와 셸의 무관한 변수 일치를 전제하지 않는다.

## 검증 결과

- `npm test`: 271/271 통과 (`tmp/chat-final-tests.log`). 날씨 근거·완성 답변 단일 출력·생일 추출·재작성된 위키 요청·다른 인물 생일·제목 모호성·뉴스 최종 필드·새 주제 검색어 격리 회귀를 포함한다.
- `node --check src/index.js`, `node --check scripts/verify-chat-live.js`, `git diff --check`: 통과.
- 로컬 실제 검증 진입: API 키가 없어 `unverified`, 모델/HTTP 요청 0회. `tmp/chat-four-live-unverified.json`에 네 질문이 기록됐다. 실제 모델 답변 검증 성공이 아니다.
- commit·push·배포·PM2 재시작은 실행하지 않았다. 사용자가 요구한 실제 최종 답변 검토가 남았다.

## ubuntu 로그인 콘솔에서 네 질문 실행

운영 비밀값을 이 작업 트리로 복사하거나 출력하지 않는다. 아래 경로의 `.env`를 dotenv가 직접 읽는다. 기존 preflight는 필수 선행 조건이 아니다. 작업 트리 코드가 바뀌었다면 manifest 검사는 먼저 갱신·검토해야 한다.

```bash
(
  set -eu
  test "$(id -un)" = ubuntu
  cd /home/ubuntu/.local/share/agent-hebi/task-worktrees/discord-bot/5fa4e30c85594ea39537f639f91152a7
  sha256sum --check docs/chat-live-verification.sha256
  env -i HOME=/home/ubuntu PATH=/usr/bin:/bin NODE_ENV=production \
    DOTENV_CONFIG_PATH=/home/ubuntu/discord-bot-new/.env \
    timeout --signal=TERM --kill-after=5s 190s \
    /usr/bin/node scripts/verify-chat-live.js > tmp/chat-four-live.log
)
```

전체 제한은 모델 요청 12회, fetch 36회, 180초다. `completed-needs-review`는 자동 합격이 아니다. 로그의 네 `final`을 실제 근거와 함께 검토한다.

1. 날씨: 부산·서버 기준일·근거가 최종 모델 입력에 있고, 자체소개와 날씨가 완성 답변 한 번으로 출력되는지 확인한다.
2. 뉴스: `newsVerification`과 기사별 실제 본문·게시일·제목·URL을 확인한다. `final`의 요약과 일치하고, 1건이면 그 범위를 명시하며 여러 동향으로 일반화하지 않아야 한다. `query`에 원래 요청과 검색어가 반복 결합되지 않아야 한다.
3. 위키: `lookup`의 원래 질문·계획 검색어·대상명·속성, 정확히 일치한 제목, 그 문서의 `birthDateEvidence`와 `verifiedBirthDate`, 최종 기준일·만 나이를 확인한다. 다른 인물의 생일은 근거가 될 수 없다.
4. 비교: 기본 목록의 네 번째 질문이 실제 실행되고 전체 모델 이름을 유지하는지 확인한다. 이전 뉴스·날씨·위키 대상이 `query`에 합쳐지지 않아야 한다. 식별 불확실성을 임의의 미출시·가상 주장으로 바꾸지 않아야 한다.

## 검토 후 이어갈 순서

실제 로그의 최종 답변을 검토한 뒤 관련 수정사항을 commit·push한다. 현재 관리 브랜치는 유지하며, 변경 커밋이 `origin/main`에 포함되는 저장소 승인 절차를 따른다. 이후 기존 승인 경로 `server_privileged_operation({operation:"discord_bot_deploy",args:{}})`로 배포한다. 도우미는 실행 시점 `origin/main`을 배포하므로 검증 코드와 후보가 일치하는지 확인해야 한다. 반환된 `afterHead`, `validation`, `pm2Status`와 별도 `/health`의 `ok`, `discordReady`를 확인한 뒤에만 배포 완료로 보고한다.
