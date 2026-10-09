import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), config: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/current-session', () => ({ getCurrentSession: mocks.session }));
vi.mock('@/lib/config', () => ({ getAppConfig: mocks.config }));
import { POST } from '@/app/api/ai/models/route';
const request = (body: unknown) => new Request('http://localhost/api/ai/models', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => {
    mocks.session.mockResolvedValue({ user: { id: 'models-admin', role: 'admin' } });
    mocks.config.mockReturnValue({ gemini: { apiKey: 'stored-key' } });
    vi.stubGlobal('fetch', mocks.fetch);
});
describe('model discovery', () => {
    it('discovers Gemini models with a stored key in a header', async () => {
        mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ models: [{ name: 'models/gemini-2.5-flash' }] }) });
        const res = await POST(request({ provider: 'gemini' }));
        expect(res.status).toBe(200);
        expect((await res.json()).models[0].id).toBe('gemini-2.5-flash');
        expect(mocks.fetch).toHaveBeenCalledWith('https://generativelanguage.googleapis.com/v1beta/models', expect.objectContaining({
            headers: expect.objectContaining({ 'x-goog-api-key': 'stored-key' }), redirect: 'error', signal: expect.any(AbortSignal),
        }));
    });
    it('discovers OpenAI models using a POST key', async () => {
        mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: 'gpt-4o', owned_by: 'openai' }] }) });
        const res = await POST(request({ provider: 'openai', apiKey: 'new-key' }));
        expect(res.status).toBe(200);
        expect(mocks.fetch).toHaveBeenCalledWith('https://api.openai.com/v1/models', expect.objectContaining({
            headers: expect.objectContaining({ Authorization: 'Bearer new-key' }),
        }));
    });
    it.each([null, { user: { id: 'reader', role: 'user' } }])('denies non-admin callers: %j', async session => {
        mocks.session.mockResolvedValue(session);
        expect((await POST(request({ provider: 'gemini' }))).status).toBe(403);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it.each(['http://127.0.0.1:8080', 'https://api.openai.com.evil.test', 'https://api.openai.com/?key=secret'])('rejects destination %s before fetching', async baseUrl => {
        expect((await POST(request({ provider: 'gemini', baseUrl }))).status).toBe(400);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it('redacts remote exceptions', async () => {
        mocks.fetch.mockRejectedValue(new Error('secret-key from remote server'));
        const res = await POST(request({ provider: 'gemini' }));
        expect(res.status).toBe(502);
        expect(JSON.stringify(await res.json())).not.toContain('secret-key');
    });
});
