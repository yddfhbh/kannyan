# Google Compute Engine VM Deployment

Use this when running the bot on a regular Google Cloud VM through browser SSH.

## 1. Upload the project

In the browser SSH window, click **File upload** and upload `discord-bot-vm.zip`.

Then run:

```bash
unzip discord-bot-vm.zip -d discord-bot
cd discord-bot
```

## 2. Install Node.js

Check if Node is already installed:

```bash
node -v
npm -v
```

If Node is missing or older than 18, install Node.js 22:

```bash
sudo apt update
sudo apt install -y curl unzip
curl -fsSL https://deb.nodesource.com/setup_22.x -o nodesource_setup.sh
sudo -E bash nodesource_setup.sh
sudo apt install -y nodejs
node -v
npm -v
```

### If `sudo` is not allowed

Some VM users do not have administrator privileges. If you see a message like `I'm afraid I can't do that`, install Node.js in your home directory with `nvm` instead:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 22
nvm use 22
node -v
npm -v
```

## 3. Install Korean-capable fonts

`sharp` renders the profile card from SVG, so the VM needs fonts that include Korean glyphs. Install Noto CJK once on the VM:

```bash
sudo apt update
sudo apt install -y fontconfig fonts-dejavu-core fonts-noto-cjk
sudo fc-cache -f
fc-match "Noto Sans CJK KR"
```

If `sudo` is not allowed, ask the VM owner/admin to install those packages. Without a system font that supports Korean, SVG text may render as square boxes.

## 4. Install dependencies

```bash
npm ci --omit=dev
sudo apt install -y python3 python3-pip python3-venv
python3 -m venv "$HOME/discord-bot-chess-venv"
"$HOME/discord-bot-chess-venv/bin/pip" install --upgrade pip
"$HOME/discord-bot-chess-venv/bin/pip" install \
  --index-url https://download.pytorch.org/whl/cpu \
  --extra-index-url https://pypi.org/simple \
  torch torchvision
"$HOME/discord-bot-chess-venv/bin/pip" install -r requirements-chess.txt
```

## 5. Create `.env`

Use an editor so your bot token is not saved in shell history:

```bash
nano .env
```

Paste:

```env
DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN
CLIENT_ID=1502588698246778960
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GEMINI_MODEL=gemini-3.5-flash
GEMINI_FALLBACK_MODELS=gemini-2.5-flash,gemini-2.5-flash-lite
GUILD_ID=1219197226572840990
CHESS_IMAGE_PYTHON=/home/YOUR_USER/discord-bot-chess-venv/bin/python
```

Save with `Ctrl+O`, press `Enter`, then exit with `Ctrl+X`.

## 6. Register slash commands

```bash
npm run register
```

`npm run register` registers global commands and clears server-only commands for `GUILD_ID` to avoid duplicates.

## 7. Run with PM2

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

The `pm2 startup` command prints one extra `sudo env ... pm2 startup ...` command. Copy and run that printed command once, then run:

```bash
pm2 save
```

If `sudo` is not allowed and you installed Node with `nvm`, install PM2 without `sudo`:

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
```

Without `sudo`, PM2 cannot install a system service. Use a user crontab instead:

```bash
crontab -e
```

Add this line, replacing `YOUR_USER` with your Linux username:

```cron
@reboot /home/YOUR_USER/.nvm/versions/node/v22.*/bin/pm2 resurrect
```

## Useful commands

```bash
pm2 status
pm2 logs discord-bot
pm2 restart discord-bot
pm2 stop discord-bot
```
