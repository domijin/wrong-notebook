/**
 * 登录限流规则与密码强度规则
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { lockDurationMs, nextState, clientIpFromHeaders, throttleKeys } from '@/lib/login-throttle';
import { checkPassword, PASSWORD_MIN_LENGTH } from '@/lib/password-policy';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('lockDurationMs', () => {
    it('escalates account locks at 5, 10 and every 5 failures from 15', () => {
        expect([1, 4, 6, 9].map(n => lockDurationMs('account', n))).toEqual([0, 0, 0, 0]);
        expect(lockDurationMs('account', 5)).toBe(15 * MINUTE);
        expect(lockDurationMs('account', 10)).toBe(HOUR);
        expect([15, 20, 25].map(n => lockDurationMs('account', n))).toEqual([24 * HOUR, 24 * HOUR, 24 * HOUR]);
        expect(lockDurationMs('account', 16)).toBe(0);
    });
    it('locks an IP for 15 minutes every 20 failures', () => {
        expect(lockDurationMs('ip', 19)).toBe(0);
        expect(lockDurationMs('ip', 20)).toBe(15 * MINUTE);
        expect(lockDurationMs('ip', 40)).toBe(15 * MINUTE);
    });
});

describe('nextState', () => {
    const now = new Date('2026-10-10T08:00:00Z');
    it('counts consecutive failures and sets the lock on the threshold', () => {
        const state = nextState('account', { failures: 4, lastFailureAt: new Date(now.getTime() - MINUTE), lockedUntil: null }, now);
        expect(state).toEqual({ failures: 5, lastFailureAt: now, lockedUntil: new Date(now.getTime() + 15 * MINUTE) });
    });
    it('starts over once the reset window has passed', () => {
        expect(nextState('account', { failures: 9, lastFailureAt: new Date(now.getTime() - 25 * HOUR), lockedUntil: null }, now).failures).toBe(1);
        expect(nextState('ip', { failures: 19, lastFailureAt: new Date(now.getTime() - 16 * MINUTE), lockedUntil: null }, now).failures).toBe(1);
    });
});

describe('clientIpFromHeaders', () => {
    it('ignores headers unless a trusted header is configured', () => {
        expect(clientIpFromHeaders({ 'x-forwarded-for': '203.0.113.7' }, undefined)).toBeNull();
    });
    it('takes the last X-Forwarded-For hop and validates it', () => {
        expect(clientIpFromHeaders({ 'x-forwarded-for': '10.0.0.1, 203.0.113.7' }, 'X-Forwarded-For')).toBe('203.0.113.7');
        expect(clientIpFromHeaders({ 'cf-connecting-ip': '2001:db8::1' }, 'CF-Connecting-IP')).toBe('2001:db8::1');
        expect(clientIpFromHeaders({ 'x-forwarded-for': 'not-an-ip' }, 'x-forwarded-for')).toBeNull();
    });
    it('normalizes the account key to lowercase', () => {
        expect(throttleKeys(' Reader@Example.com ', '203.0.113.7')).toEqual(['account:reader@example.com', 'ip:203.0.113.7']);
    });
});

describe('checkPassword', () => {
    it('rejects passwords shorter than the minimum, counting characters not bytes', () => {
        expect(checkPassword('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe('too_short');
        expect(checkPassword('中文口令很安全吗还差一')).toBe('too_short'); // 11 个字符、33 字节
    });
    it('rejects passwords over the bcrypt 72-byte limit', () => {
        expect(checkPassword('杭'.repeat(25))).toBe('too_long'); // 75 字节
    });
    it.each(['password1234', 'qwertyuiopas', 'aaaaaaaaaaaa', '123456789012'])('rejects guessable %s', password => {
        expect(checkPassword(password)).toBe('too_weak');
    });
    it('rejects passwords built from the account email or name', () => {
        expect(checkPassword('windyfly2026!', ['windyfly@live.cn'])).toBe('too_weak');
        expect(checkPassword('admin-smoke-test', ['admin@smoke.test', 'Admin'])).toBe('too_weak');
    });
    it.each(['correct horse battery staple', 'hangzhou-xihu-2026', 'Smoke-Test-Passw0rd!'])('accepts %s', password => {
        expect(checkPassword(password, ['reader@example.com', 'Reader'])).toBeNull();
    });
});
