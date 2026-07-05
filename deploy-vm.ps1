$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$archiveName = "discord-bot-vm.tar.gz"
$archivePath = Join-Path $projectRoot $archiveName
$deployScriptName = "discord-bot-vm-deploy.sh"
$deployScriptPath = Join-Path $projectRoot $deployScriptName

$includePaths = @(
  "src",
  "assets",
  "scripts",
  "package.json",
  "package-lock.json",
  "requirements-chess.txt",
  "ecosystem.config.cjs",
  ".env.example",
  "VM_DEPLOY.md",
  "README.md"
)

$optionalIncludePaths = @(
  "data/tetrio-league-cache.json",
  "data/lichess-player-opening-manual-book.json"
)

$deployScriptBody = @'
cd ~
set -euo pipefail

ARCHIVE=discord-bot-vm.tar.gz
APP_DIR=discord-bot-new
OLD_APP_DIR=discord-bot
DATA_DIR="$HOME/discord-bot-data"
BACKUP_DIR="$HOME/discord-bot-backups"
ENV_BACKUP="$HOME/.discord-bot.env"

if [ ! -f "$ARCHIVE" ]; then
  echo "discord-bot-vm.tar.gz is missing. Upload the archive to the VM home directory first."
  exit 1
fi

echo "[1/12] Backing up .env..."
if [ -r "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env" "$ENV_BACKUP"
elif [ -r "$OLD_APP_DIR/.env" ]; then
  cp "$OLD_APP_DIR/.env" "$ENV_BACKUP"
fi

echo "[2/12] Stopping old bot..."
pm2 delete discord-bot || true
pkill -f "[d]iscord-bot/src/index.js" || true
pkill -f "[d]iscord-bot-new/src/index.js" || true

echo "[3/12] Preparing persistent data dir..."
mkdir -p "$DATA_DIR"
mkdir -p "$BACKUP_DIR"

TS="$(date +%Y%m%d-%H%M%S)"

if [ -e "$APP_DIR/data" ]; then
  cp -a "$APP_DIR/data" "$BACKUP_DIR/data-from-$APP_DIR-$TS" 2>/dev/null || true
fi

if [ -e "$OLD_APP_DIR/data" ]; then
  cp -a "$OLD_APP_DIR/data" "$BACKUP_DIR/data-from-$OLD_APP_DIR-$TS" 2>/dev/null || true
fi

cp -a "$DATA_DIR" "$BACKUP_DIR/data-persistent-$TS" 2>/dev/null || true

echo "[4/12] Merging daily chess state if old app data exists..."
node --input-type=module - <<'NODE_EOF'
import fs from 'node:fs/promises';

const paths = [
  '/home/ubuntu/discord-bot-data/daily-chess-puzzle.json',
  '/home/ubuntu/discord-bot-new/data/daily-chess-puzzle.json',
  '/home/ubuntu/discord-bot/data/daily-chess-puzzle.json',
];

async function readJson(path) {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8'));
  } catch {
    return {};
  }
}

function mergeState(base, next) {
  return {
    ...base,
    ...next,
    settings: {
      ...(base.settings ?? {}),
      ...(next.settings ?? {}),
      guilds: {
        ...(base.settings?.guilds ?? {}),
        ...(next.settings?.guilds ?? {}),
      },
    },
    posts: {
      ...(base.posts ?? {}),
      ...(next.posts ?? {}),
    },
    solved: {
      ...(base.solved ?? {}),
      ...(next.solved ?? {}),
    },
    sessions: {
      ...(base.sessions ?? {}),
      ...(next.sessions ?? {}),
    },
  };
}

let merged = {};

for (const path of paths) {
  merged = mergeState(merged, await readJson(path));
}

merged.settings ??= {};
merged.settings.guilds ??= {};
merged.posts ??= {};
merged.solved ??= {};
merged.sessions ??= {};

await fs.mkdir('/home/ubuntu/discord-bot-data', { recursive: true });

if (
  Object.keys(merged.settings.guilds).length > 0 ||
  Object.keys(merged.posts).length > 0 ||
  Object.keys(merged.solved).length > 0 ||
  Object.keys(merged.sessions).length > 0
) {
  await fs.writeFile(
    '/home/ubuntu/discord-bot-data/daily-chess-puzzle.json',
    JSON.stringify(merged, null, 2),
    'utf8'
  );

  console.log('Merged daily-chess-puzzle.json');
  console.log(JSON.stringify(merged.settings.guilds, null, 2));
} else {
  console.log('No existing daily chess state to merge.');
}
NODE_EOF

echo "[5/12] Copying other old data files without overwriting persistent data..."
if [ -d "$APP_DIR/data" ] && [ ! -L "$APP_DIR/data" ]; then
  find "$APP_DIR/data" -mindepth 1 -maxdepth 1 ! -name daily-chess-puzzle.json -exec cp -an {} "$DATA_DIR"/ \; 2>/dev/null || true
