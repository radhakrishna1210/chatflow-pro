import { defineConfig } from '@playwright/test';

// Targets a local dev server unless E2E_BASE_URL says otherwise. It used to
// default to the production site, so a bare `npx playwright test` drove live
// traffic; point it at a deployment only deliberately.
export default defineConfig({
  testDir: './tests',

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    headless: !process.env.E2E_HEADED,
    channel: 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  reporter: 'html',
});
