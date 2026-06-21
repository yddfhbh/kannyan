# Discord TETR.IO / Chess Bot

Node.js와 `discord.js`로 만든 디스코드 봇입니다. TETR.IO 프로필/스탯 이미지, QUICK PLAY/40 LINES/BLITZ 기록 카드, 체스 레이팅 조회, 알람, Gemini/Gemma 채팅을 slash 명령어와 `%` 접두사 명령어로 제공합니다.

## 주요 기능

- TETR.IO 프로필 카드, 스탯 카드, 플레이스타일 그래프, TETRA LEAGUE 랭크컷 이미지 생성
- TETR.IO APM/PPS/VS 등 주요 스탯 비교 그래프 생성
- TETR.IO TETRA LEAGUE 최근 경기 전적, QUICK PLAY / EXPERT QUICK PLAY / 40 LINES / BLITZ top 또는 recent 기록 카드 생성
- Chess.com, Lichess 레이팅 조회와 Elo 기반 승률 비교
- 체스판 이미지를 `chessimg2pos`로 FEN 변환한 뒤 Stockfish 최선 수 분석
- 2700chess 라이브레이팅 카드 조회
- 지정 시간 뒤 멘션 알람
- `%질문` 형태의 Gemini/Gemma 채팅, 답장 맥락/멘션 맥락/이미지 첨부 처리, 최신 정보가 필요한 질문의 자동 웹 검색 보강, 채널별 대화 기억과 출처가 기록되는 영구 기억
- Cloud Run, Google Compute Engine VM, PM2 실행을 위한 배포 파일 포함

## 요구 사항

- Node.js 18 이상, Node.js 22 권장
- 체스 이미지 분석 기능은 Python 3.10 이상 필요
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

체스 이미지 분석 기능은 별도 Python 가상환경에 설치합니다.

```bash
python3 -m venv .venv-chess
.venv-chess/bin/pip install -r requirements-chess.txt
```

Windows PowerShell에서는 `.venv-chess\Scripts\python.exe -m pip install -r requirements-chess.txt`를 사용하면 됩니다.

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
| `CHESS_IMAGE_PYTHON` | `chessimg2pos`가 설치된 Python 실행 파일입니다. 비우면 프로젝트의 `.venv-chess` 또는 시스템 Python을 찾습니다. |
| `CHESS_IMAGE_TIMEOUT_MS` | 이미지에서 FEN을 읽는 최대 시간입니다. 기본값은 `120000`입니다. |
| `CHESS_IMAGE_MAX_BYTES` | 체스 이미지 첨부 최대 크기입니다. 기본값은 8 MiB입니다. |
| `CHESS_IMAGE_MIN_CONFIDENCE` | 인식 결과의 최소 평균 신뢰도입니다. 기본값 `0`은 구조 검증만 사용합니다. |
| `CHESS_STOCKFISH_MOVETIME_MS` | Stockfish가 최선 수를 탐색하는 시간입니다. 기본값은 `2000`입니다. |
| `CHESS_OPENING_ENABLED` | `true`면 봇과 두는 체스 대국에서 오프닝북 기능을 켭니다. 기본 동작은 로컬 수동 북만 사용합니다. `false`, `0`, `off`, `no`면 끕니다. |
| `CHESS_OPENING_PLAYER` | 오프닝북 기준으로 따라할 Lichess 플레이어 이름입니다. 기본값은 `bears4347`입니다. |
| `CHESS_OPENING_SPEEDS`, `CHESS_OPENING_MODES` | Explorer에 보낼 속도/모드 필터입니다. 기본값은 각각 `blitz,rapid,classical`, `rated`입니다. |
| `CHESS_OPENING_MAX_PLY` | 오프닝북을 참고할 최대 half-move 수입니다. 기본값은 `18`입니다. |
| `CHESS_OPENING_MIN_GAMES` | 후보수로 인정할 최소 표본 게임 수입니다. 기본값은 `2`입니다. |
| `CHESS_OPENING_STYLE` | `mimic`이면 빈도 위주, `stronger`면 성적이 좋은 수를 조금 더 우대합니다. |
| `CHESS_OPENING_NETWORK_ENABLED` | `true`일 때만 Lichess Explorer 네트워크 조회와 시작 워밍업을 허용합니다. 기본값은 `false`입니다. |
| `CHESS_OPENING_TIMEOUT_MS` | Lichess 오프닝북 응답 대기 시간입니다. 기본값은 `3500`입니다. |
| `CHESS_OPENING_PRELOAD_MAX_NODES` | 네트워크 조회를 켰을 때 시작 시 미리 받아둘 오프닝 포지션 수 상한입니다. 기본값은 `250`입니다. |
| `CHESS_OPENING_PRELOAD_BRANCHES` | 네트워크 조회를 켰을 때 각 포지션에서 다음 수를 몇 갈래까지 따라 내려가며 선적재할지 정합니다. 기본값은 `12`입니다. |
| `CHESS_OPENING_PRELOAD_DELAY_MS` | 네트워크 조회를 켰을 때 오프닝북 선적재 요청 사이 대기 시간입니다. 기본값은 `60`ms입니다. |
| `CHESS_OPENING_CACHE_PATH` | 오프닝북 캐시 파일 경로입니다. 비우면 데이터 디렉터리 아래 `lichess-player-opening-cache.json`을 사용합니다. |
| `CHESS_OPENING_MANUAL_BOOK_PATH` | 수동 오프닝북 JSON 경로입니다. 이 파일이 있으면 시작 시 네트워크 워밍업 대신 이 파일을 우선 사용합니다. 기본값은 데이터 디렉터리 아래 `lichess-player-opening-manual-book.json`입니다. |

