import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { acquireAIWork } from "@/lib/rate-limit";
import { getActiveOpenAIConfig, getAppConfig } from "@/lib/config";
import { createLogger } from "@/lib/logger";

const logger = createLogger('ai-budget');

/**
 * AI 调用预算：在 acquireAIWork（并发和 10 分钟突发上限）之前再加三道闸：
 * - 每个用户每天的调用上限
 * - 全站每天的调用上限
 * - MiniMax Token Plan 余量保护：5 小时窗口或本周余量过低时，暂停非管理员的 AI 功能，给管理员留余量
 * 管理员不受这三道闸限制，但仍计入全站用量。上限值可用环境变量调整，设为 0 表示不限制。
 */
export function budgetSettings() {
    const int = (name: string, fallback: number) => {
        const value = Number.parseInt(process.env[name] ?? '', 10);
        return Number.isFinite(value) && value >= 0 ? value : fallback;
    };
    return {
        perUserDaily: int('AI_DAILY_LIMIT_PER_USER', 200),
        siteDaily: int('AI_DAILY_LIMIT_SITE', 1500),
        minWeeklyPercent: int('AI_QUOTA_MIN_WEEKLY_PERCENT', 25),
        minIntervalPercent: int('AI_QUOTA_MIN_INTERVAL_PERCENT', 10),
        timeZone: process.env.AI_QUOTA_TIMEZONE || 'Asia/Shanghai',
    };
}

/** 计数用的「哪一天」，按配置的时区算（默认北京时间零点换日） */
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
export function usageDay(now: Date, timeZone: string): string {
    let format = dayFormatters.get(timeZone);
    if (!format) {
        format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
        dayFormatters.set(timeZone, format);
    }
    return format.format(now);
}

// ---- MiniMax Token Plan 余量 ------------------------------------------------------

export interface PlanQuota {
    intervalPercent: number;
    weeklyPercent: number;
    intervalEndsAt: number;
    weeklyEndsAt: number;
}

const MINIMAX_HOSTS = new Set(['api.minimax.io', 'api.minimaxi.com']);

/** 只有直连 MiniMax 官方 API 时才查余量；其他网关或按量付费不适用 */
export function minimaxQuotaUrl(baseUrl: string | undefined): string | null {
    if (!baseUrl) return null;
    try {
        const url = new URL(baseUrl);
        return url.protocol === 'https:' && MINIMAX_HOSTS.has(url.hostname) ? `${url.origin}/v1/token_plan/remains` : null;
    } catch {
        return null;
    }
}

/** 从 /v1/token_plan/remains 的响应里取文本模型（general）的剩余百分比 */
export function parsePlanQuota(body: unknown): PlanQuota | null {
    const rows = (body as { model_remains?: unknown })?.model_remains;
    if (!Array.isArray(rows)) return null;
    const row = rows.find(r => r?.model_name === 'general') ?? rows[0];
    const interval = Number(row?.current_interval_remaining_percent);
    const weekly = Number(row?.current_weekly_remaining_percent);
    if (!Number.isFinite(interval) || !Number.isFinite(weekly)) return null;
    return {
        intervalPercent: interval,
        weeklyPercent: weekly,
        intervalEndsAt: Number(row?.end_time) || 0,
        weeklyEndsAt: Number(row?.weekly_end_time) || 0,
    };
}

/** 余量低于阈值时返回暂停原因和建议的重试时间（秒） */
export function quotaPause(quota: PlanQuota, settings: ReturnType<typeof budgetSettings>, now = Date.now()) {
    const retryAfter = (endsAt: number) => Math.max(60, Math.ceil((endsAt - now) / 1000));
    if (settings.minWeeklyPercent && quota.weeklyPercent < settings.minWeeklyPercent) {
        return { window: 'weekly' as const, retryAfter: retryAfter(quota.weeklyEndsAt) };
    }
    if (settings.minIntervalPercent && quota.intervalPercent < settings.minIntervalPercent) {
        return { window: 'interval' as const, retryAfter: retryAfter(quota.intervalEndsAt) };
    }
    return null;
}

const QUOTA_TTL_MS = 5 * 60 * 1000;
const QUOTA_ERROR_TTL_MS = 60 * 1000;
let quotaCache: { url: string; at: number; ttl: number; quota: PlanQuota | null } | null = null;

