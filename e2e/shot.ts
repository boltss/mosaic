// Quick screenshot helper: bun e2e/shot.ts <url> <out.png> [width] [height] [waitMs]
import { chromium } from 'playwright-core';
const [url, outputPath, width = '1440', height = '900', waitMilliseconds = '2500'] = process.argv.slice(2);
const executablePath = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: +width, height: +height } });
const logs: string[] = [];
page.on('console', message => logs.push(`${message.type()}: ${message.text()}`));
page.on('pageerror', error => logs.push(`pageerror: ${error.message}`));
await page.goto(url!);
await page.waitForTimeout(+waitMilliseconds);
await page.screenshot({ path: outputPath! });
console.log(logs.join('\n') || 'no console output');
await browser.close();
