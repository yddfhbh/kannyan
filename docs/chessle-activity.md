# KanNyan Chessle Activity

`activity/`는 Discord Embedded Activity URL Mapping으로 제공할 수 있는 경량 정적 클라이언트이고, `scripts/chessle-server.js`는 정답·판정·진행 상태를 담당하는 별도 HTTP 프로세스입니다. 기존 봇 프로세스와 데이터 파일을 사용하지 않습니다.

## 개발 실행

```bash
CHESSLE_DEV_MODE=true CHESSLE_PORT=8787 npm run start:chessle
```

브라우저에서 `http://localhost:8787/`을 열면 체스판을 테스트할 수 있습니다. Discord Activity URL Mapping을 로컬 서버로 사용할 때는 HTTPS 터널을 사용하고 `CHESSLE_ACTIVITY_URL`에 공개 URL을 지정합니다.

## Discord 연동

1. Developer Portal → KanNyan application → **Activities**에서 Activity를 활성화합니다.
2. **URL Mappings**에 `/` 또는 `/activity`를 Activity 서버의 HTTPS URL로 매핑합니다. 정적 Activity가 API와 같은 origin에서 `/api/*`를 호출하도록 reverse proxy를 구성합니다.
3. **Installation**에서 Guild Install과 User Install을 필요한 범위로 활성화하고 `applications.commands`를 포함합니다.
4. 먼저 기존 명령어를 보존한 상태로 `/체슬`을 등록합니다. `CHESSLE_ACTIVITY_URL`을 설정하면 명령어가 안내 링크를 보여 주며, Discord App Launcher의 KanNyan 앱에서 실제 Activity를 열 수 있습니다.
5. Activity가 활성화된 뒤 `CHESSLE_REGISTER_ENTRY_POINT=true npm run register`를 실행합니다. 이때 `launch` type 4 / `DISCORD_LAUNCH_ACTIVITY` handler 2 Entry Point를 기존 명령어와 함께 등록합니다. Discord가 Entry Point를 자동 생성하는 경우에는 이 옵션을 생략하고 자동 생성된 명령을 유지합니다.

일반 slash command의 URL 버튼을 Activity 실행으로 위장하지 않습니다. App Launcher와 type 4 Entry Point가 네이티브 실행 경로입니다.

## 운영 설정

- `CHESSLE_DATA_FILE` 또는 `CHESSLE_DATA_DIR`: 기존 `data` 경로와 분리된 Chessle 저장 위치
- `CHESSLE_PORT`: 기본 `8787`
- `CHESSLE_ACTIVITY_URL`: `/체슬` 안내에 표시할 HTTPS URL
- `CHESSLE_DEV_MODE=true`: 로컬 테스트 전용. 운영에서는 사용하지 않습니다.
- `DISCORD_CLIENT_SECRET`: Discord OAuth2 Client Secret. Chessle 서버 환경변수에만 설정하며 프런트엔드에 전달하지 않습니다. `CLIENT_SECRET`도 호환되지만 운영에서는 이름을 명시한 `DISCORD_CLIENT_SECRET`을 권장합니다.

운영에서는 `CLIENT_ID`와 `DISCORD_CLIENT_SECRET`을 서버 환경변수로 설정합니다. 클라이언트는 `ready()` → `commands.authorize()` → `/api/auth/exchange` → `commands.authenticate()`를 수행하고, 이후 API에는 Chessle 세션 Bearer를 전달합니다. 서버는 Discord `/users/@me` 응답의 ID를 게임·전적 키로 사용하며 access token 만료 시 refresh token으로 갱신하고, 갱신 실패 시 재인증을 요구합니다. Activity 정적 파일과 `/api`는 같은 HTTPS origin으로 reverse proxy해야 합니다. 현재 개발 서버는 브라우저 테스트를 위해 `CHESSLE_DEV_MODE`를 제공하며, 운영 기본값에서는 인증되지 않은 제출을 거부합니다.

Developer Portal에서 직접 확인할 항목:

1. **General Information**의 Application ID를 `CLIENT_ID`와 일치시킵니다.
2. **OAuth2**에서 Client Secret을 재발급/확인하고 서버 환경변수에만 저장합니다. 이 Activity 흐름은 SDK가 redirect를 처리하므로 일반 웹 callback URL을 임의로 추가하지 않습니다.
3. **Activities → Settings**에서 Activities를 활성화하고, URL Mapping의 공개 HTTPS 대상이 `chessle.airi-kanna.com` 또는 해당 Activity 경로를 가리키게 합니다. `/api/*`도 동일 origin으로 라우팅되어야 합니다.
4. SDK authorize scope는 현재 사용자 식별에 필요한 `identify`만 요청합니다. `applications.commands`는 명령 등록/설치 설정에 필요한 경우 Installation 설정에서 별도로 유지합니다.

## 검증 범위

코어는 `chess.js`로 SAN을 서버에서 재검증하고, Exact SAN / Piece Square 판정에서 먼저 초록색을 확정한 뒤 남은 수의 빈도로 노란색을 계산합니다. Normal은 6수, Expert는 10수이며 하루 6회 제한과 KST 날짜를 적용합니다. 네이티브 Discord PC·모바일 실행은 Developer Portal 설정과 실제 Discord 계정이 필요하므로 로컬 자동 테스트만으로 성공으로 보고하지 않습니다.
## UI 자산 및 라이선스

체스 기물은 `assets/chess-pieces/cburnett/`에 포함된 Cburnett SVG 세트를 사용합니다. 이 세트는 Wikimedia Commons의 Cburnett chess pieces에서 가져온 재배포 가능한 GPL-2.0-or-later 자산이며, 원본 Chessle의 이미지나 로고는 복제하지 않습니다. Activity 서버는 같은 저장소의 SVG를 `/assets/chess-pieces/`로 제공하므로 외부 CDN에 의존하지 않습니다.
