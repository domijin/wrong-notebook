import { test, expect } from '@playwright/test';
import { ADMIN, loginAsAdmin } from './helpers';

test('Admin can configure OpenAI settings with multi-instance support', async ({ page }) => {
    // 增加测试超时时间
    test.setTimeout(60000);

    // 1. Login as Admin
    await loginAsAdmin(page);

    // 2. Open Settings
    await page.getByRole('button', { name: '设置' }).click();

    // Wait for dialog to be visible
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    // 3. Switch to AI Tab (支持中英文)
    await page.getByRole('tab', { name: /AI Provider|AI 提供商/ }).click();

    // 4. Select OpenAI Provider
    const providerTrigger = page.locator('[role="dialog"] button[role="combobox"]').first();
    await providerTrigger.click();

    // Select OpenAI option
    await page.getByRole('option', { name: 'OpenAI / Compatible' }).click();

    // 5. Add a new instance (multi-instance support)
    // Click "Add" button to create a new instance
    await page.getByRole('button', { name: /添加|Add/ }).click();

    // 6. Fill instance configuration
    const instanceName = '智谱 GLM-4V';
    const apiKey = 'sk-aaa';
    const baseURL = 'https://gateway.example.com/v1'; // CI 里通过 AI_ALLOWED_ORIGINS 加入白名单
    const modelName = 'claude-haiku-4.5';

    // Instance Name Input - use the actual placeholder from the component
    await page.locator('input[placeholder="e.g. 智谱 GLM-4V"]').fill(instanceName);

    // API Key Input associated by placeholder
    await page.locator('input[placeholder="sk-..."]').fill(apiKey);

    // Base URL Input associated by placeholder
    await page.locator('input[placeholder="https://api.openai.com/v1"]').fill(baseURL);

    // Model Name Input
    // Placeholder for OpenAI custom model input is "gpt-4o"
    await page.locator('input[placeholder="gpt-4o"]').fill(modelName);

    // 7. Save Settings
    page.once('dialog', async dialog => {
        console.log(`Dialog message: ${dialog.message()}`);
        expect(dialog.message()).toMatch(/设置已保存|Settings saved/);
        await dialog.accept();
    });

    await page.getByRole('button', { name: /保存 AI 设置|Save AI Settings/ }).click();

    // 管理操作需要在「验证身份」对话框里重新输入当前密码
    await page.getByLabel(/当前密码|Current password/).fill(ADMIN.password);
    await page.getByRole('button', { name: /^确认$|^Confirm$/ }).click();

    // 等待保存完成
    await page.waitForTimeout(1000);

    // 8. Verify Persistence
    await page.reload();

    // 等待页面加载完成
    await page.waitForLoadState('networkidle');

    // 重新打开 Settings Dialog
    await page.getByRole('button', { name: '设置' }).click();

    // 等待对话框显示
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    // Switch to AI Tab (支持中英文)
    await page.getByRole('tab', { name: /AI Provider|AI 提供商/ }).click();

    // Verify values match
    // First combobox should be AI Provider, second should be instance selector
    await expect(page.locator('button[role="combobox"]').first()).toHaveText('OpenAI / Compatible');
    // 已保存的密钥不会再发回浏览器：输入框为空，只提示已配置
    const keyInput = page.locator('input[placeholder^="Configured"]');
    await expect(keyInput).toHaveValue('');
    await expect(page.locator('body')).not.toContainText(apiKey);
    await expect(page.locator('input[placeholder="https://api.openai.com/v1"]')).toHaveValue(baseURL);
    await expect(page.locator('input[placeholder="gpt-4o"]')).toHaveValue(modelName);
});
