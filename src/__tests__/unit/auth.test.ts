import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from 'next-auth';

const mocks = vi.hoisted(() => ({ user: vi.fn(), compare: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.user } } }));
vi.mock('bcryptjs', () => ({ compare: mocks.compare }));

async function credentialsProvider() {
    const { authOptions } = await import('@/lib/auth');
    return (authOptions.providers[0] as unknown as { options: { authorize: (credentials: Record<string, string>, request: Record<string, never>) => Promise<User | null> } }).options.authorize;
}
beforeEach(() => {
    vi.resetModules();
    mocks.user.mockResolvedValue({ id: 'reader', email: 'reader@example.com', name: 'Reader', password: 'hash', role: 'user', isActive: true, sessionVersion: 3 });
    mocks.compare.mockResolvedValue(true);
});

describe('login and signed session metadata', () => {
    it('issues account version and a server timestamp after successful password authentication', async () => {
        const authorize = await credentialsProvider();
        const user = await authorize({ email: 'reader@example.com', password: 'password' }, {});
        expect(user).toMatchObject({ id: 'reader', sessionVersion: 3, authenticatedAt: expect.any(Number) });
        expect(user).not.toHaveProperty('password');
        if (!user) throw new Error('Expected authenticated user');
        const { authOptions } = await import('@/lib/auth');
        const token = await authOptions.callbacks!.jwt!({ token: { id: 'reader' }, user, account: null });
        expect(token).toMatchObject({ id: 'reader', sessionVersion: 3, authenticatedAt: user.authenticatedAt });
    });
    it('does not accept client-supplied recent auth or account version changes', async () => {
        const { authOptions } = await import('@/lib/auth');
        const token = { id: 'reader', sessionVersion: 0, authenticatedAt: 1 };
        const jwt = authOptions.callbacks!.jwt!;
        const input = { token, trigger: 'update', session: { authenticatedAt: Date.now(), sessionVersion: 99 } };
        expect(await jwt(input as unknown as Parameters<typeof jwt>[0])).toEqual(token);
    });
    it('rejects disabled users before issuing a token', async () => {
        mocks.user.mockResolvedValue({ isActive: false });
        await expect((await credentialsProvider())({ email: 'reader@example.com', password: 'password' }, {})).rejects.toThrow('disabled');
        expect(mocks.compare).not.toHaveBeenCalled();
    });
    it('rejects wrong passwords and missing credentials', async () => {
        const authorize = await credentialsProvider();
        mocks.compare.mockResolvedValue(false);
        expect(await authorize({ email: 'reader@example.com', password: 'wrong' }, {})).toBeNull();
        expect(await authorize({}, {})).toBeNull();
    });
    it('throttles login attempts before database/password work', async () => {
        const authorize = await credentialsProvider();
        for (let i = 0; i < 10; i++) await authorize({ email: 'reader@example.com', password: 'password' }, {});
        expect(await authorize({ email: 'reader@example.com', password: 'password' }, {})).toBeNull();
        expect(mocks.user).toHaveBeenCalledTimes(10);
    });
});
