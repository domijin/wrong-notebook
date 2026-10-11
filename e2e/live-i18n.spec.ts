import { test, expect, type Page } from '@playwright/test';
import { ADMIN } from './helpers';

/**
 * Live-site smoke test for the i18n work.
 *
 * Runs against the real deployment over Tailscale instead of a local server,
 * because the sandbox cannot hydrate React and therefore cannot validate the
 * rendered UI at all. Override the host with LIVE_BASE_URL and supply
 * E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD.
 */

// Opt-in only: this targets a live deployment and needs real credentials, so
// it must never run as part of the normal suite (CI or local `npx playwright
// test`). Run it explicitly:
//   LIVE_BASE_URL=https://... E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
//     npx playwright test e2e/live-i18n.spec.ts
const liveOnly = Boolean(process.env.LIVE_BASE_URL || process.env.RUN_LIVE_E2E);
const BASE = process.env.LIVE_BASE_URL || 'https://domis-pc-tools.taila7d2b1.ts.net';

test.use({ baseURL: BASE });

async function login(page: Page) {
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(ADMIN.email);
    await page.locator('input[name="password"]').fill(ADMIN.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

async function setLanguage(page: Page, code: string) {
    await page.goto('/');
    await page.evaluate(c => localStorage.setItem('app-language', c), code);
    await page.reload();
    await page.waitForLoadState('networkidle');
}

const LABELS: Record<string, string[]> = {
    zh: ['上传新题', '拍照上传', '手动输入', '直接录入'],
    en: ['Upload New', 'Take Photo', 'Manual Input', 'Direct Entry'],
    es: ['Subir nuevo', 'Tomar foto', 'Entrada manual', 'Entrada directa'],
};

test.describe('live i18n', () => {
    test.skip(!liveOnly, 'set LIVE_BASE_URL / RUN_LIVE_E2E to target the live deployment');

    test('renders the home page in all three languages', async ({ page }) => {
        await login(page);

        for (const [code, labels] of Object.entries(LABELS)) {
            await setLanguage(page, code);
            const body = await page.evaluate(() => document.body.innerText);
            const htmlLang = await page.evaluate(() => document.documentElement.lang);
            console.log(`[${code}] html.lang=${htmlLang}`);
            for (const label of labels) {
                expect(body, `${code} should contain "${label}"`).toContain(label);
            }
            // No text from another locale may leak through.
            for (const [other, otherLabels] of Object.entries(LABELS)) {
                if (other === code) continue;
                for (const label of otherLabels) {
                    expect(body, `${code} must not show ${other} text "${label}"`).not.toContain(label);
                }
            }
        }
    });

    test('sets <html lang> to match the selected language', async ({ page }) => {
        await login(page);
        for (const [code, tag] of Object.entries({ zh: 'zh-CN', en: 'en', es: 'es' })) {
            await setLanguage(page, code);
            expect(await page.evaluate(() => document.documentElement.lang)).toBe(tag);
        }
    });

    test('offers all three languages in settings', async ({ page }) => {
        await login(page);
        await setLanguage(page, 'en');
        await page.goto('/');
        await page.getByRole('button', { name: /^Settings$|^设置$/ }).first().click();
        await page.waitForTimeout(800);
        const dialog = page.locator('[role="dialog"]');
        await expect(dialog).toBeVisible();
        for (const label of ['中文', 'English', 'Español']) {
            await expect(dialog.getByRole('option', { name: label })).toBeVisible();
        }
    });

    test('persists the language choice across navigation', async ({ page }) => {
        await login(page);
        await setLanguage(page, 'es');
        await page.goto('/notebooks');
        await page.waitForLoadState('networkidle');
        expect(await page.evaluate(() => localStorage.getItem('app-language'))).toBe('es');
        const body = await page.evaluate(() => document.body.innerText);
        expect(body).not.toContain('Upload New');
    });

    test('translate endpoint rejects an unsupported target', async ({ page }) => {
        await login(page);
        const res = await page.evaluate(async () => {
            const r = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target: 'fr', content: { analysis: 'hello' } }),
            });
            return { status: r.status, body: (await r.text()).slice(0, 200) };
        });
        console.log('invalid target ->', res.status, res.body.slice(0, 120));
        expect(res.status).toBe(400);
    });

    test('translate endpoint rejects unauthenticated callers', async ({ page }) => {
        await page.goto('/login');
        const status = await page.evaluate(async () => {
            const r = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target: 'es', content: { analysis: 'hello' } }),
            });
            return r.status;
        });
        expect(status).toBe(401);
    });
});
