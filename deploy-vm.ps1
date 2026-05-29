$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$archiveName = "discord-bot-vm.tar.gz"
$archivePath = Join-Path $projectRoot $archiveName

$includePaths = @(
  "src",
  "assets",
  "package.json",
  "package-lock.json",
  "ecosystem.config.cjs",
  ".env.example",
  "VM_DEPLOY.md",
  "README.md"
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

  tar -czf $archiveName @includePaths

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
  Write-Host 'pm2 delete discord-bot || true'
  Write-Host 'pkill -f "[d]iscord-bot/src/index.js" || true'
  Write-Host 'pkill -f "[d]iscord-bot-new/src/index.js" || true'
  Write-Host 'if [ -d "$APP_DIR" ]; then sudo chown -R "$USER:$USER" "$APP_DIR" 2>/dev/null || true; fi'
  Write-Host 'rm -rf "$APP_DIR" || sudo rm -rf "$APP_DIR"'
  Write-Host 'mkdir "$APP_DIR"'
  Write-Host 'tar -xzf "$ARCHIVE" -C "$APP_DIR"'
  Write-Host 'cd "$APP_DIR"'
  Write-Host "# Run once on the VM if TETR.IO card text appears as square boxes:"
  Write-Host "sudo apt update && sudo apt install -y fontconfig fonts-dejavu-core fonts-noto-cjk && sudo fc-cache -f && fc-match ""Noto Sans CJK KR"""
  Write-Host "# If .env does not exist yet, create it with: cat > .env"
  Write-Host "# Or copy an existing one with: cp ~/discord-bot/.env ~/discord-bot-new/.env"
  Write-Host "npm ci --omit=dev"
  Write-Host "npm run register"
  Write-Host "pm2 start ecosystem.config.cjs --name discord-bot --update-env"
  Write-Host "pm2 save"
  Write-Host "pm2 status"
  Write-Host "sleep 3"
  Write-Host "curl -s http://127.0.0.1:8080/health"
  Write-Host ""
  Write-Host "Note: .env is not included in the archive."
}
finally {
  Pop-Location
}
