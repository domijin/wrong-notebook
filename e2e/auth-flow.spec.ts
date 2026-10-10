import { test, expect } from '@playwright/test';
import { ADMIN, login, loginAsAdmin, logout } from './helpers';

test.describe('Authentication Flow', () => {
    test('admin signs in, sees user management, and signs out', async ({ page }) => {
        test.setTimeout(60000);
        await loginAsAdmin(page);
        await expect(page).toHaveURL(/\/$/);

        // 设置 > 用户管理 中能看到管理员自己
        await page.getByRole('button').filter({ has: page.locator('svg.lucide-settings') }).click();
        await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
        await page.getByRole('tab', { name: /User Management|用户管理/ }).click();
        await expect(page.locator('tr').filter({ hasText: ADMIN.email })).toBeVisible({ timeout: 10000 });
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).not.toBeVisible();

        await logout(page);
        // 退出后访问受保护页面会被重定向回登录页
        await page.goto('/notebooks');
        await page.waitForURL(/\/login/);
    });

    test('registration is closed by default', async ({ page }) => {
        await page.goto('/register');
        await expect(page.locator('body')).toContainText(/注册已关闭|Registration Disabled/, { timeout: 15000 });
        await expect(page.locator('input[name="password"]')).toHaveCount(0);
    });

    test('wrong passwords are rejected and repeated failures lock the account', async ({ page }) => {
        test.setTimeout(60000);
        // 随机邮箱：锁定只影响这个不存在的账号，不影响其他测试用的管理员
        const email = `lockout-${Date.now()}@e2e.test`;
        for (let attempt = 1; attempt <= 5; attempt++) {
            await login(page, email, `wrong-password-${attempt}`);
            await expect(page.locator('.text-red-500')).toContainText(/登录失败|Login failed/, { timeout: 10000 });
        }
        await login(page, email, 'wrong-password-6');
        await expect(page.locator('.text-red-500')).toContainText(/失败次数过多|Too many failed attempts/, { timeout: 10000 });
    });
});
