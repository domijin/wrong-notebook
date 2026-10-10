import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from 'next-auth';

type Row = { key: string; failures: number; lastFailureAt: Date | null; lockedUntil: Date | null };

const mocks = vi.hoisted(() => ({ user: vi.fn(), compare: vi.fn(), throttle: new Map<string, Row>() }));

// 内存版 AuthThrottle 表：让测试走真实的限流逻辑
const authThrottle = {
    findMany: vi.fn(async ({ where }: { where: { key: { in: string[] }; lockedUntil: { gt: Date } } }) =>
        where.key.in.map(key => mocks.throttle.get(key)).filter((row): row is Row => !!row?.lockedUntil && row.lockedUntil > where.lockedUntil.gt)),
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) => mocks.throttle.get(where.key) ?? null),
    upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: Row; update: Omit<Row, 'key'> }) => {
        const row = mocks.throttle.has(where.key) ? { ...mocks.throttle.get(where.key)!, ...update } : create;
        mocks.throttle.set(where.key, row);
        return row;
    }),
    deleteMany: vi.fn(async ({ where }: { where: { key?: string } }) => {
        if (where.key) mocks.throttle.delete(where.key);
        return { count: 0 };
    }),
};
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.user }, authThrottle } }));
vi.mock('bcryptjs', () => ({ compare: mocks.compare }));

type Authorize = (credentials: Record<string, string>, request: { headers?: Record<string, string> }) => Promise<User | null>;

async function credentialsProvider() {
    const { authOptions } = await import('@/lib/auth');
    return (authOptions.providers[0] as unknown as { options: { authorize: Authorize } }).options.authorize;
}
beforeEach(() => {
    vi.resetModules();
    mocks.throttle.clear();
    mocks.user.mockReset().mockResolvedValue({ id: 'reader', email: 'reader@example.com', name: 'Reader', password: 'hash', role: 'user', isActive: true, sessionVersion: 3 });
    mocks.compare.mockReset().mockResolvedValue(true);
});
afterEach(() => { vi.unstubAllEnvs(); });

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
    it('rejects wrong passwords and missing credentials, recording the failure', async () => {
        const authorize = await credentialsProvider();
        mocks.compare.mockResolvedValue(false);
        expect(await authorize({ email: 'reader@example.com', password: 'wrong' }, {})).toBeNull();
        expect(await authorize({}, {})).toBeNull();
        expect(mocks.throttle.get('account:reader@example.com')?.failures).toBe(1);
    });
});

describe('login throttling', () => {
    it('locks the account after five failures and skips database/password work while locked', async () => {
        const authorize = await credentialsProvider();
        mocks.compare.mockResolvedValue(false);
        for (let i = 0; i < 5; i++) expect(await authorize({ email: 'Reader@Example.com', password: 'wrong' }, {})).toBeNull();
        mocks.user.mockClear(); mocks.compare.mockClear().mockResolvedValue(true);
        // 即使这次密码正确，锁定期内也拒绝
        await expect(authorize({ email: 'reader@example.com', password: 'password' }, {})).rejects.toThrow('TooManyAttempts');
        expect(mocks.user).not.toHaveBeenCalled();
        expect(mocks.compare).not.toHaveBeenCalled();
    });
    it('spends a bcrypt comparison and records a failure for unknown emails', async () => {
        const authorize = await credentialsProvider();
        mocks.user.mockResolvedValue(null);
        expect(await authorize({ email: 'nobody@example.com', password: 'guess' }, {})).toBeNull();
        expect(mocks.compare).toHaveBeenCalledTimes(1);
        expect(mocks.throttle.get('account:nobody@example.com')?.failures).toBe(1);
    });
    it('clears account failures after a successful login', async () => {
        const authorize = await credentialsProvider();
        mocks.compare.mockResolvedValue(false);
        for (let i = 0; i < 4; i++) await authorize({ email: 'reader@example.com', password: 'wrong' }, {});
        mocks.compare.mockResolvedValue(true);
        expect(await authorize({ email: 'reader@example.com', password: 'password' }, {})).not.toBeNull();
        expect(mocks.throttle.has('account:reader@example.com')).toBe(false);
    });
    it('throttles one client IP across accounts when a trusted IP header is configured', async () => {
        vi.stubEnv('AUTH_CLIENT_IP_HEADER', 'X-Forwarded-For');
        const authorize = await credentialsProvider();
        mocks.user.mockResolvedValue(null);
        const headers = { 'x-forwarded-for': '198.51.100.9, 203.0.113.7' };
        for (let i = 0; i < 20; i++) await authorize({ email: `user${i}@example.com`, password: 'guess' }, { headers });
        await expect(authorize({ email: 'fresh@example.com', password: 'guess' }, { headers })).rejects.toThrow('TooManyAttempts');
        // 另一个 IP 不受影响
        expect(await authorize({ email: 'fresh@example.com', password: 'guess' }, { headers: { 'x-forwarded-for': '203.0.113.8' } })).toBeNull();
    });
});
