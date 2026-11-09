const { defineConfig } = require('@playwright/test');
const path = require('node:path');
// Browser tests never use the saved demo database or application ports.
process.env.TEST_API_URL = 'http://127.0.0.1:9001';
process.env.TEST_MONGO_URI = 'mongodb://127.0.0.1:27019/?replicaSet=pa3rs';
process.env.TEST_DB_NAME = 'pa3_ui_test';
module.exports = defineConfig({
  testDir: './tests', testMatch: ['ui.spec.js', 'stories-ui.spec.js'], fullyParallel: false, workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5174', browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL || undefined, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run demo', url: 'http://127.0.0.1:5174', reuseExistingServer: false, timeout: 180000,
    env: { ...process.env, PA3_API_PORT: '9001', PA3_FRONTEND_PORT: '5174', PA3_MONGO_PORT: '27019', PA3_DB_NAME: 'pa3_ui_test', PA3_DATA_DIR: path.resolve(__dirname, '.local-data', 'ui-test') },
  },
});