fi

if [ -d "$OLD_APP_DIR/data" ] && [ ! -L "$OLD_APP_DIR/data" ]; then
  find "$OLD_APP_DIR/data" -mindepth 1 -maxdepth 1 ! -name daily-chess-puzzle.json -exec cp -an {} "$DATA_DIR"/ \; 2>/dev/null || true
fi

echo "[6/12] Recreating app dir..."
if [ -d "$APP_DIR" ]; then
  sudo chown -R "$USER:$USER" "$APP_DIR" 2>/dev/null || true
  sudo chmod -R u+rwX "$APP_DIR" 2>/dev/null || true
fi

rm -rf "$APP_DIR" 2>/dev/null || sudo rm -rf "$APP_DIR"
mkdir "$APP_DIR"
tar -xzf "$ARCHIVE" -C "$APP_DIR"
rm -f "$ARCHIVE"

if [ ! -f "$APP_DIR/package.json" ]; then
  echo "Archive extraction failed. package.json is missing under $APP_DIR."
  exit 1
fi

cd "$APP_DIR"

echo "[7/12] Linking persistent data dir..."
if [ -f data/lichess-player-opening-manual-book.json ]; then
  cp -f data/lichess-player-opening-manual-book.json "$DATA_DIR"/
  echo "Seeded lichess-player-opening-manual-book.json into persistent data dir."
fi

rm -rf data
ln -sfn "$DATA_DIR" data

echo "data link:"
ls -ld data
echo "real data path:"
readlink -f data

if [ ! -f scripts/build-lichess-puzzle-pool.js ]; then
  echo "scripts/build-lichess-puzzle-pool.js is missing. Check whether the scripts directory was included in the tarball."
  exit 1
fi

if grep -R -n --include='*.js' --include='*.mjs' --include='*.cjs' 'Replies with Pong\|commandName === '\''ping'\''\|commandName === "ping"' src; then
  echo "Legacy ping code is still present. Aborting deploy."
  exit 1
fi

echo "[8/12] Restoring .env..."
if [ -r "$ENV_BACKUP" ]; then
  cp "$ENV_BACKUP" .env
fi

if [ ! -f .env ]; then
  echo ".env is missing, so a new one will be created now."
  echo "Input stays hidden. Paste the value and press Enter."
  read -r -s -p "Enter DISCORD_TOKEN: " DISCORD_TOKEN_VALUE </dev/tty
  echo
  cat > .env <<ENV_EOF
DISCORD_TOKEN=$DISCORD_TOKEN_VALUE
CLIENT_ID=1502588698246778960

ENV_EOF
fi

if ! grep -E '^(GEMINI_API_KEYS|GEMMA_API_KEYS|GEMINI_API_KEY|GEMMA_API_KEY)=' .env | cut -d= -f2- | grep -q '[^[:space:]]'; then
  echo "Gemma/Gemini API keys are missing from .env, so they will be added now."
  echo "If you want fallback keys too, separate them with commas."
  echo "Example: primary-key,fallback-key-1,fallback-key-2"
  echo "Input stays hidden. Paste the value and press Enter."
  read -r -s -p "Enter GEMINI_API_KEYS: " GEMINI_API_KEYS_VALUE </dev/tty
  echo
  printf '\nGEMINI_API_KEYS=%s\n' "$GEMINI_API_KEYS_VALUE" >> .env
fi

if ! grep -q '^GEMMA_MODEL=' .env && ! grep -q '^GEMINI_MODEL=' .env; then
  echo "GEMMA_MODEL=gemma-4-26b-a4b-it" >> .env
fi

if ! grep -q '^GEMMA_FALLBACK_MODELS=' .env && ! grep -q '^GEMINI_FALLBACK_MODELS=' .env; then
  echo "GEMMA_FALLBACK_MODELS=gemma-4-31b-it" >> .env
fi

if ! grep -q '^DAILY_CHESS_PUZZLE_HOUR=' .env; then
  echo "DAILY_CHESS_PUZZLE_HOUR=0" >> .env
fi

cp .env "$ENV_BACKUP"

echo "[9/12] Installing system packages..."
sudo apt update
sudo apt install -y \
  curl \
  zstd \
  fontconfig \
  fonts-dejavu-core \
  fonts-noto-core \
  fonts-noto-extra \
  fonts-noto-cjk \
  fonts-noto-color-emoji

sudo fc-cache -f -v >/dev/null || true

echo "[10/12] Installing node dependencies..."
npm ci --omit=dev

