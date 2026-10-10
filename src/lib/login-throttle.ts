/**
 * 登录失败限流（参考 OWASP Authentication Cheat Sheet），状态存数据库，重启不清零。
 *
 * - 账号：连续失败 5 次锁 15 分钟，10 次锁 1 小时，15 次起每 5 次锁 24 小时；
 *   登录成功清零，24 小时没有新的失败也清零。
 * - IP：15 分钟内失败 20 次锁 15 分钟。只有配置了 AUTH_CLIENT_IP_HEADER（可信反向代理写入的
 *   客户端 IP 头）时才启用，否则所有请求都会被当成代理自己的 IP。
 */
import { isIP } from 'node:net';
import { prisma } from '@/lib/prisma';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const THROTTLE_POLICY = {
    account: { resetAfterMs: 24 * HOUR },
    ip: { resetAfterMs: 15 * MINUTE, maxFailures: 20, lockMs: 15 * MINUTE },
} as const;

type Kind = keyof typeof THROTTLE_POLICY;

export interface ThrottleState {
    failures: number;
    lastFailureAt: Date | null;
    lockedUntil: Date | null;
}

/** 达到某个失败次数时应锁定的时长，0 表示不锁 */
export function lockDurationMs(kind: Kind, failures: number): number {
    if (kind === 'ip') return failures > 0 && failures % THROTTLE_POLICY.ip.maxFailures === 0 ? THROTTLE_POLICY.ip.lockMs : 0;
    if (failures === 5) return 15 * MINUTE;
    if (failures === 10) return HOUR;
    if (failures >= 15 && failures % 5 === 0) return 24 * HOUR;
    return 0;
}

/** 记一次失败后的新状态：超过重置窗口的旧失败不累计 */
export function nextState(kind: Kind, state: ThrottleState | null, now: Date): ThrottleState {
    const stale = !state?.lastFailureAt || now.getTime() - state.lastFailureAt.getTime() > THROTTLE_POLICY[kind].resetAfterMs;
    const failures = (stale ? 0 : state!.failures) + 1;
    const lock = lockDurationMs(kind, failures);
    return {
        failures,
        lastFailureAt: now,
        lockedUntil: lock ? new Date(now.getTime() + lock) : (state?.lockedUntil ?? null),
    };
}

export function throttleKeys(email: string, ip: string | null): string[] {
    return [`account:${email.trim().toLowerCase()}`, ...(ip ? [`ip:${ip}`] : [])];
}

const kindOf = (key: string): Kind => (key.startsWith('ip:') ? 'ip' : 'account');

/** 任一 key 仍在锁定期内时返回解锁时间 */
export async function getLockout(keys: string[], now = new Date()): Promise<Date | null> {
    const rows = await prisma.authThrottle.findMany({ where: { key: { in: keys }, lockedUntil: { gt: now } } });
    return rows.reduce<Date | null>((latest, row) => (!latest || row.lockedUntil! > latest ? row.lockedUntil : latest), null);
}

export async function recordFailure(keys: string[], now = new Date()): Promise<void> {
    for (const key of keys) {
        const current = await prisma.authThrottle.findUnique({ where: { key } });
        const next = nextState(kindOf(key), current, now);
        await prisma.authThrottle.upsert({ where: { key }, create: { key, ...next }, update: next });
    }
    // 顺手清理早已过期的记录，表的大小只和近期失败的账号/IP 数有关
    await prisma.authThrottle.deleteMany({
        where: {
            lastFailureAt: { lt: new Date(now.getTime() - THROTTLE_POLICY.account.resetAfterMs) },
            OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
        },
    });
}

export async function clearFailures(key: string): Promise<void> {
    await prisma.authThrottle.deleteMany({ where: { key } });
}

/** 从可信代理写入的请求头读取客户端 IP；X-Forwarded-For 取最后一跳（离我们最近的代理写入的那个） */
export function clientIpFromHeaders(headers: Record<string, unknown> | undefined, headerName = process.env.AUTH_CLIENT_IP_HEADER): string | null {
    if (!headerName || !headers) return null;
    const raw = headers[headerName.toLowerCase()];
    const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;
    if (typeof value !== 'string') return null;
    const candidate = value.split(',').map(part => part.trim()).filter(Boolean).pop() ?? '';
    return isIP(candidate) ? candidate : null;
}
