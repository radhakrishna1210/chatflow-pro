import { test, expect } from '@playwright/test';

test('Svann website loads successfully', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Svann/i);

  console.log('Svann loaded successfully');
});