/**
 * PM2 process definition. Referenced by deploy.sh:
 *   pm2 startOrReload deploy/ecosystem.config.cjs --update-env
 */
module.exports = {
  apps: [
    {
      name: 'careerforge-api',
      script: 'server/src/index.js',
      cwd: '/var/www/careerforge',
      interpreter: 'node',
      // Cron jobs live in-process, so exactly one instance must run —
      // clustering here would send every student their digest N times.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '400M',
      min_uptime: '10s',
      max_restarts: 10,
      env: { NODE_ENV: 'production' },
      error_file: '/var/log/careerforge/error.log',
      out_file: '/var/log/careerforge/out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
