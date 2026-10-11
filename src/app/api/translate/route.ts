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

/** True when the text looks like it is already (mostly) in the target script. */
function looksLikeTargetLanguage(text: string, target: string): boolean {
    const sample = text.slice(0, 1500);
    if (target === 'es') {
        // Spanish-specific characters that Chinese/English text lacks.
        return /[ñáéíóúü¿¡]/i.test(sample);
    }
    if (target === 'zh') {
        return /[一-鿿]/.test(sample);
    }
    if (target === 'en') {
        // Strip CJK; if almost nothing is left the text is not really English.
        return !/[一-鿿]/.test(sample);
    }
    return false;
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
