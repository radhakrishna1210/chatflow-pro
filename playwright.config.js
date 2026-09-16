import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',

  use: {
    baseURL: 'https://chatflow.mannmate.com',
    headless: false,
    channel: 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  reporter: 'html',
});