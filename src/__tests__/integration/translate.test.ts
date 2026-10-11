/**
 * /api/translate 集成测试
 * 覆盖：鉴权、参数校验、语言对短路、字段白名单与错误映射。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    mockAIService: {
        translateContent: vi.fn(),
    },
    mockSession: {
        user: { id: 'user-1', email: 'user@example.com', name: 'Test User' },
        expires: '2025-12-31',
    },
    sessionEnabled: true,
}));

vi.mock('@/lib/current-session', () => ({
    getCurrentSession: async () => (mocks.sessionEnabled ? mocks.mockSession : null),
}));

vi.mock('@/lib/ai', () => ({
    getAIService: vi.fn(() => mocks.mockAIService),
}));

import { POST } from '@/app/api/translate/route';

// 每日额度和套餐余量保护在 ai-budget.test.ts 里单独测；这里只保留并发/突发限制
vi.mock('@/lib/ai-budget', async () => {
    const { acquireAIWork } = await import('@/lib/rate-limit');
    return { admitAIWork: async (user: { id: string }) => acquireAIWork(user.id) };
});

function post(body: unknown, url = 'http://localhost/api/translate') {
    return POST(new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }));
}

describe('/api/translate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.sessionEnabled = true;
        mocks.mockAIService.translateContent.mockResolvedValue({
            questionText: '¿Cuánto es 2+2?',
            analysis: 'El análisis',
        });
    });

    it('rejects unauthenticated requests', async () => {
        mocks.sessionEnabled = false;
        const res = await post({ target: 'es', content: { analysis: 'hola' } });
        expect(res.status).toBe(401);
        expect(mocks.mockAIService.translateContent).not.toHaveBeenCalled();
    });

    it('translates into the requested language', async () => {
        const res = await post({
            target: 'es',
            content: { questionText: '2+2 等于几？', analysis: '解析' },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.unchanged).toBe(false);
        expect(body.translated).toEqual({
            questionText: '¿Cuánto es 2+2?',
            analysis: 'El análisis',
        });
        expect(mocks.mockAIService.translateContent).toHaveBeenCalledWith(
            expect.objectContaining({ questionText: '2+2 等于几？' }),
            'es'
        );
    });

    it('rejects an unsupported target language', async () => {
        const res = await post({ target: 'fr', content: { analysis: 'x' } });
        expect(res.status).toBe(400);
        expect(mocks.mockAIService.translateContent).not.toHaveBeenCalled();
    });

    it('rejects a missing target', async () => {
        const res = await post({ content: { analysis: 'x' } });
        expect(res.status).toBe(400);
    });

    it('rejects missing content', async () => {
        const res = await post({ target: 'es' });
        expect(res.status).toBe(400);
    });

    it('rejects content with no translatable fields', async () => {
        const res = await post({ target: 'es', content: { analysis: '   ' } });
        expect(res.status).toBe(400);
        expect(mocks.mockAIService.translateContent).not.toHaveBeenCalled();
    });

    it('rejects an oversized field', async () => {
        const res = await post({ target: 'es', content: { analysis: 'a'.repeat(9000) } });
        expect(res.status).toBe(400);
    });

    it('only forwards the whitelisted prose fields', async () => {
        await post({
            target: 'es',
            content: {
                questionText: 'q',
                answerText: 'a',
                analysis: 'x',
                userNotes: 'n',
                mistakeStatus: 'wrong_attempt',
                masteryLevel: 2,
                originalImageUrl: 'http://x/y.png',
            } as Record<string, unknown>,
        });
        const [forwarded] = mocks.mockAIService.translateContent.mock.calls[0];
        expect(Object.keys(forwarded).sort()).toEqual([
            'analysis',
            'answerText',
            'questionText',
            'userNotes',
        ]);
    });

    it('short-circuits when the content already matches the target language', async () => {
        const res = await post({ target: 'zh', content: { analysis: '这是一个中文解析。' } });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.unchanged).toBe(true);
        expect(body.translated).toEqual({});
        expect(mocks.mockAIService.translateContent).not.toHaveBeenCalled();
    });

    it('still calls the model when Chinese content is requested in English', async () => {
        const res = await post({ target: 'en', content: { analysis: '这是一个中文解析。' } });
        expect(res.status).toBe(200);
        expect(mocks.mockAIService.translateContent).toHaveBeenCalled();
    });

    it('maps an auth failure to AI_AUTH_ERROR', async () => {
        mocks.mockAIService.translateContent.mockRejectedValue(
            new Error('AI_AUTH_ERROR: bad key')
        );
        const res = await post({ target: 'es', content: { analysis: 'hello world' } });
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.message).toContain('AI_AUTH_ERROR');
    });

    it('maps an unparsable reply to AI_RESPONSE_ERROR', async () => {
        mocks.mockAIService.translateContent.mockRejectedValue(
            new Error('AI_RESPONSE_ERROR: could not parse translation payload')
        );
        const res = await post({ target: 'es', content: { analysis: 'hello world' } });
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.message).toContain('AI_RESPONSE_ERROR');
    });

    it('returns a generic error for unexpected failures', async () => {
        mocks.mockAIService.translateContent.mockRejectedValue(new Error('boom'));
        const res = await post({ target: 'es', content: { analysis: 'hello world' } });
        expect(res.status).toBe(500);
    });
});
