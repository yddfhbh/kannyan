# Discord TETR.IO / Chess Bot

Node.js와 `discord.js`로 만든 디스코드 봇입니다. TETR.IO 프로필/스탯 이미지, QUICK PLAY 기록 카드, 체스 레이팅 조회, 알람, Gemini/Gemma 채팅을 slash 명령어와 `%` 접두사 명령어로 제공합니다.

## 주요 기능

- TETR.IO 프로필 카드, 스탯 카드, 플레이스타일 그래프, TETRA LEAGUE 랭크컷 이미지 생성
- TETR.IO APM/PPS/VS 등 주요 스탯 비교 그래프 생성
- TETR.IO QUICK PLAY / EXPERT QUICK PLAY top 또는 recent 기록의 고도 카드 생성
- Chess.com, Lichess 레이팅 조회와 Elo 기반 승률 비교
- 2700chess 라이브레이팅 표 조회
- 지정 시간 뒤 멘션 알람
- `%질문` 형태의 Gemini/Gemma 채팅, 답장 맥락/멘션 맥락/이미지 첨부 처리, 채널별 대화 기억
- Cloud Run, Google Compute Engine VM, PM2 실행을 위한 배포 파일 포함

## 요구 사항

- Node.js 18 이상, Node.js 22 권장
- Discord 봇 토큰과 애플리케이션 Client ID
- `%` 명령어와 Gemini/Gemma 채팅을 쓰려면 Discord Developer Portal에서 `Message Content Intent` 활성화
- 현재 코드가 `GuildMembers` intent도 요청하므로 Developer Portal에서 `Server Members Intent`도 활성화
- 이미지 렌더링은 `sharp`를 사용합니다. Linux VM에서는 한글 렌더링을 위해 `fonts-noto-cjk` 설치를 권장합니다.

## 설치

```bash
npm install
```

배포 환경에서는 잠금 파일 기준 설치를 쓰면 됩니다.

```bash
npm ci --omit=dev
```

## 환경 변수

`.env.example`을 참고해 `.env`를 만듭니다.

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id_here

GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemma-4-26b-a4b-it
GEMINI_FALLBACK_MODELS=gemma-4-31b-it

