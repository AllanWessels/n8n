#!/usr/bin/env node
// Renders README.md -> docs/README.pdf using the local Chromium (playwright-core)
// and `marked`. Self-contained; avoids md-to-pdf's bundled-puppeteer download.
// Relative image paths (docs/img/*.png) resolve because we write the temp HTML
// at the repo root and load it over file://.
import { chromium } from 'playwright-core';
import { marked } from 'marked';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const EXE = process.env.CHROME_PATH ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1148/chrome-linux/chrome`;

const md = readFileSync('README.md', 'utf8');
const body = marked.parse(md);
const css = `
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
         color:#1f2328; line-height:1.55; max-width:900px; margin:0 auto; padding:24px 32px; font-size:13px; }
  h1 { font-size:26px; border-bottom:1px solid #d0d7de; padding-bottom:.3em; }
  h2 { font-size:20px; border-bottom:1px solid #d0d7de; padding-bottom:.3em; margin-top:28px; }
  h3 { font-size:16px; margin-top:22px; }
  code { background:#eff1f3; padding:.15em .35em; border-radius:5px; font-size:85%;
         font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  pre { background:#f6f8fa; padding:14px; border-radius:8px; overflow:auto; }
  pre code { background:none; padding:0; }
  table { border-collapse:collapse; width:100%; margin:14px 0; font-size:12px; display:table; }
  th,td { border:1px solid #d0d7de; padding:7px 10px; text-align:left; vertical-align:top; }
  th { background:#f6f8fa; }
  img { max-width:100%; border-radius:8px; margin:10px 0; }
  a { color:#0969da; text-decoration:none; }
  blockquote { border-left:4px solid #d0d7de; margin:0; padding:0 1em; color:#59636e; }
`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;

const tmp = resolve('.readme-print.html');
writeFileSync(tmp, html);
try {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle' });
  await page.pdf({ path: 'docs/README.pdf', format: 'A4', printBackground: true,
    margin: { top: '14mm', bottom: '14mm', left: '10mm', right: '10mm' } });
  await browser.close();
  console.log('wrote docs/README.pdf');
} finally {
  unlinkSync(tmp);
}
