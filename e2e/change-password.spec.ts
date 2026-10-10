import { test, expect, type Page } from '@playwright/test';
import { PW_USER, login } from './helpers';

const TEMP_PASSWORD = 'e2e-copper-violin-orchard-77';

async function openAccountTab(page: Page) {
    await page.getByRole('button', { name: '设置' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await page.getByRole('tab', { name: /账户|Account/ }).click();
    return page.getByRole('dialog');
}

async function changePassword(page: Page, current: string, next: string) {
    const dialog = await openAccountTab(page);
    await dialog.locator('input[autocomplete="current-password"]').fill(current);
    await dialog.locator('input[autocomplete="new-password"]').first().fill(next);
    await dialog.locator('input[autocomplete="new-password"]').nth(1).fill(next);
    await dialog.getByRole('button', { name: /更新|Update/ }).click();

    // 结果显示在表单里（不依赖可能被浏览器屏蔽的 alert），随后旧会话失效、跳回登录页
    await expect(dialog.getByTestId('profile-status')).toHaveText(/已更新|updated/i);
    await page.waitForURL('**/login', { timeout: 15000 });
}

test('user can change their own password from the account tab', async ({ page }) => {
    test.setTimeout(90000);

    await login(page, PW_USER.email, PW_USER.password);
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15000 });

    // 没填当前密码：表单里直接提示，不发请求
    const dialog = await openAccountTab(page);
    await dialog.locator('input[autocomplete="new-password"]').first().fill(TEMP_PASSWORD);
    await dialog.locator('input[autocomplete="new-password"]').nth(1).fill(TEMP_PASSWORD);
    await dialog.getByRole('button', { name: /更新|Update/ }).click();
    await expect(dialog.getByTestId('profile-status')).toHaveText(/当前密码|current password/i);
    await page.keyboard.press('Escape');

    await changePassword(page, PW_USER.password, TEMP_PASSWORD);

    // 旧密码失效
    await login(page, PW_USER.email, PW_USER.password);
    await expect(page.getByText(/登录失败|Login failed/i)).toBeVisible();

    // 新密码可用，再改回原密码
    await login(page, PW_USER.email, TEMP_PASSWORD);
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15000 });
    await changePassword(page, TEMP_PASSWORD, PW_USER.password);

    await login(page, PW_USER.email, PW_USER.password);
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15000 });
});
