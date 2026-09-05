import { test } from '@playwright/test';

test('Discover Spandan pages and UI', async ({ page }) => {
  await page.goto('/');

  console.log('\n===== SPANDAN DISCOVERY =====');

  console.log('\n--- LINKS ---');
  const links = await page.locator('a').allTextContents();
  console.log(links);

  console.log('\n--- BUTTONS ---');
  const buttons = await page.locator('button').allTextContents();
  console.log(buttons);

  console.log('\n--- INPUTS ---');
  const inputs = await page.locator('input').evaluateAll(elements =>
    elements.map(el => ({
      type: el.type,
      name: el.name,
      placeholder: el.placeholder,
      ariaLabel: el.getAttribute('aria-label')
    }))
  );
  console.log(inputs);

  console.log('\n--- CURRENT URL ---');
  console.log(page.url());

  console.log('\n--- TITLE ---');
  console.log(await page.title());

  console.log('\n===== END DISCOVERY =====');
});