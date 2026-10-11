import { admitAIWork } from "@/lib/ai-budget";
import { getCurrentSession } from "@/lib/current-session";
import { NextResponse } from "next/server";
import { getAIService } from "@/lib/ai";
import type { TranslatableContent, TranslatedContent } from "@/lib/ai/types";
import { LANGUAGES, normalizeLanguage } from "@/lib/translations";
import { badRequest, createErrorResponse, ErrorCode, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:translate');

const MAX_FIELD_CHARS = 8000;
const MAX_FIELDS = 5;

export const dynamic = 'force-dynamic';

/**
 * Strip the parts of a study note that are language-neutral before deciding
 * whether it is already in the target language: LaTeX, Markdown, numbers and
 * option letters. Left in place they dominate short answers and make a
 * Chinese question look "English" because it happens to contain no CJK in the
 * first 1500 characters.
 */
function proseOnly(text: string): string {
    return text
        // $$...$$ and $...$ (LaTeX)
        .replace(/\$\$[\s\S]*?\$\$/g, ' ')
        .replace(/\$[^$\n]*\$/g, ' ')
        // \command{...}
        .replace(/\\[a-zA-Z]+/g, ' ')
        // Markdown syntax, URLs, bare numbers, and A/B/C/D markers
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[#>*_`|~[\]()]/g, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/\b\d+(?:[.,]\d+)?\b/g, ' ')
        .replace(/\b[ABCD]\b/g, ' ');
}

/**
 * Heuristic: does this text already read as the target language?
 *
 * Returns false when there is too little prose to judge, so a short or
 * math-only answer is still sent to the model rather than silently skipped.
 */
function looksLikeTargetLanguage(text: string, target: string): boolean {
    const prose = proseOnly(text.slice(0, 4000));
    // Need real prose before deciding; otherwise let the model try.
    if (prose.replace(/\s+/g, '').length < 12) return false;

    const cjk = (prose.match(/[一-鿿]/g) || []).length;
    const latin = (prose.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    const total = cjk + latin;
    if (total === 0) return false;

    // CJK-dominant text counts as Chinese regardless of target; otherwise
    // compare script ratios.
    if (target === 'zh') return cjk / total > 0.3;
    // English and Spanish share a script; treat as "already" only when the
    // text has no CJK and enough Latin prose to be worth skipping.
    return cjk === 0 && latin / total > 0.7 && prose.replace(/\s+/g, '').length > 40;
}

export async function POST(req: Request) {
    const session = await getCurrentSession();
    if (!session) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    let body: {
        target?: string;
        content?: TranslatableContent;
    };
    try {
        body = await req.json();
    } catch {
        return badRequest("Invalid JSON body");
    }

    // Reject unsupported targets outright. normalizeLanguage() would silently
    // fall back to 'zh', which would translate into the wrong language.
    const target = typeof body.target === 'string' ? body.target.trim() : '';
    if (!target || !LANGUAGES.includes(target as (typeof LANGUAGES)[number])) {
        return badRequest(`target must be one of: ${LANGUAGES.join(', ')}`);
    }
    const targetLanguage = normalizeLanguage(target);

    const raw = body.content;
    if (!raw || typeof raw !== 'object') {
        return badRequest("content is required");
    }

    // Only allow the known prose fields, and drop empty/oversized ones.
    const content: TranslatableContent = {};
    const allowed = ['questionText', 'answerText', 'analysis', 'mistakeAnalysis', 'userNotes'] as const;
    let kept = 0;
    for (const field of allowed) {
        const value = raw[field];
        if (typeof value !== 'string' || value.trim().length === 0) continue;
        if (value.length > MAX_FIELD_CHARS) {
            return badRequest(`${field} exceeds ${MAX_FIELD_CHARS} characters`);
        }
        content[field] = value;
        if (++kept > MAX_FIELDS) return badRequest("Too many fields");
    }

    if (kept === 0) {
        return badRequest("No translatable content provided");
    }

    // Nothing to do when the content already matches the requested language.
    const primary = content.questionText || content.analysis || content.answerText || '';
    if (looksLikeTargetLanguage(primary, target)) {
        logger.info({ userId: session.user.id, target: targetLanguage }, 'Content already in target language');
        return NextResponse.json({ translated: {} satisfies TranslatedContent, unchanged: true });
    }

    const work = await admitAIWork(session.user);
    if (work instanceof Response) return work;

    try {
        const aiService = getAIService();
        const translated = await aiService.translateContent(content, targetLanguage);

        logger.info({
            userId: session.user.id,
            target: targetLanguage,
            fields: Object.keys(translated),
        }, 'Translation completed');

        return NextResponse.json({ translated, unchanged: false });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error: message, userId: session.user.id }, 'Translation failed');

        if (message.includes('AI_AUTH_ERROR')) {
            return createErrorResponse('AI_AUTH_ERROR', 500, ErrorCode.AI_ERROR);
        }
        if (message.includes('AI_RESPONSE_ERROR') || message.includes('could not parse')) {
            return createErrorResponse('AI_RESPONSE_ERROR', 502, ErrorCode.AI_ERROR);
        }
        return internalError("Failed to translate content");
    } finally {
        work.release();
    }
}