GUILD_ID=
PORT=8080
```

| 변수 | 설명 |
| --- | --- |
| `DISCORD_TOKEN` | Discord 봇 토큰입니다. 실행과 명령어 등록에 필요합니다. |
| `CLIENT_ID` | Discord 애플리케이션 Client ID입니다. slash 명령어 등록에 필요합니다. |
| `GUILD_ID` | 선택 값입니다. 설정하면 글로벌 명령어와 함께 해당 서버 명령어도 즉시 등록합니다. |
| `PORT` | 헬스체크 HTTP 서버 포트입니다. 기본값은 `8080`입니다. |
| `GEMINI_API_KEY` | `%질문` 채팅에 사용할 API 키입니다. |
| `GEMINI_API_KEYS` | 여러 API 키를 쉼표로 넣을 수 있습니다. |
| `GEMMA_API_KEY`, `GEMMA_API_KEYS` | `GEMINI_*`와 같은 용도의 별칭입니다. |
| `GEMINI_MODEL`, `GEMMA_MODEL` | 기본 텍스트 모델입니다. 코드 기본값은 `gemma-4-26b-a4b-it`입니다. |
| `GEMINI_FALLBACK_MODELS`, `GEMMA_FALLBACK_MODELS` | 기본 모델 실패 시 순서대로 시도할 모델 목록입니다. |
| `GEMINI_VISION_MODEL` | 이미지 첨부가 있을 때 사용할 모델입니다. 기본값은 `gemini-2.5-flash-lite`입니다. |
| `GEMINI_VISION_FALLBACK_MODELS` | 이미지 처리용 fallback 모델 목록입니다. |
| `GEMINI_TIMEOUT_MS` | Gemini/Gemma 요청 타임아웃입니다. 기본값은 `20000`입니다. |
| `GEMINI_MAX_OUTPUT_TOKENS` | 모델 답변 최대 토큰 수입니다. 기본값은 `1024`입니다. |
| `GEMINI_MAX_ATTEMPTS_PER_MODEL` | 모델별 재시도 횟수입니다. 기본값은 `3`입니다. |
| `GEMINI_MEMORY_DAYS` | 채널별 대화 기억 보관 일수입니다. 기본값은 `45`입니다. |
| `GEMINI_IMAGE_MAX_BYTES` | 이미지 첨부 최대 크기입니다. 기본값은 8 MiB입니다. |

Gemini/Gemma 대화 기억은 `data/gemini-memory.json`에 저장됩니다. 이 파일은 런타임에 자동 생성되며 git에는 올리지 않습니다.

## 명령어 등록

```bash
npm run register
```

`src/deploy-commands.js`가 slash 명령어를 Discord API에 등록합니다. 글로벌 명령어는 반영까지 시간이 걸릴 수 있습니다. `GUILD_ID`를 넣으면 해당 서버에는 바로 반영되는 guild 명령어도 함께 등록합니다.

## 실행

```bash
npm start
```

실행하면 Discord Gateway에 접속하고, 동시에 HTTP 헬스체크 서버를 엽니다.

```bash
curl http://127.0.0.1:8080/health
```

봇이 온라인이면 `/도움말`, `%도움말`, `%help` 중 하나로 동작을 확인할 수 있습니다.

## 명령어

| Slash 명령어 | `%` 명령어 | 설명 |
| --- | --- | --- |
| `/도움말` | `%도움말`, `%help` | 사용 가능한 명령어를 보여줍니다. |
| `/체닷 닉네임:<닉네임>` | `%체닷 닉네임` | Chess.com 래피드, 블리츠, 불렛, 퍼즐 레이팅을 조회합니다. 프로필 주소도 입력할 수 있습니다. |
| `/리체스 멤버이름:<이름>` | `%리체스 이름` | Lichess 래피드, 블리츠, 불렛 레이팅을 조회합니다. 프로필 주소도 입력할 수 있습니다. |
| `/테토 닉네임:[닉네임]` | `%teto 닉네임`, `%teto @멘션` | TETR.IO 프로필 카드를 이미지로 보여줍니다. 닉네임을 생략하면 연결된 계정을 사용합니다. |
| - | `%teto` | 작성자 또는 답장 대상의 Discord 계정에 연결된 TETR.IO 계정을 찾아 프로필 카드를 보여줍니다. |
| `/스탯 닉네임:[닉네임]` | `%ts [닉네임]` | TETR.IO 스탯 카드를 보여줍니다. 닉네임을 생략하면 연결된 계정을 사용합니다. |
| - | `%ts 60 2.0 120` | APM, PPS, VS를 직접 넣어 커스텀 스탯 카드를 만듭니다. |
| `/그래프 닉네임:[입력]` | `%psq [입력]` | Opener/Plonk/Stride/Inf DS 그래프를 보여줍니다. 입력을 생략하면 연동 계정을 사용하고, 여러 닉네임은 한 그래프에 겹쳐 표시합니다. 없는 닉네임은 건너뛰고 따로 안내합니다. `60 2.0 120`처럼 APM/PPS/VS 직접 입력도 지원합니다. |
| `/비교 닉네임:[입력]` | `%vs [입력]` | APM, PPS, VS, APP, DS/Second, DS/Piece, APP+DS/Piece, VS/APM, Cheese Index, Garbage Effi. 비교 그래프를 보여줍니다. 여러 닉네임은 한 그래프에 겹쳐 표시하고, 없는 닉네임은 건너뛰며, 앞의 두 명은 점수/스탯 기반 승률을 채팅에 같이 표시합니다. |
| `/분석 파일:[.ttrm]` | `%munch` + `.ttrm` 첨부 | 첨부한 TETR.IO 리플레이 파일을 MinoMuncher 그래프로 분석합니다. 파일이 없으면 `ttrm파일 달라냥!`을 출력합니다. |
| `/랭크컷` | `%tetr`, `%tetoranks` | TETRA LEAGUE 랭크컷 이미지를 보여줍니다. |
| `/퀵플 닉네임:[닉네임] 숫자:[번호] recent:[top/recent]` | `%qp [닉네임] [번호] [top/recent]` | QUICK PLAY top 또는 recent 기록의 고도 카드를 보여줍니다. 닉네임을 생략하면 연결된 계정을 사용합니다. |
| `/익스퀵플 닉네임:[닉네임] 숫자:[번호] recent:[top/recent]` | `%exqp [닉네임] [번호] [top/recent]` | EXPERT QUICK PLAY top 또는 recent 기록의 고도 카드를 보여줍니다. 닉네임을 생략하면 연결된 계정을 사용합니다. |
| `/체스비교 플랫폼:<체닷/리체스> 타임컨트롤:<래피드/블리츠/불렛> 닉네임1:<이름> 닉네임2:<이름>` | - | 두 사람의 레이팅과 Elo 기반 예상 승률을 비교합니다. |
| `/승률예측 점수1:<점수> 점수2:<점수>` | - | 두 점수의 Elo 기반 예상 승률을 계산합니다. |
| `/알람 내용:<내용> 분:<1~10080>` | - | 지정한 분 뒤에 작성자를 멘션합니다. |
| `/라이브레이팅 종류:<클래시컬/블리츠/래피드> 사람수:<1~50>` | - | 2700chess 라이브레이팅을 표로 보여줍니다. |
| - | `%질문` | 등록된 `%` 명령어가 아니면 Gemini/Gemma 채팅으로 처리합니다. |

TETR.IO 계정 연동 기반 명령은 TETR.IO 프로필에 Discord 계정을 연결한 사용자에게만 동작합니다. `%teto`, `%qp`, `%exqp`, `%ts`, `%psq`, `%vs`는 멘션이나 답장 대상의 연결 계정도 사용할 수 있습니다.

## Gemini/Gemma 채팅

`%` 뒤에 등록된 명령어가 아닌 문장을 입력하면 모델 답변을 생성합니다.

```text
%오늘 할 일 정리해줘
```

이미지를 첨부하고 `%`만 보내거나, 이미지가 있는 메시지에 답장하면서 `%`를 보내면 이미지를 함께 분석합니다. 지원 MIME 타입은 `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`이며 한 번에 최대 4개까지 사용합니다.

## 코드 구조

| 경로 | 역할 |
| --- | --- |
| `src/index.js` | Discord 클라이언트, 메시지/slash 명령 처리, Gemini/Gemma 처리, 헬스체크 HTTP 서버 |
| `src/deploy-commands.js` | slash 명령어 등록 스크립트 |
| `src/tetrio-card.js` | TETR.IO 프로필 조회와 프로필 카드 이미지 렌더링 |
| `src/tetrio-stats.js` | TETR.IO 리그 스탯 조회와 계산 데이터 구성 |
| `src/tetrio-stats-calculations.js` | 스탯 파생값, TR 추정, 플레이스타일 계산 |
| `src/tetrio-stats-card.js` | TETR.IO 스탯 카드 이미지 렌더링 |
| `src/tetrio-playstyle-graph.js` | 플레이스타일 레이더 그래프 렌더링 |
| `src/tetrio-versus-graph.js` | 주요 스탯 비교 레이더 그래프 렌더링 |
| `src/minomuncher-analysis.js` | MinoMuncher 첨부 리플레이 파싱, 그래프 렌더링 |
| `src/tetrio-rankcut.js` | TETRA LEAGUE 랭크컷 데이터 조회와 이미지 렌더링 |
| `src/tetrio-quickplay.js` | QUICK PLAY / EXPERT QUICK PLAY 기록 조회와 고도 카드 렌더링 |
| `assets/` | TETR.IO 카드용 로컬 이미지, mod 아이콘, 폰트 |
| `Dockerfile` | Cloud Run 등 컨테이너 배포용 이미지 |
| `ecosystem.config.cjs` | PM2 실행 설정 |
| `deploy-vm.ps1` | VM 업로드용 압축 파일 생성 스크립트 |
| `CLOUD_RUN.md`, `VM_DEPLOY.md` | 배포 절차 문서 |

## 배포

컨테이너 배포는 [CLOUD_RUN.md](./CLOUD_RUN.md)를 참고하세요. Cloud Run에서는 Discord Gateway 연결 유지를 위해 `min-instances=1`, `max-instances=1`, CPU 항상 할당 설정을 권장합니다.

일반 Google Compute Engine VM이나 PM2 실행은 [VM_DEPLOY.md](./VM_DEPLOY.md)를 참고하세요. Windows에서 VM 업로드용 압축 파일을 만들 때는 다음 스크립트를 사용할 수 있습니다.

```powershell
.\deploy-vm.ps1
```

## 참고

- `.env`, 로그 파일, `data/gemini-memory.json`, `node_modules/`는 저장소에 올리지 않습니다.
- TETR.IO, Chess.com, Lichess, 2700chess 외부 API 상태에 따라 일부 명령어 응답이 실패할 수 있습니다.
- 이미지 카드는 SVG를 만든 뒤 `sharp`로 PNG 변환합니다. Linux에서 한글이 네모로 보이면 Noto CJK 계열 폰트를 설치하세요.
