// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { hash } from 'bcryptjs';
import type { AppConfig } from '@/lib/config';

const state = vi.hoisted(() => ({
    directory: '', session: vi.fn(), ai: vi.fn(), updateConfig: vi.fn<(input: Partial<AppConfig>) => AppConfig>(),
    config: {} as AppConfig, now: Date.now(),
}));
vi.mock('next-auth', () => ({ getServerSession: state.session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/ai', () => ({ getAIService: state.ai }));
vi.mock('@/lib/config', () => ({
    getAppConfig: () => state.config,
    updateAppConfig: (input: Partial<AppConfig>) => state.updateConfig(input),
}));
vi.mock('@/lib/prisma', async () => {
    const { PrismaClient } = await import('@prisma/client');
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    state.directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-security-'));
    return { prisma: new PrismaClient({ datasources: { db: { url: `file:${state.directory}/test.db` } } }) };
});

import { prisma } from '@/lib/prisma';
import { getCurrentSession } from '@/lib/current-session';
import { GET as settingsGET, POST as settingsPOST } from '@/app/api/settings/route';
import { GET as clientSettingsGET } from '@/app/api/settings/client/route';
import { PATCH as notesPATCH } from '@/app/api/error-items/[id]/notes/route';
import { POST as practicePOST } from '@/app/api/practice/generate/route';
import { PATCH as userPATCH } from '@/app/api/user/route';
import { PATCH as adminPATCH, DELETE as adminDELETE } from '@/app/api/admin/users/[id]/route';
import { POST as resetPOST } from '@/app/api/admin/system-reset/route';
import { POST as uploadPOST } from '@/app/api/openclaw/batch-upload/route';
import { GET as tagStatsGET } from '@/app/api/tags/stats/route';

const password = 'test-current-password';
let passwordHash: string;
const request = (body?: unknown, method = 'POST', reauth?: string) => new Request('http://localhost/api/test', {
    method, ...(body !== undefined && { body: JSON.stringify(body) }),
    headers: { 'Content-Type': 'application/json', ...(reauth && { 'x-reauth-password': reauth }) },
});
const params = (id: string) => ({ params: Promise.resolve({ id }) });
function signIn(id = 'admin', extra = {}) {
    state.session.mockResolvedValue({ user: { id, email: 'stale@example.com', role: 'admin', sessionVersion: 0,
        authenticatedAt: state.now - 600000, ...extra }, expires: '2030-01-01' });
}

beforeAll(async () => {
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: `file:${state.directory}/test.db` }, stdio: 'pipe',
    });
    passwordHash = await hash(password, 4);
}, 30000);

