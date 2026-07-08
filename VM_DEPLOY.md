# Google Compute Engine VM Deployment

현재 기준 배포는 `discord-bot-vm.tar.gz`와 `discord-bot-vm-deploy.sh`를 같이 만든 뒤, 둘 다 VM에 업로드해서 `.sh` 파일을 실행하는 흐름입니다. 영구 데이터는 `~/discord-bot-data`, 앱 디렉터리는 `~/discord-bot-new`를 사용합니다.

## 1. Windows에서 압축 만들기

```powershell
.\deploy-vm.ps1
```

이 스크립트는 `discord-bot-vm.tar.gz`와 `discord-bot-vm-deploy.sh`를 같이 만듭니다. heredoc도 fallback 용도로 같이 출력하지만, 브라우저 SSH 붙여넣기 오염을 피하려면 `.sh` 업로드 실행 방식을 우선 사용하세요.

## 2. VM에 업로드

브라우저 SSH 창의 **File upload**로 아래 두 파일을 홈 디렉터리(`~`)에 업로드합니다.

- `discord-bot-vm.tar.gz`
- `discord-bot-vm-deploy.sh`

## 3. VM에서 배포 실행

VM 셸에서 아래 명령으로 실행하세요.

```bash
bash ~/discord-bot-vm-deploy.sh
```

`.sh` 파일을 올릴 수 없는 경우에만 `.\deploy-vm.ps1`가 출력한 heredoc 전체를 그대로 붙여넣어 실행하세요.

예전에 쓰던 `git clone` / `git pull --ff-only` 기반 heredoc은 현재 공식 배포 경로가 아닙니다. 특히 VM 체크아웃 안에 untracked `data`가 남아 있으면 `git pull`이 `The following untracked working tree files would be overwritten by merge: data`로 실패할 수 있으니, 지금은 그 예전 스크립트 대신 이 `.sh` 업로드 실행 방식을 사용하세요.

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

## 6. 문제 해결

### `git pull` 중 `data` 충돌이 난 경우

예전 Git 기반 배포 문구를 실행하다가 아래와 비슷한 오류가 나면:

```text
The following untracked working tree files would be overwritten by merge:
        data
```

원인은 VM의 `~/discord-bot-new/data`가 Git 체크아웃 안에 일반 파일/디렉터리로 남아 있어서입니다. 현재 공식 흐름에서는 `data`를 앱 폴더에 두지 않고 `~/discord-bot-data`로 분리해서 심볼릭 링크로 연결하므로, 아래처럼 기존 `data`만 안전하게 빼낸 뒤 tarball 배포로 넘어가면 됩니다.

```bash
mkdir -p ~/discord-bot-backups
if [ -e ~/discord-bot-new/data ] && [ ! -L ~/discord-bot-new/data ]; then
  mv ~/discord-bot-new/data ~/discord-bot-backups/data-from-git-checkout-$(date +%Y%m%d-%H%M%S)
fi
```

그 다음 이 문서의 공식 절차대로 다시 실행하세요.

```bash
bash ~/discord-bot-vm-deploy.sh
```

### 브라우저 SSH 붙여넣기 내용이 깨진 경우

붙여넣은 heredoc 중간에 이상한 문자열이 섞이거나 줄이 깨지면 paste corruption일 가능성이 큽니다. 그 경우에는 heredoc 재붙여넣기보다 `discord-bot-vm-deploy.sh` 파일 자체를 업로드해서 실행하는 쪽이 안전합니다.

## 참고

- `.env`는 tarball에 포함되지 않습니다.
- 영구 데이터는 앱 폴더가 아니라 `~/discord-bot-data`에 저장됩니다.
- `daily-chess-puzzle.json`이 없으면 `/일일퍼즐지정` 실행 후 생성될 수 있습니다.
- `[Lichess opening book] preload failed ... fetch failed` 로그는 외부 fetch 실패일 수 있으며, 헬스 체크가 정상이면 배포 자체 실패와는 별개일 수 있습니다.
- 브라우저 SSH heredoc 붙여넣기 중간에 텍스트가 섞여 보이면 paste corruption일 수 있습니다. 이번 흐름에서는 `discord-bot-vm-deploy.sh` 업로드 실행을 우선 사용하세요.
