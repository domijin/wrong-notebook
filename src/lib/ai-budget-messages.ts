/** 预算类拒绝（每日上限、额度保护）在前端对应的提示；不是这几种时返回 undefined */
export const AI_BUDGET_CODES = ['AI_DAILY_LIMIT_USER', 'AI_DAILY_LIMIT_SITE', 'AI_QUOTA_PAUSED'] as const;

export function aiBudgetMessage(code: unknown, errors: Record<string, unknown> | undefined): string | undefined {
    if (typeof code !== 'string' || !(AI_BUDGET_CODES as readonly string[]).includes(code)) return undefined;
    const text = errors?.[code];
    return typeof text === 'string' ? text : undefined;
}
