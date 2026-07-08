#!/usr/bin/env node
// Renders the bespoke architecture figure (docs/img/architecture.html) to a
// crisp PNG via headless Chromium. Self-contained framed diagram so it looks
// designed on GitHub's dark or light backdrop. `make graph` can call this.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const EXE = process.env.CHROME_PATH ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1148/chrome-linux/chrome`;
const IN = resolve('docs/img/architecture.html');
const OUT = 'docs/img/architecture.png';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--force-color-profile=srgb'] });
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.goto(pathToFileURL(IN).href, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
const el = page.locator('#fig');
await el.screenshot({ path: OUT });
const box = await el.boundingBox();
console.log(`wrote ${OUT} (${Math.round(box.width)}x${Math.round(box.height)})`);
await browser.close();
