import { chromium } from '@playwright/test';

console.log('1. Starting Playwright...');

const context = await chromium.launchPersistentContext(
  'C:\\Users\\54642\\AppData\\Local\\Google\\Chrome\\User Data',
  {
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false,
    args: ['--profile-directory=Default'],
  }
);

console.log('2. Chrome launched successfully');

const page = context.pages()[0] || await context.newPage();

console.log('3. Page created');
console.log('4. Navigating to Spandan...');

try {
  await page.goto('https://chatflow.mannmate.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  console.log('5. Navigation completed');
  console.log('URL:', page.url());
  console.log('TITLE:', await page.title());
} catch (error) {
  console.log('6. NAVIGATION ERROR:');
  console.log(error.message);
}

console.log('7. Browser will stay open.');
console.log('Press Ctrl+C to stop.');

await new Promise(() => {});