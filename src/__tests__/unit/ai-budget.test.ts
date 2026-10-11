import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    counters: new Map<string, number>(),
    config: { aiProvider: 'openai' } as { aiProvider: string },
    instance: { baseUrl: 'https://api.minimax.io/v1', apiKey: 'sk-cp-test' } as { baseUrl: string; apiKey: string } | undefined,
}));

// 内存版 AiUsageCounter 表
const aiUsageCounter = {
    upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: { count: number }; update: { count: { increment: number } } }) => {
        const count = mocks.counters.has(where.key) ? mocks.counters.get(where.key)! + update.count.increment : create.count;
        mocks.counters.set(where.key, count);
        return { key: where.key, count };
    }),
    update: vi.fn(async ({ where, data }: { where: { key: string }; data: { count: { decrement: number } } }) => {
        mocks.counters.set(where.key, (mocks.counters.get(where.key) ?? 0) - data.count.decrement);
        return {};
    }),
    deleteMany: vi.fn(async () => ({ count: 0 })),
};
vi.mock('@/lib/prisma', () => ({ prisma: { aiUsageCounter } }));
vi.mock('@/lib/config', () => ({
    getAppConfig: () => mocks.config,
    getActiveOpenAIConfig: () => mocks.instance,
}));

// 从真实账号拿到的 /v1/token_plan/remains 响应（截取）
const REMAINS = {
    model_remains: [
        { start_time: 1791676800000, end_time: 1791694800000, model_name: 'general', current_interval_remaining_percent: 91, weekly_end_time: 1791763200000, current_weekly_remaining_percent: 43 },
        { model_name: 'video', current_interval_remaining_percent: 100, current_weekly_remaining_percent: 100 },
    ],
    base_resp: { status_code: 0, status_msg: 'success' },
};

function quotaResponse(interval: number, weekly: number) {
    const body = structuredClone(REMAINS);
    body.model_remains[0].current_interval_remaining_percent = interval;
    body.model_remains[0].current_weekly_remaining_percent = weekly;
    return new Response(JSON.stringify(body), { status: 200 });
}

const student = { id: 'student', role: 'user' };
const admin = { id: 'admin', role: 'admin' };

