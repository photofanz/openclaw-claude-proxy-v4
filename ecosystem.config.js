// PM2 process manager config
// Usage: pm2 start ecosystem.config.js

const dotenv = require('fs').existsSync('.env')
  ? Object.fromEntries(
      require('fs').readFileSync('.env', 'utf8')
        .split('\n')
        .filter(l => l.trim() && !l.startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    )
  : {};

module.exports = {
  apps: [{
    name: 'openclaw-claude-proxy',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production',
      ...dotenv,
    },
  }],
};
