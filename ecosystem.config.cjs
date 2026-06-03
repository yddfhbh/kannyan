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
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: '8080',
        ...linuxFontconfigEnv,
      },
    },
  ],
};
