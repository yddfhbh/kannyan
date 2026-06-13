$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$archiveName = "discord-bot-vm.tar.gz"
$archivePath = Join-Path $projectRoot $archiveName

$includePaths = @(
  "src",
  "assets",
  "scripts",
  "package.json",
  "package-lock.json",
  "ecosystem.config.cjs",
  ".env.example",
  "VM_DEPLOY.md",
  "README.md"
)

$optionalIncludePaths = @(
  "data/tetrio-league-cache.json"
)

Push-Location $projectRoot
try {
  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
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

  Write-Host ""
  Write-Host "Created: $($archive.FullName)"
  Write-Host "Size: $($archive.Length) bytes"
  Write-Host ""
  Write-Host "Upload this file in the Google Cloud browser SSH window:"
  Write-Host "  $archiveName"
  Write-Host ""
  Write-Host "Then run these commands on the VM:"
  Write-Host ""
  Write-Host 'cd ~'
  Write-Host 'ARCHIVE=discord-bot-vm.tar.gz'
  Write-Host 'APP_DIR=discord-bot-new'
  Write-Host 'DATA_DIR="$HOME/discord-bot-data"'
  Write-Host 'ENV_BACKUP="$HOME/discord-bot.env"'
  Write-Host ''
  Write-Host '# Stop old bot'
  Write-Host 'pm2 delete discord-bot || true'
  Write-Host 'pkill -f "[d]iscord-bot/src/index.js" || true'
  Write-Host 'pkill -f "[d]iscord-bot-new/src/index.js" || true'
  Write-Host ''
  Write-Host '# Preserve the current environment file outside the replaceable app directory'
  Write-Host 'if [ -f "$APP_DIR/.env" ]; then cp "$APP_DIR/.env" "$ENV_BACKUP"; fi'
  Write-Host ''
  Write-Host '# Preserve old persistent data if it was stored inside old app folders'
  Write-Host 'mkdir -p "$DATA_DIR"'
  Write-Host 'if [ -d "$APP_DIR/data" ] && [ ! -L "$APP_DIR/data" ]; then cp -a "$APP_DIR/data/." "$DATA_DIR/" 2>/dev/null || true; fi'
  Write-Host 'if [ -d "$HOME/discord-bot/data" ] && [ ! -L "$HOME/discord-bot/data" ]; then cp -a "$HOME/discord-bot/data/." "$DATA_DIR/" 2>/dev/null || true; fi'
  Write-Host ''
  Write-Host '# Recreate app directory'
  Write-Host 'if [ -d "$APP_DIR" ]; then sudo chown -R "$USER:$USER" "$APP_DIR" 2>/dev/null || true; chmod -R u+rwX "$APP_DIR" 2>/dev/null || true; fi'
  Write-Host 'rm -rf "$APP_DIR" || sudo rm -rf "$APP_DIR"'
  Write-Host 'mkdir "$APP_DIR"'
  Write-Host 'tar -xzf "$ARCHIVE" -C "$APP_DIR"'
  Write-Host 'cd "$APP_DIR"'
  Write-Host ''
  Write-Host '# Seed the persistent leaderboard cache only when the VM has no saved copy'
  Write-Host 'if [ -f data/tetrio-league-cache.json ] && [ ! -f "$DATA_DIR/tetrio-league-cache.json" ]; then cp data/tetrio-league-cache.json "$DATA_DIR/"; fi'
  Write-Host ''
  Write-Host '# Link persistent data directory'
  Write-Host 'rm -rf data'
  Write-Host 'ln -sfn "$DATA_DIR" data'
  Write-Host 'export TETRIO_LEAGUE_DATA_DIR="$DATA_DIR"'
  Write-Host ''
  Write-Host '# Copy existing .env if needed'
  Write-Host 'if [ ! -f .env ] && [ -f "$ENV_BACKUP" ]; then cp "$ENV_BACKUP" .env; fi'
  Write-Host 'if [ ! -f .env ] && [ -f "$HOME/discord-bot/.env" ]; then cp "$HOME/discord-bot/.env" .env; fi'
  Write-Host '# If .env still does not exist, create it with: nano .env'
  Write-Host ''
  Write-Host '# Install system packages'
  Write-Host 'sudo apt update'
  Write-Host 'sudo apt install -y curl zstd fontconfig fonts-dejavu-core fonts-noto-core fonts-noto-extra fonts-noto-cjk'
  Write-Host 'sudo fc-cache -f'
  Write-Host 'fc-match "Noto Sans CJK KR" || true'
  Write-Host ''
  Write-Host '# Install node dependencies'
  Write-Host 'npm ci --omit=dev'
  Write-Host ''
  Write-Host '# Build Lichess puzzle pool if missing'
  Write-Host 'if [ ! -f data/lichess_db_puzzle.csv.zst ]; then curl -L https://database.lichess.org/lichess_db_puzzle.csv.zst -o data/lichess_db_puzzle.csv.zst; fi'
  Write-Host 'if [ ! -f data/lichess-puzzle-pool.jsonl ]; then LICHESS_PUZZLE_MIN_RATING=2000 LICHESS_PUZZLE_MAX_RATING=2600 LICHESS_PUZZLE_MAX_RD=120 LICHESS_PUZZLE_MIN_POPULARITY=60 LICHESS_PUZZLE_MIN_PLAYS=30 zstd -dc data/lichess_db_puzzle.csv.zst | node scripts/build-lichess-puzzle-pool.js; fi'
  Write-Host 'wc -l data/lichess-puzzle-pool.jsonl || true'
  Write-Host ''
  Write-Host '# Register slash commands'
  Write-Host 'npm run register'
  Write-Host ''
  Write-Host '# Start bot'
  Write-Host 'TETRIO_LEAGUE_DATA_DIR="$DATA_DIR" pm2 start ecosystem.config.cjs --name discord-bot --update-env'
  Write-Host 'pm2 save'
  Write-Host 'pm2 status'
  Write-Host 'sleep 3'
  Write-Host 'curl -s http://127.0.0.1:8080/health || true'
  Write-Host ''
  Write-Host 'echo ""'
  Write-Host 'echo "Persistent data directory:"'
  Write-Host 'echo "$DATA_DIR"'
  Write-Host 'ls -lah "$DATA_DIR"'
  Write-Host ""
  Write-Host "Note: .env is not included in the archive."
  Write-Host "Note: persistent bot data is stored on the VM at ~/discord-bot-data."
}
finally {
  Pop-Location
}
