/**
 * /api/error-items/[id]/translation 集成测试
 * 覆盖：鉴权、只能翻译自己的错题、译文单独保存且不改原文、缓存与过期、错误映射。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Item = { id: string; userId: string; questionText: string | null; answerText: string | null; analysis: string | null; mistakeAnalysis: string | null; userNotes: string | null };
type Row = { id: string; errorItemId: string; language: string; fields: string; sourceHash: string; updatedAt: Date };

const mocks = vi.hoisted(() => ({
    translateContent: vi.fn(),
    session: { user: { id: 'user-1', email: 'user@example.com' } } as { user: { id: string; email: string } } | null,
    items: new Map<string, Item>(),
    rows: new Map<string, Row>(),
    itemUpdate: vi.fn(),
}));

vi.mock('@/lib/current-session', () => ({ getCurrentSession: async () => mocks.session }));
vi.mock('@/lib/ai', () => ({ getAIService: () => ({ translateContent: mocks.translateContent }) }));
vi.mock('@/lib/ai-budget', async () => {
    const { acquireAIWork } = await import('@/lib/rate-limit');
    return { admitAIWork: async (user: { id: string }) => acquireAIWork(user.id) };
});
const key = (w: { errorItemId: string; language: string }) => `${w.errorItemId}:${w.language}`;
vi.mock('@/lib/prisma', () => ({
    prisma: {
        errorItem: {
            findUnique: async ({ where }: { where: { id: string } }) => mocks.items.get(where.id) ?? null,
            update: mocks.itemUpdate,
        },
        errorItemTranslation: {
            findUnique: async ({ where }: { where: { errorItemId_language: { errorItemId: string; language: string } } }) =>
                mocks.rows.get(key(where.errorItemId_language)) ?? null,
            upsert: async ({ where, create, update }: { where: { errorItemId_language: { errorItemId: string; language: string } }; create: Omit<Row, 'id' | 'updatedAt'>; update: Partial<Row> }) => {
                const k = key(where.errorItemId_language);
                const row = { ...(mocks.rows.get(k) ?? { id: k, ...create }), ...update, updatedAt: new Date() } as Row;
                mocks.rows.set(k, row);
                return row;
            },
            deleteMany: async ({ where }: { where: { errorItemId: string; language: string } }) => {
                mocks.rows.delete(key(where));
                return { count: 1 };
            },
        },
    },
}));

import { GET, POST, DELETE } from '@/app/api/error-items/[id]/translation/route';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: unknown) =>
    POST(new Request(`http://localhost/api/error-items/${id}/translation`, { method: 'POST', body: JSON.stringify(body) }), params(id));
const get = (id: string, lang: string) => GET(new Request(`http://localhost/api/error-items/${id}/translation?lang=${lang}`), params(id));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { user: { id: 'user-1', email: 'user@example.com' } };
    mocks.items.clear();
    mocks.rows.clear();
    mocks.items.set('item-1', { id: 'item-1', userId: 'user-1', questionText: '已知二次函数 $f(x)=x^2-4x+3$，求它的最小值。', answerText: '$-1$', analysis: '先配方：$f(x)=(x-2)^2-1$。', mistakeAnalysis: null, userNotes: '配方时符号写错了' });
    mocks.items.set('other', { id: 'other', userId: 'user-2', questionText: '别人的题目，内容足够长用于判断语言。', answerText: null, analysis: null, mistakeAnalysis: null, userNotes: null });
    mocks.translateContent.mockImplementation(async (content: Record<string, string>) =>
        Object.fromEntries(Object.keys(content).map(f => [f, `EN:${f}`])));
});

describe('/api/error-items/[id]/translation', () => {
    it('requires a session', async () => {
        mocks.session = null;
        expect((await post('item-1', { target: 'en' })).status).toBe(401);
        expect(mocks.translateContent).not.toHaveBeenCalled();
    });

    it("returns 404 for another user's item and never translates it", async () => {
        expect((await post('other', { target: 'en' })).status).toBe(404);
        expect((await get('other', 'en')).status).toBe(404);
        expect(mocks.translateContent).not.toHaveBeenCalled();
    });

    it('stores the translation separately and never writes the original item', async () => {
        const res = await post('item-1', { target: 'en' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.translation.fields).toEqual({ questionText: 'EN:questionText', answerText: 'EN:answerText', analysis: 'EN:analysis', userNotes: 'EN:userNotes' });
        expect(body.translation.stale).toBe(false);
        expect(mocks.itemUpdate).not.toHaveBeenCalled();
        expect(mocks.items.get('item-1')!.questionText).toContain('已知二次函数');
    });

    it('reuses a current translation instead of calling the AI again, unless forced', async () => {
        await post('item-1', { target: 'en' });
        await post('item-1', { target: 'en' });
        expect(mocks.translateContent).toHaveBeenCalledTimes(1);
        await post('item-1', { target: 'en', force: true });
        expect(mocks.translateContent).toHaveBeenCalledTimes(2);
    });

    it('marks the translation stale after the original is edited', async () => {
        await post('item-1', { target: 'en' });
        expect((await (await get('item-1', 'en')).json()).translation.stale).toBe(false);
        mocks.items.get('item-1')!.analysis = '换一种方法：用顶点公式。';
        expect((await (await get('item-1', 'en')).json()).translation.stale).toBe(true);
    });

    it('returns null when nothing has been translated yet', async () => {
        expect(await (await get('item-1', 'es')).json()).toEqual({ translation: null });
    });

    it('skips content that is already in the target language', async () => {
        const res = await post('item-1', { target: 'zh' });
        expect(await res.json()).toEqual({ translation: null, unchanged: true });
        expect(mocks.translateContent).not.toHaveBeenCalled();
    });

    it('rejects unsupported languages', async () => {
        expect((await post('item-1', { target: 'fr' })).status).toBe(400);
        expect((await get('item-1', 'fr')).status).toBe(400);
    });

    it('maps AI failures to the codes the UI translates', async () => {
        mocks.translateContent.mockRejectedValueOnce(new Error('AI_RESPONSE_ERROR: translation returned no usable fields'));
        const res = await post('item-1', { target: 'en' });
        expect(res.status).toBe(502);
        expect((await res.json()).message).toBe('AI_RESPONSE_ERROR');
        expect(mocks.rows.size).toBe(0);
    });

    it('deletes a translation', async () => {
        await post('item-1', { target: 'en' });
        const res = await DELETE(new Request('http://localhost/api/error-items/item-1/translation?lang=en', { method: 'DELETE' }), params('item-1'));
        expect(res.status).toBe(204);
        expect(await (await get('item-1', 'en')).json()).toEqual({ translation: null });
    });
});
