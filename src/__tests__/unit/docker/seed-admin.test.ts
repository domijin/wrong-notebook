import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { seedAdmin } = require('../../../../scripts/seed-admin.js');
const { validateProductionEnv } = require('../../../../scripts/validate-production-env.js');

const configured = { ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: 'unique-admin-password-2026', NODE_ENV: 'production' };
function database(count = 0) {
    return { user: { count: vi.fn(async () => count), create: vi.fn(), update: vi.fn() } };
}
describe('first-time admin provisioning', () => {
    it('creates an env-configured admin only on an empty installation', async () => {
        const prisma = database();
        const hash = vi.fn(async () => 'hashed-password');
        expect(await seedAdmin({ prisma, hash, env: configured })).toEqual({ action: 'created', email: configured.ADMIN_EMAIL });
        expect(hash).toHaveBeenCalledWith(configured.ADMIN_PASSWORD, 12);
        expect(prisma.user.create).toHaveBeenCalledWith({ data: {
            email: configured.ADMIN_EMAIL, password: 'hashed-password', name: 'Admin', role: 'admin', isActive: true,
        } });
    });
    it.each([{ role: 'admin', isActive: false }, { role: 'user', isActive: true }, { role: 'user', isActive: false }])(
        'leaves existing accounts unchanged: %j', async () => {
            const prisma = database(1);
            const hash = vi.fn();
            expect(await seedAdmin({ prisma, hash, env: configured })).toEqual({ action: 'skipped' });
            expect(prisma.user.create).not.toHaveBeenCalled();
            expect(prisma.user.update).not.toHaveBeenCalled();
            expect(hash).not.toHaveBeenCalled();
        });
    it('build/development seeding without credentials creates no admin', async () => {
        const prisma = database();
        expect(await seedAdmin({ prisma, hash: vi.fn(), env: {} })).toEqual({ action: 'skipped' });
        expect(prisma.user.create).not.toHaveBeenCalled();
    });
    it.each([{}, { ADMIN_EMAIL: 'owner@example.com' }, { ...configured, ADMIN_PASSWORD: '123456' }])(
        'rejects missing or default credentials at first production startup: %j', async env => {
            await expect(seedAdmin({ prisma: database(), hash: vi.fn(), env: { ...env, NODE_ENV: 'production' } })).rejects.toThrow('First-time provisioning');
        });
});
describe('production auth secret', () => {
    it.each(['', 'your_secret_key', 'your_secret_key_here_with_extra_padding', 'changeme-with-extra-padding-for-length'])('rejects %s', secret => {
        expect(() => validateProductionEnv({ NODE_ENV: 'production', NEXTAUTH_SECRET: secret })).toThrow('NEXTAUTH_SECRET');
    });
    it('accepts a non-placeholder secret and permits development without one', () => {
        expect(() => validateProductionEnv({ NODE_ENV: 'production', NEXTAUTH_SECRET: '64e7d80a6ac986d8b507e1a7f032d9b3e34bc1516e1839bd201c75a1a10f491e' })).not.toThrow();
        expect(() => validateProductionEnv({ NODE_ENV: 'development' })).not.toThrow();
    });
});