beforeEach(() => {
    vi.resetModules();
    mocks.counters.clear();
    mocks.config = { aiProvider: 'openai' };
    mocks.instance = { baseUrl: 'https://api.minimax.io/v1', apiKey: 'sk-cp-test' };
    vi.stubGlobal('fetch', vi.fn(async () => quotaResponse(91, 43)));
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe('MiniMax plan quota helpers', () => {
    it('reads the text-model row of a real remains response', async () => {
        const { parsePlanQuota } = await import('@/lib/ai-budget');
        expect(parsePlanQuota(REMAINS)).toEqual({ intervalPercent: 91, weeklyPercent: 43, intervalEndsAt: 1791694800000, weeklyEndsAt: 1791763200000 });
        expect(parsePlanQuota({ base_resp: { status_code: 1004 } })).toBeNull();
    });
    it('only checks quota for the official MiniMax API over HTTPS', async () => {
        const { minimaxQuotaUrl } = await import('@/lib/ai-budget');
        expect(minimaxQuotaUrl('https://api.minimax.io/v1')).toBe('https://api.minimax.io/v1/token_plan/remains');
        expect(minimaxQuotaUrl('https://api.minimaxi.com/v1/')).toBe('https://api.minimaxi.com/v1/token_plan/remains');
        expect(minimaxQuotaUrl('https://gateway.example.com/v1')).toBeNull();
        expect(minimaxQuotaUrl('http://api.minimax.io/v1')).toBeNull();
    });
    it('pauses below the weekly or 5-hour thresholds, with Retry-After until that window resets', async () => {
        const { quotaPause, budgetSettings } = await import('@/lib/ai-budget');
        const settings = budgetSettings();
        const now = 1791690000000;
        const base = { intervalEndsAt: now + 600_000, weeklyEndsAt: now + 7_200_000 };
        expect(quotaPause({ ...base, intervalPercent: 91, weeklyPercent: 25 }, settings, now)).toBeNull();
        expect(quotaPause({ ...base, intervalPercent: 91, weeklyPercent: 24 }, settings, now)).toEqual({ window: 'weekly', retryAfter: 7200 });
        expect(quotaPause({ ...base, intervalPercent: 9, weeklyPercent: 80 }, settings, now)).toEqual({ window: 'interval', retryAfter: 600 });
    });
    it('counts days in Beijing time by default', async () => {
        const { usageDay } = await import('@/lib/ai-budget');
        expect(usageDay(new Date('2026-10-11T15:59:00Z'), 'Asia/Shanghai')).toBe('2026-10-11');
        expect(usageDay(new Date('2026-10-11T16:01:00Z'), 'Asia/Shanghai')).toBe('2026-10-12');
    });
});

describe('admitAIWork', () => {
    it('allows 200 calls per user per day, then refuses without spending the site budget', async () => {
        const { admitAIWork } = await import('@/lib/ai-budget');
        const rate = await import('@/lib/rate-limit');
        vi.spyOn(rate, 'acquireAIWork').mockReturnValue({ release: () => {} });
        for (let i = 0; i < 200; i++) expect(await admitAIWork(student)).not.toBeInstanceOf(Response);
        const refused = await admitAIWork(student);
        expect(refused).toBeInstanceOf(Response);
        expect((refused as Response).status).toBe(429);
        expect(await (refused as Response).json()).toEqual({ message: 'AI_DAILY_LIMIT_USER' });
        const site = [...mocks.counters].find(([key]) => key.startsWith('site:'))![1];
        expect(site).toBe(200);
    });
    it('stops everyone but admins once the site reaches 1500 calls a day', async () => {
        const { admitAIWork } = await import('@/lib/ai-budget');
        const rate = await import('@/lib/rate-limit');
        vi.spyOn(rate, 'acquireAIWork').mockReturnValue({ release: () => {} });
        for (let i = 0; i < 1500; i++) await admitAIWork({ id: `user${i % 10}`, role: 'user' });
        const refused = await admitAIWork({ id: 'fresh', role: 'user' });
        expect(await (refused as Response).json()).toEqual({ message: 'AI_DAILY_LIMIT_SITE' });
        expect(await admitAIWork(admin)).not.toBeInstanceOf(Response);
    });
    it('pauses non-admins when the plan quota is low, but not admins', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => quotaResponse(91, 20)));
        const { admitAIWork } = await import('@/lib/ai-budget');
        const paused = await admitAIWork(student);
        expect((paused as Response).status).toBe(503);
        expect(await (paused as Response).json()).toEqual({ message: 'AI_QUOTA_PAUSED' });
        expect(Number((paused as Response).headers.get('Retry-After'))).toBeGreaterThan(0);
        const work = await admitAIWork(admin);
        expect(work).not.toBeInstanceOf(Response);
        (work as { release: () => void }).release();
    });
    it('keeps AI working when the quota check fails, and caches the result', async () => {
        const fetchMock = vi.fn(async () => { throw new Error('network down'); });
        vi.stubGlobal('fetch', fetchMock);
        const { admitAIWork } = await import('@/lib/ai-budget');
        for (let i = 0; i < 2; i++) {
            const work = await admitAIWork(student);
            expect(work).not.toBeInstanceOf(Response);
            (work as { release: () => void }).release();
        }
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('skips the quota check for other providers', async () => {
        mocks.instance = { baseUrl: 'https://gateway.example.com/v1', apiKey: 'k' };
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const { admitAIWork } = await import('@/lib/ai-budget');
        expect(await admitAIWork(student)).not.toBeInstanceOf(Response);
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('refunds the daily count when the burst or concurrency limit refuses the call', async () => {
        const { admitAIWork } = await import('@/lib/ai-budget');
        const rate = await import('@/lib/rate-limit');
        vi.spyOn(rate, 'acquireAIWork').mockReturnValue(Response.json({ message: 'AI service is busy' }, { status: 429 }) as never);
        await admitAIWork(student);
        expect([...mocks.counters.values()].every(count => count === 0)).toBe(true);
    });
    it('reads limits from the environment, and 0 turns a limit off', async () => {
        vi.stubEnv('AI_DAILY_LIMIT_PER_USER', '0');
        vi.stubEnv('AI_DAILY_LIMIT_SITE', '3');
        const { admitAIWork } = await import('@/lib/ai-budget');
        const rate = await import('@/lib/rate-limit');
        vi.spyOn(rate, 'acquireAIWork').mockReturnValue({ release: () => {} });
        for (let i = 0; i < 3; i++) expect(await admitAIWork(student)).not.toBeInstanceOf(Response);
        expect(await ((await admitAIWork(student)) as Response).json()).toEqual({ message: 'AI_DAILY_LIMIT_SITE' });
    });
});
