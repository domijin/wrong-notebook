#!/usr/bin/env node
// screenshot.mjs — sign in to a running instance through the real login form
// and take full-page screenshots for visual review.
//
// Usage:
//   WN_BASE_URL=https://<host> WN_EMAIL=<email> WN_PASSWORD=<password> \
//     node scripts/screenshot.mjs [/path ...]        # default: /tags
//
// Screenshots go to $SHOT_DIR (default: <os tmpdir>/wn-shots). They show signed-in
// pages, so delete them when done. Uses the locally installed Chrome; set
// WN_BROWSER_CHANNEL= (empty) to use Playwright's bundled Chromium instead.

import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const required = name => {
  const value = process.env[name];
  if (!value) { console.error(`set ${name} (see the header of this script)`); process.exit(2); }
  return value;
};
const BASE = required('WN_BASE_URL').replace(/\/+$/, '');
const EMAIL = required('WN_EMAIL');
const PASSWORD = required('WN_PASSWORD');
const OUT = process.env.SHOT_DIR || path.join(tmpdir(), 'wn-shots');
const channel = process.env.WN_BROWSER_CHANNEL ?? 'chrome';

const paths = process.argv.slice(2).length ? process.argv.slice(2) : ['/tags'];
mkdirSync(OUT, { recursive: true, mode: 0o700 });

const browser = await chromium.launch(channel ? { channel } : {});
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name=email]', EMAIL);
  await page.fill('input[name=password]', PASSWORD);
  await Promise.all([
    page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
    page.click('button[type=submit]'),
  ]);
  if (new URL(page.url()).pathname.startsWith('/login')) {
    console.error('sign-in failed (wrong credentials, or the account is locked after repeated failures)');
    process.exitCode = 1;
  } else {
    for (const p of paths) {
      await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1200);
      const name = p === '/' ? 'home' : p.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
      const file = path.join(OUT, `wn_${name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const text = await page.evaluate(() => document.body.innerText.slice(0, 400).replace(/\n{2,}/g, '\n'));
      console.log(`\n=== ${p} → ${file}\n${text}`);
    }
  }
} finally {
  await browser.close();
}
