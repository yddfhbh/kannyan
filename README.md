# Discord Bot

Node.js와 discord.js로 만든 디스코드 봇입니다.

## 준비

1. Discord Developer Portal에서 애플리케이션과 봇을 만듭니다.
2. `.env.example` 파일을 복사해서 `.env` 파일을 만듭니다.
3. `.env`에 값을 채웁니다.

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id_here
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.5-flash
GEMINI_FALLBACK_MODELS=gemini-2.5-flash,gemini-2.5-flash-lite
GUILD_ID=your_server_id_here
```

슬래시 명령어는 글로벌 명령어로 등록합니다. `GUILD_ID`를 넣으면 해당 서버에 남아 있는 서버 전용 명령어를 비워서 중복 표시를 막습니다.

## 설치

```bash
npm install
```

## 슬래시 명령어 등록

```bash
npm run register
```

## 실행

```bash
npm start
```

봇이 온라인이 되면 디스코드 서버에서 `/도움말`, `%도움말`, `%help` 중 하나를 입력해 테스트할 수 있습니다.

## 명령어

- `/도움말`, `%도움말`, `%help` - 사용 가능한 명령어와 사용 예시를 보여줍니다.
- `/체닷 닉네임:<Chess.com 닉네임>` 또는 `%체닷 닉네임` - Chess.com 래피드, 블리츠, 불렛, 퍼즐 레이팅을 보여줍니다.
- `/리체스 멤버이름:<Lichess 멤버 이름>` 또는 `%리체스 멤버이름` - Lichess 래피드, 블리츠, 불렛 레이팅을 보여줍니다.
- `/테토 닉네임:<TETR.IO 닉네임>` 또는 `%teto 닉네임` - TETR.IO 프로필 카드를 보여줍니다.
- `%teto` - 디스코드 계정에 연결된 TETR.IO 계정이 있으면 바로 프로필 카드를 보여줍니다.
- `/스탯 닉네임:[TETR.IO 닉네임]` 또는 `%ts 닉네임` - TETR.IO 스탯 카드 형식을 보여줍니다. 닉네임을 생략하면 연동된 계정을 사용합니다.
- `/체스비교 플랫폼:<체닷|리체스> 타임컨트롤:<래피드|블리츠|불렛> 닉네임1:<이름> 닉네임2:<이름>` - 두 사람의 점수와 Elo 기반 예상 승률을 비교합니다.
- `/승률예측 점수1:<점수> 점수2:<점수>` - 두 점수의 Elo 기반 예상 승률을 계산합니다.
- `/알람 내용:<알람 내용> 분:<1~10080>` - 지정한 분 뒤에 멘션으로 알람을 보냅니다.
- `/라이브레이팅 종류:<클래시컬|블리츠|래피드> 사람수:<1~50>` - 2700chess 라이브레이팅을 표로 보여줍니다.
- `%질문` - 등록된 `%` 명령어가 아니면 Gemini API로 답변합니다.