기본 동작에서는 네트워크 오프닝 조회를 하지 않고, 수동 오프닝북 JSON만 사용합니다. 수동 북에 없는 변형으로 벗어나면 그때는 바로 Stockfish 쪽으로 넘어갑니다. Lichess Explorer 네트워크 조회가 꼭 필요할 때만 `CHESS_OPENING_NETWORK_ENABLED=true`로 켜면 됩니다.

수동 오프닝북을 다시 만들고 싶으면 `npm run build:opening-book -- --player bears4347`를 실행하면 됩니다. 기본 출력 경로는 `data/lichess-player-opening-manual-book.json`입니다.

Gemini/Gemma 대화 기억은 `data/gemini-memory.json`에 저장되고 `GEMINI_MEMORY_DAYS`에 따라 정리됩니다. `/가르치기`와 `%...기억해줘`, `%...기억해둬`, `%...기억해`로 저장한 영구 기억은 `data/gemini-permanent-memory.json`에 별도로 저장되며 만료되지 않습니다. 두 파일은 런타임에 자동 생성되고 git에는 올리지 않습니다.

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
| `/검색 질문:<검색어>` | `%검색 검색어`, `%search query` | DuckDuckGo HTML 검색 결과를 바탕으로 최신 정보를 정리합니다. Gemini/Gemma API 키가 없으면 검색 결과 목록만 보여줍니다. |
| `/가르치기 정보:<내용>` | `%<내용> 기억해줘`, `%<내용> 기억해둬`, `%<내용> 기억해` | 서버별 영구 기억에 정보와 작성자를 저장합니다. 관련 답변에서 사용되면 작성자 이름을 코드 블록 출처로 표시합니다. |
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
| `/전적 닉네임:[닉네임] 숫자:[번호]` | `%tetra [닉네임] [번호]` | TETRA LEAGUE 최근 경기 전적을 이미지로 보여줍니다. 닉네임을 생략하면 연결된 계정을 사용합니다. |
| `/퀵플 닉네임:[닉네임] 숫자:[번호] recent:[top/recent]` | `%qp [닉네임] [번호] [top/recent]` | QUICK PLAY top 또는 recent 기록의 고도 카드를 보여줍니다. 닉네임을 생략하면 연결된 계정을 사용합니다. |
| `/익스퀵플 닉네임:[닉네임] 숫자:[번호] recent:[top/recent]` | `%exqp [닉네임] [번호] [top/recent]` | EXPERT QUICK PLAY top 또는 recent 기록의 고도 카드를 보여줍니다. 닉네임을 생략하면 연결된 계정을 사용합니다. |
| `/40라인 닉네임:[닉네임] 숫자:[번호] recent:[top/recent]` | `%40L [닉네임] [번호] [top/recent]` | 40 LINES top 또는 recent 기록의 시간 카드를 보여줍니다. 닉네임을 생략하면 연결된 계정을 사용합니다. |
| `/블리츠 닉네임:[닉네임] 숫자:[번호] recent:[top/recent]` | `%blitz [닉네임] [번호] [top/recent]` | BLITZ top 또는 recent 기록의 점수 카드를 보여줍니다. 닉네임을 생략하면 연결된 계정을 사용합니다. |
| `/체스비교 플랫폼:<체닷/리체스> 타임컨트롤:<래피드/블리츠/불렛> 닉네임1:<이름> 닉네임2:<이름>` | - | 두 사람의 레이팅과 Elo 기반 예상 승률을 비교합니다. |
| `/승률예측 점수1:<점수> 점수2:<점수>` | - | 두 점수의 Elo 기반 예상 승률을 계산합니다. |
| `/알람 내용:<내용> 분:<1~10080>` | - | 지정한 분 뒤에 작성자를 멘션합니다. |
| `/라이브레이팅 종류:<클래시컬/블리츠/래피드> 사람수:<1~50>` | - | 2700chess 라이브레이팅을 이미지 카드로 보여줍니다. |
| - | 체스판 이미지 + `%백선`, `%흑선`, `%분석해봐`, `%답이 뭐야` 등 | 백/흑 차례만 적거나 풀이를 원하는 자연스러운 표현을 보내면 FEN을 읽고 Stockfish로 계산합니다. 흑 시점, 테두리, 카드형 화면을 보정하고 필요하면 Gemini Vision으로 한 번 더 읽습니다. 성공 응답은 최선 수를 포함한 자연스러운 AI 문장으로 보냅니다. |
| - | `%fen <FEN>` | 이미지 인식 실패 시 직접 입력한 FEN을 Stockfish로 분석합니다. |
| `/일일퍼즐` | `%일일퍼즐` | 오늘의 체스 퍼즐을 DM으로 시작합니다. DM에서 `포기`를 보내면 원래 퍼즐 채널에 공개 포기 처리되며, 같은 날 다시 도전할 수 있습니다. |
| - | `%질문` | 등록된 `%` 명령어가 아니면 Gemini/Gemma 채팅으로 처리합니다. |

