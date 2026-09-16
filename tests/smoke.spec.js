import { test, expect } from '@playwright/test';

test('Spandan website loads successfully', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Spandan/i);

  console.log('Spandan loaded successfully');
});