beforeEach(async () => {
    state.now += 16 * 60000;
    vi.spyOn(Date, 'now').mockReturnValue(state.now);
    await prisma.user.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.user.createMany({ data: [
        { id: 'admin', email: 'owner@example.com', password: passwordHash, role: 'admin', isActive: true },
        { id: 'reader', email: 'reader@example.com', password: passwordHash, role: 'user', isActive: true },
        { id: 'foreign', email: 'foreign@example.com', password: passwordHash, role: 'user', isActive: true },
    ] });
    await prisma.subject.create({ data: { id: 'foreign-notebook', name: '数学', userId: 'foreign' } });
    await prisma.errorItem.create({ data: {
        id: 'foreign-item', userId: 'foreign', subjectId: 'foreign-notebook', originalImageUrl: 'image', questionText: 'private question',
    } });
    state.config = {
        aiProvider: 'gemini', allowRegistration: false, timeouts: { analyze: 180000 },
        gemini: { apiKey: 'secret-gemini', model: 'gemini-test' }, azure: { apiKey: 'secret-azure' },
        openai: { instances: [{ id: 'instance', name: 'Test', apiKey: 'secret-openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' }], activeInstanceId: 'instance' },
    };
    state.updateConfig.mockImplementation(input => ({ ...state.config, ...input }));
    signIn();
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

afterAll(async () => {
    await prisma.$disconnect();
    rmSync(state.directory, { recursive: true, force: true });
});

describe('current account enforcement with SQLite', () => {
    it('uses id and current DB role/email, not stale claims', async () => {
        signIn('reader');
        const session = await getCurrentSession();
        expect(session?.user.role).toBe('user');
        expect(session?.user.email).toBe('reader@example.com');
        expect((await settingsGET()).status).toBe(403);
    });
    it.each(['disabled', 'deleted', 'revoked', 'legacy'])('rejects %s sessions', async mode => {
        if (mode === 'disabled') await prisma.user.update({ where: { id: 'admin' }, data: { isActive: false } });
        if (mode === 'deleted') await prisma.user.delete({ where: { id: 'admin' } });
        if (mode === 'revoked') await prisma.user.update({ where: { id: 'admin' }, data: { sessionVersion: 1 } });
        if (mode === 'legacy') signIn('admin', { sessionVersion: undefined });
        expect(await getCurrentSession()).toBeNull();
        expect((await settingsGET()).status).toBe(403);
    });
    it('fails closed on database errors', async () => {
        await prisma.$executeRawUnsafe('ALTER TABLE User RENAME TO UnavailableUser');
        try { expect(await getCurrentSession()).toBeNull(); }
        finally { await prisma.$executeRawUnsafe('ALTER TABLE UnavailableUser RENAME TO User'); }
    });
});

describe('settings and audited step-up authentication', () => {
    it('returns key flags and never raw keys', async () => {
        const response = await settingsGET();
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(JSON.stringify(body)).not.toContain('secret-');
        expect(body.openai.instances[0].keyConfigured).toBe(true);
        expect(body.gemini.keyConfigured).toBe(true);
        expect(body.azure.keyConfigured).toBe(true);
    });
    it('gives normal users only client timeout settings', async () => {
        signIn('reader');
        expect(await (await clientSettingsGET()).json()).toEqual({ timeouts: { analyze: 180000 } });
    });
    it.each([undefined, 'wrong-password'])('denies stale admin mutations without valid password: %s', async reauth => {
        const response = await settingsPOST(request({ allowRegistration: true }, 'POST', reauth));
        expect(response.status).toBe(403);
        expect(state.updateConfig).not.toHaveBeenCalled();
        expect(await prisma.auditLog.findFirst()).toMatchObject({ actorId: 'admin', action: 'settings.update', target: 'system', result: 'denied' });
    });
    it('accepts password re-entry, persists replacement keys without echo or audit disclosure', async () => {
        const response = await settingsPOST(request({ gemini: { apiKey: 'new-secret-key' } }, 'POST', password));
        expect(response.status).toBe(200);
        expect(state.updateConfig).toHaveBeenCalledWith(expect.objectContaining({ gemini: { apiKey: 'new-secret-key' } }));
        expect(JSON.stringify(await response.json())).not.toContain('new-secret-key');
        const logs = JSON.stringify(await prisma.auditLog.findMany());
        expect(logs).not.toContain(password);
        expect(logs).not.toContain('new-secret-key');
        expect(logs).toContain('success');
    });
    it('accepts a recent login without password re-entry', async () => {
        signIn('admin', { authenticatedAt: state.now - 1000 });
        expect((await settingsPOST(request({ allowRegistration: true }))).status).toBe(200);
    });
    it('preserves keys omitted from sanitized UI writes', async () => {
        const body = await (await settingsGET()).json();
        expect((await settingsPOST(request(body, 'POST', password))).status).toBe(200);
        expect(state.updateConfig.mock.calls[0][0].openai?.instances?.[0]?.apiKey).toBe('secret-openai');
        expect(state.updateConfig.mock.calls[0][0].gemini?.apiKey).toBe('secret-gemini');
    });
    it('allows removal of the last OpenAI instance without keeping its selection', async () => {
        expect((await settingsPOST(request({ openai: { instances: [] } }, 'POST', password))).status).toBe(200);
        expect(state.updateConfig.mock.calls[0][0].openai).toEqual({ instances: [], activeInstanceId: undefined });
    });
    it('records server failures without storing error payloads', async () => {
        state.updateConfig.mockImplementationOnce(() => { throw new Error('provider-secret-value'); });
        expect((await settingsPOST(request({ allowRegistration: true }, 'POST', password))).status).toBe(500);
        const audit = await prisma.auditLog.findFirst();
        expect(audit?.result).toBe('failure');
        expect(JSON.stringify(audit)).not.toContain('provider-secret-value');
    });
    it.each([
        { allowRegistration: 'true' }, { timeouts: { analyze: 99999999 } }, { unexpected: 'value' },
        { gemini: { baseUrl: 'http://169.254.169.254' } },
        { azure: { endpoint: 'https://api.openai.com.evil.test' } },
    ])('rejects invalid settings: %j', async body => {
        expect((await settingsPOST(request(body, 'POST', password))).status).toBe(400);
        expect(state.updateConfig).not.toHaveBeenCalled();
    });
    it('denies mutations if creating the audit record fails', async () => {
        await prisma.$executeRawUnsafe('ALTER TABLE AuditLog RENAME TO UnavailableAudit');
        try {
            expect((await settingsPOST(request({ allowRegistration: true }, 'POST', password))).status).toBe(500);
            expect(state.updateConfig).not.toHaveBeenCalled();
        } finally { await prisma.$executeRawUnsafe('ALTER TABLE UnavailableAudit RENAME TO AuditLog'); }
    });
});

describe('owned items', () => {
    it('does not reveal other accounts through tag statistics', async () => {
        signIn('reader');
        await prisma.errorItem.update({ where: { id: 'foreign-item' }, data: { knowledgePoints: '["private-tag"]' } });
        const response = await tagStatsGET(request(undefined, 'GET'));
        expect(await response.json()).toEqual({ stats: [], total: 0, uniqueTags: 0 });
    });
    it('rejects missing item IDs before AI calls', async () => {
        signIn('reader');
        expect((await practicePOST(request({}))).status).toBe(400);
        expect(state.ai).not.toHaveBeenCalled();
    });
    it('rejects foreign notes updates without modifying the item', async () => {
        signIn('reader');
        expect((await notesPATCH(request({ userNotes: 'overwrite' }, 'PATCH'), params('foreign-item'))).status).toBe(404);
        expect((await prisma.errorItem.findUnique({ where: { id: 'foreign-item' } }))?.userNotes).toBeNull();
    });
    it('rejects foreign practice generation before touching AI', async () => {
        signIn('reader');
        expect((await practicePOST(request({ errorItemId: 'foreign-item' }))).status).toBe(404);
        expect(state.ai).not.toHaveBeenCalled();
    });
    it('allows owned notes updates', async () => {
        signIn('foreign');
        expect((await notesPATCH(request({ userNotes: 'my notes' }, 'PATCH'), params('foreign-item'))).status).toBe(200);
        expect((await prisma.errorItem.findUnique({ where: { id: 'foreign-item' } }))?.userNotes).toBe('my notes');
    });
});

describe('profile credentials and admin account actions', () => {
    it('requires current password for email/password edits', async () => {
        signIn('reader');
        for (const body of [{ email: 'new@example.com' }, { password: 'new-password' }, { password: 'new-password', currentPassword: 'wrong' }]) {
            expect((await userPATCH(request(body, 'PATCH'))).status).toBe(401);
        }
        expect((await prisma.user.findUnique({ where: { id: 'reader' } }))?.sessionVersion).toBe(0);
    });
    it('increments sessionVersion on password change and revokes the old session', async () => {
        signIn('reader');
        const response = await userPATCH(request({ password: 'replacement-password', currentPassword: password }, 'PATCH'));
        expect(response.status).toBe(200);
        expect((await prisma.user.findUnique({ where: { id: 'reader' } }))?.sessionVersion).toBe(1);
        expect(await getCurrentSession()).toBeNull();
    });
    it('rejects stale admin user actions and reset without reauth', async () => {
        expect((await adminDELETE(request(undefined, 'DELETE'), params('reader'))).status).toBe(403);
        expect((await adminPATCH(request({ isActive: false }, 'PATCH'), params('reader'))).status).toBe(403);
        expect((await resetPOST(request({}))).status).toBe(403);
        expect(await prisma.user.count()).toBe(3);
    });
    it('revokes sessions on disable and returns no password hash', async () => {
        const response = await adminPATCH(request({ isActive: false }, 'PATCH', password), params('reader'));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.password).toBeUndefined();
        expect((await prisma.user.findUnique({ where: { id: 'reader' } }))?.sessionVersion).toBe(1);
        signIn('reader');
        expect(await getCurrentSession()).toBeNull();
    });
    it('deletes a user without returning its hash and preserves the audit record', async () => {
        const response = await adminDELETE(request(undefined, 'DELETE', password), params('reader'));
        expect(response.status).toBe(200);
        expect((await response.json()).password).toBeUndefined();
        expect(await prisma.auditLog.findFirst()).toMatchObject({ actorId: 'admin', action: 'user.delete', target: 'reader', result: 'success' });
    });
    it('protects the only active admin and validates admin writes', async () => {
        expect((await adminPATCH(request({ isActive: false }, 'PATCH', password), params('admin'))).status).toBe(400);
        expect((await adminPATCH(request({ role: 'user' }, 'PATCH', password), params('admin'))).status).toBe(400);
        expect((await adminDELETE(request(undefined, 'DELETE', password), params('admin'))).status).toBe(400);
        expect((await adminPATCH(request({ isActive: 'false' }, 'PATCH', password), params('reader'))).status).toBe(400);
        expect(await prisma.user.count({ where: { role: 'admin', isActive: true } })).toBe(1);
    });
    it('reset retains the current active admin and audit history', async () => {
        expect((await resetPOST(request({}, 'POST', password))).status).toBe(200);
        expect(await prisma.user.count()).toBe(1);
        expect(await prisma.errorItem.count()).toBe(0);
        expect(await prisma.auditLog.findFirst()).toMatchObject({ actorId: 'admin', action: 'system.reset', result: 'success' });
    });
});

describe('Openclaw integration boundaries', () => {
    const images = [{ base64: 'aGVsbG8=', mimeType: 'image/png', filename: 'test.png' }];
    const setup = () => {
        vi.stubEnv('OPENCLAW_API_URL', 'http://localhost:8080');
        vi.stubEnv('OPENCLAW_AUTH_MODE', 'apikey');
        vi.stubEnv('OPENCLAW_INTEGRATION_API_KEY', 'integration-key');
        vi.stubEnv('OPENCLAW_USER_EMAIL', 'reader@example.com');
    };
    const upload = (body: unknown) => uploadPOST(new Request('http://localhost/api/openclaw/batch-upload', {
        method: 'POST', body: JSON.stringify(body), headers: { 'x-api-key': 'integration-key' },
    }));
    it('rejects missing config without falling back to another auth mode', async () => {
        vi.stubEnv('OPENCLAW_API_URL', '');
        expect((await upload({ images })).status).toBe(503);
        setup();
        vi.stubEnv('OPENCLAW_INTEGRATION_API_KEY', '');
        expect((await upload({ images, username: 'reader@example.com', password })).status).toBe(503);
    });
    it('rejects shared-key impersonation and foreign notebooks before recognition', async () => {
        setup();
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        expect((await upload({ images, userEmail: 'foreign@example.com' })).status).toBe(403);
        expect((await upload({ images, subjectId: 'foreign-notebook' })).status).toBe(404);
        expect(fetch).not.toHaveBeenCalled();
    });
    it.each(['apikey', 'credentials'])('checks isActive in %s auth', async mode => {
        setup(); vi.stubEnv('OPENCLAW_AUTH_MODE', mode);
        await prisma.user.update({ where: { id: 'reader' }, data: { isActive: false } });
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        expect((await upload({ images, username: 'reader@example.com', password })).status).toBe(403);
        expect(fetch).not.toHaveBeenCalled();
    });
    it.each(['apikey', 'credentials'])('uploads only to the authenticated/bound user in %s mode', async mode => {
        setup(); vi.stubEnv('OPENCLAW_AUTH_MODE', mode);
        vi.stubEnv('OPENCLAW_API_URL', 'http://localhost:8080/');
        vi.stubEnv('OPENCLAW_API_KEY', 'agent-test-key');
        const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: {
            questionText: 'Question', answerText: 'Answer', analysis: 'Analysis', knowledgePoints: [],
        } }) }));
        vi.stubGlobal('fetch', fetch);
        expect((await upload({ images, username: 'reader@example.com', password })).status).toBe(201);
        expect(fetch).toHaveBeenCalledWith('http://localhost:8080/api/recognize', expect.objectContaining({
            redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer agent-test-key' }), signal: expect.any(AbortSignal),
        }));
        expect(await prisma.errorItem.count({ where: { userId: 'reader' } })).toBe(1);
        expect(await prisma.errorItem.count({ where: { userId: 'foreign' } })).toBe(1);
    });
});