TETR.IO 계정 연동 기반 명령은 TETR.IO 프로필에 Discord 계정을 연결한 사용자에게만 동작합니다. `%teto`, `%tetra`, `%qp`, `%exqp`, `%ts`, `%psq`, `%vs`는 멘션이나 답장 대상의 연결 계정도 사용할 수 있습니다.

## Gemini/Gemma 채팅

`%` 뒤에 등록된 명령어가 아닌 문장을 입력하면 모델 답변을 생성합니다.

```text
%오늘 할 일 정리해줘
```

`%검색 OpenAI Responses API`, `/검색 질문:오늘 서울 날씨`처럼 명시적으로 검색할 수도 있고, `%최신 엔비디아 발표 알려줘`, `%오늘 서울 날씨 어때`처럼 최신 정보가 필요한 질문은 자동으로 웹 검색 결과를 참고합니다.

이미지를 첨부하고 `%`만 보내거나, 이미지가 있는 메시지에 답장하면서 `%`를 보내면 이미지를 함께 분석합니다. 지원 MIME 타입은 `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`이며 한 번에 최대 4개까지 사용합니다.

`/가르치기` 또는 `%` 문장에 `기억해줘`, `기억해둬`, `기억해`를 넣으면 정보가 서버별 영구 저장소에 저장됩니다. 나중에 관련 질문에 답하면서 그 정보를 사용하면 답변 아래 코드 블록에 `@작성자가 알려준 정보다냥.` 형식으로 출처가 붙습니다.

Discord ID `635107514471415808`인 관리자가 `%기억제거`를 입력하면 모든 서버와 DM의 영구 기억을 전부 삭제하고, 서버 채널에서 `%기억제거 이서버만`을 입력하면 해당 서버의 영구 기억만 삭제합니다. 다른 사용자는 이 명령을 실행할 수 없습니다.

## 코드 구조

| 경로 | 역할 |
| --- | --- |
| `src/index.js` | Discord 클라이언트, 메시지/slash 명령 처리, Gemini/Gemma 처리, 헬스체크 HTTP 서버 |
| `src/deploy-commands.js` | slash 명령어 등록 스크립트 |
| `src/web-search.js` | DuckDuckGo HTML 검색, 검색 결과 파싱, 최신 정보 질문 판별 |
| `src/chess/chess-analysis-command.js` | 체스 이미지/FEN 메시지 명령 처리 |
| `src/chess/chess-image-reader.js` | Python `chessimg2pos` 프로세스 호출과 FEN 검증 |
| `src/chess/stockfish-lite.js` | Stockfish WASM 최선 수 분석 |
| `scripts/chess-image-to-fen.py` | 체스판 이미지 인식 결과를 표준 FEN으로 변환 |
| `src/tetrio-card.js` | TETR.IO 프로필 조회와 프로필 카드 이미지 렌더링 |
| `src/tetrio-stats.js` | TETR.IO 리그 스탯 조회와 계산 데이터 구성 |
| `src/tetrio-stats-calculations.js` | 스탯 파생값, TR 추정, 플레이스타일 계산 |
| `src/tetrio-stats-card.js` | TETR.IO 스탯 카드 이미지 렌더링 |
| `src/tetrio-playstyle-graph.js` | 플레이스타일 레이더 그래프 렌더링 |
| `src/tetrio-versus-graph.js` | 주요 스탯 비교 레이더 그래프 렌더링 |
| `src/minomuncher-analysis.js` | MinoMuncher 첨부 리플레이 파싱, 그래프 렌더링 |
| `src/tetrio-rankcut.js` | TETRA LEAGUE 랭크컷 데이터 조회와 이미지 렌더링 |
| `src/tetrio-league-match.js` | TETRA LEAGUE 최근 경기 전적 조회와 매치 카드 렌더링 |
| `src/tetrio-quickplay.js` | QUICK PLAY / EXPERT QUICK PLAY 기록 조회와 고도 카드, 40 LINES 시간 카드, BLITZ 점수 카드 렌더링 |
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

- `.env`, 로그 파일, `data/gemini-memory.json`, `data/gemini-permanent-memory.json`, `node_modules/`는 저장소에 올리지 않습니다.
- TETR.IO, Chess.com, Lichess, 2700chess 외부 API 상태에 따라 일부 명령어 응답이 실패할 수 있습니다.
- 이미지 카드는 SVG를 만든 뒤 `sharp`로 PNG 변환합니다. Linux에서 한글이 네모로 보이면 Noto CJK 계열 폰트를 설치하세요.