/** 查询（并缓存）当前 MiniMax 套餐余量；查不到时返回 null，不拦截 AI 调用 */
export async function currentPlanQuota(now = Date.now()): Promise<PlanQuota | null> {
    if (getAppConfig().aiProvider !== 'openai') return null;
    const instance = getActiveOpenAIConfig();
    const url = minimaxQuotaUrl(instance?.baseUrl);
    if (!url || !instance?.apiKey) return null;
    if (quotaCache?.url === url && now - quotaCache.at < quotaCache.ttl) return quotaCache.quota;

    let quota: PlanQuota | null = null;
    try {
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${instance.apiKey}` },
            redirect: 'error',
            signal: AbortSignal.timeout(5000),
        });
        if (res.ok) quota = parsePlanQuota(await res.json());
        if (!quota) logger.warn({ status: res.status }, 'MiniMax quota check returned no usable data');
    } catch (error) {
        logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'MiniMax quota check failed');
    }
    quotaCache = { url, at: now, ttl: quota ? QUOTA_TTL_MS : QUOTA_ERROR_TTL_MS, quota };
    return quota;
}

/** 测试用 */
export function resetPlanQuotaCache() {
    quotaCache = null;
}

// ---- 每日计数 -----------------------------------------------------------------------

async function addUsage(key: string, amount: number): Promise<number> {
    const row = await prisma.aiUsageCounter.upsert({
        where: { key },
        create: { key, count: amount },
        update: { count: { increment: amount } },
    });
    return row.count;
}

async function refundUsage(key: string, amount: number) {
    await prisma.aiUsageCounter.update({ where: { key }, data: { count: { decrement: amount } } }).catch(() => {});
}

let lastCleanupDay = '';
async function cleanupOldCounters(day: string) {
    if (lastCleanupDay === day) return;
    lastCleanupDay = day;
    await prisma.aiUsageCounter.deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - 8 * 24 * 3600 * 1000) } } }).catch(() => {});
}

function rejection(message: string, status: number, retryAfter: number) {
    return NextResponse.json({ message }, { status, headers: { 'Retry-After': String(retryAfter) } });
}

function secondsUntilNextDay(now: Date, timeZone: string) {
    // 时区偏移都是 15 分钟的整数倍，按 15 分钟步进足够找到换日时刻
    const today = usageDay(now, timeZone);
    for (let minutes = 15; minutes <= 25 * 60; minutes += 15) {
        if (usageDay(new Date(now.getTime() + minutes * 60000), timeZone) !== today) return minutes * 60;
    }
    return 24 * 3600;
}

/**
 * 放行一次 AI 工作（cost 为本次要发起的 AI 调用数，批量上传时等于图片数）。
 * 返回 acquireAIWork 的句柄（用完要 release），或一个应直接返回给客户端的错误响应。
 */
export async function admitAIWork(
    user: { id: string; role?: string | null },
    cost = 1,
): Promise<{ release: () => void } | NextResponse> {
    const settings = budgetSettings();
    const isAdmin = user.role === 'admin';
    const now = new Date();

    if (!isAdmin) {
        const quota = await currentPlanQuota(now.getTime());
        const pause = quota && quotaPause(quota, settings, now.getTime());
        if (pause) {
            logger.warn({ window: pause.window, weekly: quota.weeklyPercent, interval: quota.intervalPercent }, 'AI paused for non-admins: plan quota low');
            return rejection('AI_QUOTA_PAUSED', 503, pause.retryAfter);
        }
    }

    const day = usageDay(now, settings.timeZone);
    await cleanupOldCounters(day);
    const userKey = `user:${user.id}:${day}`;
    const siteKey = `site:${day}`;
    const untilTomorrow = secondsUntilNextDay(now, settings.timeZone);

    const userCount = await addUsage(userKey, cost);
    if (!isAdmin && settings.perUserDaily && userCount > settings.perUserDaily) {
        await refundUsage(userKey, cost);
        return rejection('AI_DAILY_LIMIT_USER', 429, untilTomorrow);
    }
    const siteCount = await addUsage(siteKey, cost);
    if (!isAdmin && settings.siteDaily && siteCount > settings.siteDaily) {
        await Promise.all([refundUsage(userKey, cost), refundUsage(siteKey, cost)]);
        return rejection('AI_DAILY_LIMIT_SITE', 429, untilTomorrow);
    }

    const work = acquireAIWork(user.id);
    if (work instanceof Response) {
        // 没真正发起调用，不占当天额度
        await Promise.all([refundUsage(userKey, cost), refundUsage(siteKey, cost)]);
    }
    return work;
}

