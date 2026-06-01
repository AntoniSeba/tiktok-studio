// PM2 process config — keeps TikTok Studio alive 24/7 on the VPS so the
// cron digests/reminders actually fire. Start with:  pm2 start ecosystem.config.js
module.exports = {
  apps: [{
    name: 'tiktok-studio',
    script: 'src/server.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '300M',
    env: { NODE_ENV: 'production' },
    // .env is loaded by dotenv inside the app; PM2 just needs the working dir.
    out_file: 'logs/out.log',
    error_file: 'logs/err.log',
    time: true
  }]
};
