import { createHash } from "node:crypto";
import type { Language } from "@/lib/translations";
import type { TranslatableContent, TranslatedContent } from "@/lib/ai/types";

/**
 * 错题内容的机器翻译只作为原文之上的视图保存在 ErrorItemTranslation 里，
 * 永远不写回 ErrorItem：学生的原题、答案、解析和笔记不会因为翻译而丢失。
 */
export const TRANSLATABLE_FIELDS = ['questionText', 'answerText', 'analysis', 'wrongAnswerText', 'mistakeAnalysis', 'userNotes'] as const;
export type TranslatableField = (typeof TRANSLATABLE_FIELDS)[number];

export const MAX_FIELD_CHARS = 8000;

/** 只取有内容的可翻译字段（超长字段截断前由调用方拒绝） */
export function translatableContent(item: Partial<Record<TranslatableField, string | null>>): TranslatableContent {
    const content: TranslatableContent = {};
    for (const field of TRANSLATABLE_FIELDS) {
        const value = item[field];
        if (typeof value === 'string' && value.trim()) content[field] = value;
    }
    return content;
}

/** 原文指纹：原文改过之后，旧译文会被标记为过期 */
export function sourceHash(content: TranslatableContent): string {
    const hash = createHash('sha256');
    for (const field of TRANSLATABLE_FIELDS) hash.update(`${field}\u0000${content[field] ?? ''}\u0001`);
    return hash.digest('hex');
}

/** 只保留模型返回的、我们请求过的非空字符串字段 */
export function parseStoredFields(json: string): TranslatedContent {
    try {
        const parsed = JSON.parse(json);
        const out: TranslatedContent = {};
        for (const field of TRANSLATABLE_FIELDS) {
            if (typeof parsed?.[field] === 'string' && parsed[field]) out[field] = parsed[field];
        }
        return out;
    } catch {
        return {};
    }
}

/**
 * 去掉与语言无关的部分（LaTeX、Markdown、数字、选项字母）再判断语言，
 * 否则它们会在短答案里占多数，让中文题目看起来像「英文」。
 */
export function proseOnly(text: string): string {
    return text
        .replace(/\$\$[\s\S]*?\$\$/g, ' ')
        .replace(/\$[^$\n]*\$/g, ' ')
        .replace(/\\[a-zA-Z]+/g, ' ')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[#>*_`|~[\]()]/g, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/\b\d+(?:[.,]\d+)?\b/g, ' ')
        .replace(/\b[ABCD]\b/g, ' ');
}

const SPANISH_WORDS = /\b(el|la|los|las|que|de|del|en|un|una|es|son|por|para|con|se|al|lo|como|más|cuál|qué)\b/gi;
const ENGLISH_WORDS = /\b(the|and|is|are|of|to|in|that|for|with|this|it|what|which|find|if|then)\b/gi;

/**
 * 内容是否已经是目标语言。证据不足时返回 false，交给模型处理（提示词要求原样返回）。
 * 英语和西班牙语同为拉丁字母，靠常见虚词和西语特有字符区分，不能只看「没有汉字」。
 */
export function looksLikeTargetLanguage(text: string, target: Language): boolean {
    const prose = proseOnly(text.slice(0, 4000));
    const letters = prose.replace(/\s+/g, '');
    if (letters.length < 12) return false;

    const cjk = (prose.match(/[一-鿿]/g) || []).length;
    const latin = (prose.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    if (cjk + latin === 0) return false;
    if (target === 'zh') return cjk / (cjk + latin) > 0.3;
    if (cjk > 0 || letters.length < 40) return false;

    const spanish = (prose.match(SPANISH_WORDS) || []).length + 2 * (prose.match(/[ñ¿¡]/gi) || []).length;
    const english = (prose.match(ENGLISH_WORDS) || []).length;
    return target === 'es' ? spanish > english * 1.5 && spanish >= 2 : english > spanish * 1.5 && english >= 2;
}
