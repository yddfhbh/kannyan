const os = require('node:os');
const path = require('node:path');

const linuxFontconfigEnv = process.platform === 'linux'
  ? {
      FONTCONFIG_PATH: '/etc/fonts',
      FONTCONFIG_FILE: '/etc/fonts/fonts.conf',
    }
  : {};

module.exports = {
  apps: [
    {
      name: 'discord-bot',
      script: 'src/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '4G',
      env: {
        NODE_ENV: 'production',
        PORT: '8080',
        TETRIO_LEAGUE_DATA_DIR: process.env.TETRIO_LEAGUE_DATA_DIR
          || path.join(os.homedir(), 'discord-bot-data'),

        CHESS_IMAGE_PYTHON: process.env.CHESS_IMAGE_PYTHON
          || path.join(__dirname, '.venv-chess', 'bin', 'python'),

        ...linuxFontconfigEnv,
      },
    },
  ],
};