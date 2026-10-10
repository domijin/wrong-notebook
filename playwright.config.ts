import { defineConfig, devices } from '@playwright/test';

/**
 * E2E configuration.
 *
 * Two deliberate choices keep local runs identical to CI:
 *
 * 1. Workers are pinned to 1. With one worker per CPU core the dev server is
 *    oversubscribed and specs fail on timeouts waiting for on-demand compiles
 *    rather than on real assertions. The suite is small enough that serialising
 *    costs little and makes local runs match CI.
 * 2. The auth/database env is pinned here. Without it the server inherits
 *    whatever NEXTAUTH_URL / DATABASE_URL live in a local .env*, and
 *    NextAuth redirects the login callback to that origin instead of
 *    baseURL, so every spec times out waiting to leave /login.
 */
export default defineConfig({
    testDir: './e2e',
    globalSetup: './e2e/global-setup.ts',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    // One worker: the suite is small, and a single server cannot service more.
    workers: 1,
    reporter: [['html', { host: '0.0.0.0' }]],
    use: {
        baseURL: 'http://127.0.0.1:3000',
        trace: 'on-first-retry',
    },
    webServer: {
        command: 'npm run dev',
        url: 'http://127.0.0.1:3000',
        // Never adopt a server the developer happened to leave running: it
        // would be serving whatever env/config that process captured.
        reuseExistingServer: false,
        timeout: 120 * 1000,
        env: {
            ...process.env,
            NEXTAUTH_URL: 'http://127.0.0.1:3000',
            NEXTAUTH_SECRET: process.env.E2E_NEXTAUTH_SECRET || 'e2e-only-secret-not-used-in-production',
            DATABASE_URL: process.env.E2E_DATABASE_URL || 'file:./e2e.db',
            // admin-settings.spec.ts saves a provider pointing at
            // gateway.example.com, which the AI destination allowlist rejects
            // unless it is listed.
            AI_ALLOWED_ORIGINS:
                process.env.E2E_AI_ALLOWED_ORIGINS || 'https://gateway.example.com',
            LOG_LEVEL: 'error',
        },
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
