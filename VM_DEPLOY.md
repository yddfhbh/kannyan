# Google Compute Engine VM Deployment

현재 기준 배포는 `discord-bot-vm.tar.gz` 업로드 후 heredoc 스크립트를 한 번에 실행하는 흐름입니다. 영구 데이터는 `~/discord-bot-data`, 앱 디렉터리는 `~/discord-bot-new`를 사용합니다.

## 1. Windows에서 압축 만들기

```powershell
.\deploy-vm.ps1
```

이 스크립트는 `discord-bot-vm.tar.gz`를 만들고, VM에서 그대로 붙여넣을 배포 스크립트도 같이 출력합니다.

## 2. VM에 업로드

브라우저 SSH 창의 **File upload**로 `discord-bot-vm.tar.gz`를 홈 디렉터리(`~`)에 업로드합니다.

## 3. VM에서 배포 실행

`.\deploy-vm.ps1`가 출력한 heredoc 전체를 그대로 붙여넣어 실행하세요.

배포 스크립트는 다음을 자동으로 처리합니다.

- 기존 `discord-bot` / `discord-bot-new` 프로세스 중지
- `.env` 백업 및 복원
- `~/discord-bot-data` 영구 데이터 유지
- `daily-chess-puzzle.json` 병합
- 새 tarball 압축 해제
- `data -> ~/discord-bot-data` 심볼릭 링크 재생성
- 시스템 폰트/패키지 설치
- `npm ci --omit=dev`
- 일일퍼즐용 Lichess puzzle pool 확인 또는 생성
- 퍼즐러쉬용 Lichess puzzle rush pool 새로 생성
- `npm run register`
- `pm2` 시작, 상태 확인, 헬스 체크 출력

## 4. 성공 확인

정상 배포라면 마지막에 아래를 확인할 수 있어야 합니다.

- `pm2 status`에 `discord-bot`가 `online`
- `curl -s http://127.0.0.1:8080/health` 결과가 `{"ok":true,"discordReady":true}`
- `Persistent data dir:` 아래에 `~/discord-bot-data` 파일 목록 출력
- `npm run register` 후 글로벌 슬래시 명령어 등록 완료 메시지

글로벌 명령어는 반영까지 최대 1시간 정도 걸릴 수 있습니다.

## 5. 자주 보는 확인 명령

```bash
pm2 status
pm2 logs discord-bot --lines 80 --nostream
curl -s http://127.0.0.1:8080/health
ls -lah ~/discord-bot-data
```

## 참고

- `.env`는 tarball에 포함되지 않습니다.
- 영구 데이터는 앱 폴더가 아니라 `~/discord-bot-data`에 저장됩니다.
- `daily-chess-puzzle.json`이 없으면 `/일일퍼즐지정` 실행 후 생성될 수 있습니다.
- `[Lichess opening book] preload failed ... fetch failed` 로그는 외부 fetch 실패일 수 있으며, 헬스 체크가 정상이면 배포 자체 실패와는 별개일 수 있습니다.
