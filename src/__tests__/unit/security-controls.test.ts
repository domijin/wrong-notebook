import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateAIDestination, guardAIFetch } from '@/lib/ai-destination';

afterEach(() => { vi.unstubAllEnvs(); });

describe('outbound AI destination policy', () => {
    it.each(['http://localhost:3000', 'http://127.1', 'http://[::1]', 'http://169.254.169.254',
        'https://api.openai.com.evil.example', 'https://api.openai.com:8443', 'file:///etc/passwd',
        'https://user:password@api.openai.com', 'https://api.openai.com/v1?key=secret', 'https://api.openai.com/#fragment',
    ])('rejects %s', value => {
        expect(() => validateAIDestination(value)).toThrow();
    });
    it('allows provider defaults and Azure resource endpoints', () => {
        expect(validateAIDestination('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1');
        expect(validateAIDestination('https://resource.openai.azure.com')).toBe('https://resource.openai.azure.com');
    });
    it('requires an exact operator-configured origin for custom services', () => {
        vi.stubEnv('AI_ALLOWED_ORIGINS', 'https://gateway.example.com, http://127.0.0.1:8081');
        expect(validateAIDestination('https://gateway.example.com/v1')).toBe('https://gateway.example.com/v1');
        expect(validateAIDestination('http://127.0.0.1:8081/v1')).toBe('http://127.0.0.1:8081/v1');
        expect(() => validateAIDestination('http://127.0.0.1:8082')).toThrow();
        expect(() => validateAIDestination('https://gateway.example.com.evil.test')).toThrow();
    });
    it('rejects redirect following for the Gemini SDK global transport', async () => {
        const original = vi.fn(async () => new Response('{}'));
        const guarded = guardAIFetch(original);
        await guarded('https://generativelanguage.googleapis.com/v1beta/models?key=secret', { redirect: 'follow' });
        expect(original).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error' }));
        await guarded('https://unrelated.example.com');
        expect(original).toHaveBeenLastCalledWith('https://unrelated.example.com', undefined);
    });
});

describe('in-process rate and capacity controls', () => {
    beforeEach(() => { vi.resetModules(); });
    it('denies bursts and permits another request after the fixed window expires', async () => {
        const { consumeRateLimit } = await import('@/lib/rate-limit');
        vi.spyOn(Date, 'now').mockReturnValue(1000);
        expect(consumeRateLimit('account', 2, 1000)).toBe(true);
        expect(consumeRateLimit('account', 2, 1000)).toBe(true);
        expect(consumeRateLimit('account', 2, 1000)).toBe(false);
        vi.spyOn(Date, 'now').mockReturnValue(2000);
        expect(consumeRateLimit('account', 2, 1000)).toBe(true);
    });
    it('bounds work per account and across accounts, then releases slots exactly once', async () => {
        const { acquireAIWork } = await import('@/lib/rate-limit');
        const first = acquireAIWork('reader');
        const second = acquireAIWork('reader');
        expect(acquireAIWork('reader')).toBeInstanceOf(Response);
        const third = acquireAIWork('other');
        const fourth = acquireAIWork('other');
        expect(acquireAIWork('third')).toBeInstanceOf(Response);
        if (first instanceof Response || second instanceof Response || third instanceof Response || fourth instanceof Response) throw new Error('Expected work leases');
        first.release(); first.release();
        const replacement = acquireAIWork('third');
        expect(replacement).not.toBeInstanceOf(Response);
        second.release(); third.release(); fourth.release();
        if (!(replacement instanceof Response)) replacement.release();
    });
    it('caps AI request volume even when each request finishes promptly', async () => {
        const { acquireAIWork } = await import('@/lib/rate-limit');
        for (let i = 0; i < 20; i++) {
            const work = acquireAIWork('reader');
            if (work instanceof Response) throw new Error('Unexpected early denial');
            work.release();
        }
        const denied = acquireAIWork('reader');
        expect(denied).toBeInstanceOf(Response);
        if (denied instanceof Response) expect(denied.status).toBe(429);
    });
});
