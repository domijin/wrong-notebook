import { expect, type Page } from '@playwright/test';

/**
 * 端到端测试用的管理员账号。CI 通过 ADMIN_EMAIL / ADMIN_PASSWORD 让种子脚本创建它，
 * 本地跑测试时请用同样的变量（或 E2E_ADMIN_*）指向一个已存在的管理员。
 */
export const ADMIN = {
    email: process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'admin@e2e.test',
    password: process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'e2e-lantern-harbor-meadow-42',
};

export async function login(page: Page, email: string, password: string) {
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
}

export async function loginAsAdmin(page: Page) {
    await login(page, ADMIN.email, ADMIN.password);
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15000 });
}

export async function logout(page: Page) {
    await page.locator('button[title*="Logout"], button[title*="退出"]').click();
    await page.waitForURL('**/login');
    await expect(page.locator('input[name="email"]')).toBeVisible();
}

/** 改密码测试专用的普通用户，由 global-setup.ts 每次运行前重置 */
export const PW_USER = {
    email: 'password-change@e2e.test',
    password: 'e2e-granite-tulip-harbor-58',
};
