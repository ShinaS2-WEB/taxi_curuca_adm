import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4175/taxi_curuca_adm/', channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true },
  webServer: { command: 'node scripts/serve.js dist', url: 'http://127.0.0.1:4175/taxi_curuca_adm/', env: { PORT: '4175', SITE_PREFIX: '/taxi_curuca_adm/' }, reuseExistingServer: false },
});
