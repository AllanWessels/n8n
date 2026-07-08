#!/usr/bin/env node
// Renders authentic n8n canvas PNGs by driving a real, running n8n instance
// (docker compose) with a headless Chromium. This is the "let n8n draw its own
// graph" path: we import the workflow JSON, open the actual editor canvas, fit
// it to view, and screenshot the Vue-Flow pane — so the output is exactly what
// a user sees in n8n, with real node icons, colors, and connectors.
import { chromium } from 'playwright-core';

const EXE = process.env.CHROME_PATH ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1148/chrome-linux/chrome`;
const BASE = process.env.N8N_BASE || 'http://localhost:5678';
const EMAIL = process.env.N8N_EMAIL || 'demo@example.com';
const PASSWORD = process.env.N8N_PASSWORD || 'Demo-Pass-12345';

// Resolve the NEWEST workflow for each canonical name so a re-import can never
// leave us rendering a stale duplicate. [nameSubstring, outputFile, label]
const WANTED = [
  ['Market-Signal', 'docs/img/n8n-flagship.png', 'flagship'],
  ['Decision Framework', 'docs/img/n8n-framework.png', 'framework'],
  ['Warm-up', 'docs/img/n8n-warmup.png', 'warmup'],
];

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
});
const ctx = await browser.newContext({
  viewport: { width: 2200, height: 1400 },
  deviceScaleFactor: 2,
});
// Use n8n's real dark theme so node cards render dark (low-contrast, cohesive
// with the Architecture figure) and labels are light — set before the app boots.
await ctx.addInitScript(() => { try { localStorage.setItem('N8N_THEME', 'dark'); } catch { /* ignore */ } });

// Authenticate via REST; cookies land in the shared context jar.
const login = await ctx.request.post(`${BASE}/rest/login`, {
  data: { emailOrLdapLoginId: EMAIL, email: EMAIL, password: PASSWORD },
});
if (!login.ok()) throw new Error(`login failed: ${login.status()} ${await login.text()}`);
console.log('login ok');

// Fetch workflow list and pick the newest id for each wanted name.
const listRes = await ctx.request.get(`${BASE}/rest/workflows`);
const list = (await listRes.json()).data || [];
const byNewest = (sub) => list
  .filter((w) => w.name.includes(sub))
  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
const TARGETS = WANTED.map(([sub, out, label]) => {
  const wf = byNewest(sub);
  if (!wf) throw new Error(`no workflow matching "${sub}"`);
  return [wf.id, out, label];
});
console.log('resolved:', TARGETS.map(([id, , l]) => `${l}=${id}`).join(' '));

const page = await ctx.newPage();

for (const [id, out, label] of TARGETS) {
  console.log(`\n--- ${label} (${id}) ---`);
  await page.goto(`${BASE}/workflow/${id}`, { waitUntil: 'networkidle' });
  // Wait for the real Vue-Flow canvas nodes to mount.
  await page.waitForSelector('.vue-flow__node', { timeout: 30000 });
  await page.waitForTimeout(1500);

  // Theme the canvas to match docs/img/architecture.html: a navy gradient
  // backdrop and translucent navy stage panels (instead of n8n's default sticky
  // colour). Dark mode already handles the node cards + light labels, so we only
  // restyle the background and the sticky-note group panels here.
  await page.addStyleTag({ content: `
    .vue-flow__background {
      background:
        radial-gradient(1200px 500px at 20% -10%, rgba(59,130,246,.16), transparent 60%),
        radial-gradient(1000px 500px at 95% 5%, rgba(167,139,250,.14), transparent 55%),
        linear-gradient(180deg,#0b1220 0%, #0a0f1a 100%) !important;
    }
    .vue-flow__background circle { fill: rgba(255,255,255,0.05) !important; }
    .vue-flow__node [class*="sticky"] {
      background: linear-gradient(180deg, rgba(30,43,64,.60), rgba(17,26,43,.50)) !important;
      border: 1px solid #26406b !important;
      border-radius: 16px !important;
      box-shadow: 0 10px 30px rgba(0,0,0,.35) !important;
    }
    /* nested sticky layers transparent so the panel fill isn't doubled */
    .vue-flow__node [class*="sticky"] [class*="sticky"] { background: transparent !important; box-shadow:none !important; }
  ` });
  await page.waitForTimeout(250);

  // Fit the whole graph into view (button if present, else the "1" shortcut).
  const fitBtn = page.locator('[data-test-id="zoom-to-fit"]');
  if (await fitBtn.count()) {
    await fitBtn.first().click();
  } else {
    await page.locator('.vue-flow__pane').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('1');
  }
  await page.waitForTimeout(1200);

  const nodeCount = await page.locator('.vue-flow__node').count();
  console.log(`  nodes rendered: ${nodeCount}`);

  // Compute a tight clip around the actual graph content (nodes + sticky
  // notes) so the PNG has no dead canvas margin, then clamp it to the visible
  // canvas pane. This is what makes the export look like a framed diagram.
  const clip = await page.evaluate(() => {
    const pane = document.querySelector('.vue-flow');
    const pr = pane.getBoundingClientRect();
    const els = document.querySelectorAll('.vue-flow__node');
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top);
      x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    }
    const PAD = 48;
    x0 = Math.max(pr.left, x0 - PAD); y0 = Math.max(pr.top, y0 - PAD);
    x1 = Math.min(pr.right, x1 + PAD); y1 = Math.min(pr.bottom, y1 + PAD);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  });

  await page.screenshot({ path: out, clip });
  console.log(`  wrote ${out} (${Math.round(clip.width)}x${Math.round(clip.height)})`);
}

await browser.close();
console.log('\ndone');