echo "[11/12] Checking/building Lichess puzzle pools..."
if [ ! -f data/lichess-puzzle-pool.jsonl ]; then
  echo "lichess-puzzle-pool.jsonl is missing. Rebuilding it now."

  if [ ! -f data/lichess_db_puzzle.csv.zst ]; then
    echo "Downloading the Lichess puzzle DB..."
    curl -L https://database.lichess.org/lichess_db_puzzle.csv.zst -o data/lichess_db_puzzle.csv.zst
  fi

  LICHESS_PUZZLE_MIN_RATING=2600 \
  LICHESS_PUZZLE_MAX_RATING=3400 \
  LICHESS_PUZZLE_MAX_RD=120 \
  LICHESS_PUZZLE_MIN_POPULARITY=60 \
  LICHESS_PUZZLE_MIN_PLAYS=30 \
  zstd -dc data/lichess_db_puzzle.csv.zst | node scripts/build-lichess-puzzle-pool.js
else
  echo "Using the existing lichess-puzzle-pool.jsonl."
fi

echo "Rebuilding lichess-puzzle-rush-pool.jsonl."

if [ ! -f data/lichess_db_puzzle.csv.zst ]; then
  echo "Downloading the Lichess puzzle DB..."
  curl -L https://database.lichess.org/lichess_db_puzzle.csv.zst -o data/lichess_db_puzzle.csv.zst
fi

zstd -dc data/lichess_db_puzzle.csv.zst | node scripts/build-lichess-puzzle-rush-pool.js

echo "Puzzle pool line counts:"
wc -l data/lichess-puzzle-pool.jsonl || true
wc -l data/lichess-puzzle-rush-pool.jsonl || true

echo "[12/12] Registering commands and starting bot..."
npm run register

node --check src/daily-chess-puzzle.js
node --check src/index.js

if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2 || npm install -g pm2
fi

pm2 start ecosystem.config.cjs --name discord-bot --update-env
pm2 save
pm2 status

sleep 3

echo "Health:"
curl -s http://127.0.0.1:8080/health || true
echo

echo "Daily chess state:"
node --input-type=module - <<'NODE_EOF'
import fs from 'node:fs/promises';

try {
  const state = JSON.parse(await fs.readFile('data/daily-chess-puzzle.json', 'utf8'));
  console.log('guild settings:');
  console.log(JSON.stringify(state.settings?.guilds ?? {}, null, 2));
  console.log('posts keys:', Object.keys(state.posts ?? {}));
  console.log('sessions keys:', Object.keys(state.sessions ?? {}));
} catch (error) {
  if (error.code === 'ENOENT') {
    console.log('daily-chess-puzzle.json is missing. It will be created after setting the daily puzzle channel.');
  } else {
    throw error;
  }
}
NODE_EOF

echo
echo "Persistent data dir:"
echo "$DATA_DIR"
ls -lah "$DATA_DIR"

echo
pm2 logs discord-bot --lines 80 --nostream || true
'@

$deployScript = @"
bash <<'DEPLOY_EOF'
$deployScriptBody
DEPLOY_EOF
"@

Push-Location $projectRoot
try {
  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }

  if (Test-Path -LiteralPath $deployScriptPath) {
    Remove-Item -LiteralPath $deployScriptPath -Force
  }

  $missing = $includePaths | Where-Object { -not (Test-Path -LiteralPath (Join-Path $projectRoot $_)) }
  if ($missing.Count -gt 0) {
    throw "Missing required path(s): $($missing -join ', ')"
  }

  $existingOptionalPaths = $optionalIncludePaths | Where-Object {
    Test-Path -LiteralPath (Join-Path $projectRoot $_)
  }
  $archivePaths = $includePaths + $existingOptionalPaths

  tar -czf $archiveName @archivePaths

  $archive = Get-Item -LiteralPath $archivePath
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($deployScriptPath, $deployScriptBody, $utf8NoBom)
  $deployScriptFile = Get-Item -LiteralPath $deployScriptPath

  Write-Host ""
  Write-Host "Created: $($archive.FullName)"
  Write-Host "Size: $($archive.Length) bytes"
  Write-Host "Created: $($deployScriptFile.FullName)"
  Write-Host "Size: $($deployScriptFile.Length) bytes"
  Write-Host ""
  Write-Host "1. Upload these files in the Google Cloud browser SSH window:"
  Write-Host "   $archiveName"
  Write-Host "   $deployScriptName"
  Write-Host ""
  Write-Host "2. Run this in the VM shell:"
  Write-Host ""
  Write-Host "   bash ~/$deployScriptName"
  Write-Host ""
  Write-Host "3. Fallback only if you cannot upload the .sh file: paste this heredoc in the VM shell:"
  Write-Host ""
  Write-Host $deployScript
  Write-Host ""
  Write-Host "Note: .env is not included in the archive."
  Write-Host "Note: persistent bot data is stored on the VM at ~/discord-bot-data."
}
finally {
  Pop-Location
}
