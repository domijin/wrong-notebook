/**
 * 密码强度规则（参考 NIST SP 800-63B）：只看长度和是否易猜，不强制大小写/符号组合。
 * 注册、修改密码等所有设置新密码的入口都应调用 checkPassword。
 */
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import { adjacencyGraphs, dictionary } from '@zxcvbn-ts/language-common';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72; // bcrypt 只使用前 72 字节
/** zxcvbn 评分 0–4，3 表示「能抵御离线慢哈希攻击」 */
export const PASSWORD_MIN_SCORE = 3;

export type PasswordProblem = 'too_short' | 'too_long' | 'too_weak';

export const PASSWORD_MESSAGES: Record<PasswordProblem, string> = {
    too_short: `密码至少需要 ${PASSWORD_MIN_LENGTH} 个字符`,
    too_long: `密码不能超过 ${PASSWORD_MAX_BYTES} 字节`,
    too_weak: '密码太容易被猜到：请避免常见密码、键盘序列、重复字符，以及邮箱或名字；可以用几个不相关的词组成一句长口令',
};

let zxcvbn: ZxcvbnFactory | null = null;

/** 返回问题代码，密码合格时返回 null */
export function checkPassword(password: string, userInputs: Array<string | null | undefined> = []): PasswordProblem | null {
    if ([...password].length < PASSWORD_MIN_LENGTH) return 'too_short';
    if (Buffer.byteLength(password) > PASSWORD_MAX_BYTES) return 'too_long';

    zxcvbn ??= new ZxcvbnFactory({ dictionary, graphs: adjacencyGraphs });
    // 邮箱、名字及其拆出的单词（如 admin@smoke.test → admin、smoke、test）作为用户相关词，
    // 用它们拼出的密码会被大幅降分
    const inputs = userInputs.flatMap(value => {
        const trimmed = value?.trim();
        if (!trimmed) return [];
        const parts = trimmed.split(/[^\p{L}\p{N}]+/u).filter(part => part.length >= 3);
        return [trimmed, ...parts];
    });
    if (isMostlyPersonal(password, inputs)) return 'too_weak';
    return zxcvbn.check(password, inputs).score >= PASSWORD_MIN_SCORE ? null : 'too_weak';
}

/**
 * zxcvbn 会把用户词之间的片段（如 admin-smoke-test 里的 -smoke-）按随机字符估分，
 * 所以另外检查：去掉邮箱/名字里的词和所有符号后，剩下的字母数字不足 6 个就视为个人信息拼凑
 */
function isMostlyPersonal(password: string, inputs: string[]): boolean {
    let rest = password.toLowerCase();
    const words = inputs.map(word => word.toLowerCase()).filter(word => word.length >= 3).sort((a, b) => b.length - a.length);
    for (const word of words) rest = rest.split(word).join('');
    return words.length > 0 && rest.replace(/[^\p{L}\p{N}]/gu, '').length < 6;
}
