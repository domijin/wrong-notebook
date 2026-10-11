import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/current-session";
import { prisma } from "@/lib/prisma";
import { admitAIWork } from "@/lib/ai-budget";
import { getAIService } from "@/lib/ai";
import { LANGUAGES, type Language } from "@/lib/translations";
import { badRequest, createErrorResponse, ErrorCode, internalError, notFound, unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import {
    MAX_FIELD_CHARS,
    looksLikeTargetLanguage,
    parseStoredFields,
    sourceHash,
    translatableContent,
} from "@/lib/item-translation";

const logger = createLogger('api:error-items:translation');

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function parseLanguage(value: unknown): Language | null {
    return typeof value === 'string' && LANGUAGES.includes(value as Language) ? (value as Language) : null;
}

/** 只能访问自己的错题；不存在和不属于自己都返回 404，不暴露别人的 id */
async function ownedItem(id: string, userId: string) {
    const item = await prisma.errorItem.findUnique({ where: { id } });
    return item && item.userId === userId ? item : null;
}

function present(row: { language: string; fields: string; sourceHash: string; updatedAt: Date }, currentHash: string) {
    return {
        language: row.language,
        fields: parseStoredFields(row.fields),
        stale: row.sourceHash !== currentHash,
        updatedAt: row.updatedAt,
    };
}

/** GET ?lang=en —— 读取已保存的译文（没有则 translation 为 null），不调用 AI */
export async function GET(req: Request, { params }: Params) {
    const session = await getCurrentSession();
    if (!session) return unauthorized();
    const { id } = await params;
    const language = parseLanguage(new URL(req.url).searchParams.get('lang'));
    if (!language) return badRequest(`lang must be one of: ${LANGUAGES.join(', ')}`);

    const item = await ownedItem(id, session.user.id);
    if (!item) return notFound("Item not found");
    const row = await prisma.errorItemTranslation.findUnique({
        where: { errorItemId_language: { errorItemId: id, language } },
    });
    return NextResponse.json({ translation: row ? present(row, sourceHash(translatableContent(item))) : null });
}

/**
 * POST { target, force? } —— 翻译这道错题并保存为译文视图。原文不会被修改。
 * 已有与当前原文一致的译文时直接返回，不重复消耗 AI 额度；force 表示重新翻译。
 */
export async function POST(req: Request, { params }: Params) {
    const session = await getCurrentSession();
    if (!session) return unauthorized();
    const { id } = await params;

    let body: { target?: unknown; force?: unknown };
    try {
        body = await req.json();
    } catch {
        return badRequest("Invalid JSON body");
    }
    const language = parseLanguage(body.target);
    if (!language) return badRequest(`target must be one of: ${LANGUAGES.join(', ')}`);

    const item = await ownedItem(id, session.user.id);
    if (!item) return notFound("Item not found");

    const content = translatableContent(item);
    if (Object.keys(content).length === 0) return badRequest("No translatable content");
    for (const [field, value] of Object.entries(content)) {
        if ((value as string).length > MAX_FIELD_CHARS) return badRequest(`${field} exceeds ${MAX_FIELD_CHARS} characters`);
    }

    const primary = content.questionText || content.analysis || content.answerText || '';
    if (looksLikeTargetLanguage(primary, language)) {
        return NextResponse.json({ translation: null, unchanged: true });
    }

    const hash = sourceHash(content);
    const existing = await prisma.errorItemTranslation.findUnique({
        where: { errorItemId_language: { errorItemId: id, language } },
    });
    if (existing && existing.sourceHash === hash && body.force !== true) {
        return NextResponse.json({ translation: present(existing, hash), unchanged: false });
    }

    const work = await admitAIWork(session.user);
    if (work instanceof Response) return work;
    try {
        const translated = await getAIService().translateContent(content, language);
        const row = await prisma.errorItemTranslation.upsert({
            where: { errorItemId_language: { errorItemId: id, language } },
            create: { errorItemId: id, language, fields: JSON.stringify(translated), sourceHash: hash },
            update: { fields: JSON.stringify(translated), sourceHash: hash },
        });
        logger.info({ userId: session.user.id, itemId: id, language, fields: Object.keys(translated) }, 'Item translated');
        return NextResponse.json({ translation: present(row, hash), unchanged: false });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error: message, userId: session.user.id, itemId: id }, 'Translation failed');
        if (message.includes('AI_AUTH_ERROR')) return createErrorResponse('AI_AUTH_ERROR', 500, ErrorCode.AI_ERROR);
        if (message.includes('AI_TIMEOUT_ERROR')) return createErrorResponse('AI_TIMEOUT_ERROR', 504, ErrorCode.AI_ERROR);
        if (message.includes('AI_RESPONSE_ERROR') || message.includes('could not parse')) {
            return createErrorResponse('AI_RESPONSE_ERROR', 502, ErrorCode.AI_ERROR);
        }
        return internalError("Failed to translate content");
    } finally {
        work.release();
    }
}

/** DELETE ?lang=en —— 删除译文，回到只有原文 */
export async function DELETE(req: Request, { params }: Params) {
    const session = await getCurrentSession();
    if (!session) return unauthorized();
    const { id } = await params;
    const language = parseLanguage(new URL(req.url).searchParams.get('lang'));
    if (!language) return badRequest(`lang must be one of: ${LANGUAGES.join(', ')}`);
    if (!await ownedItem(id, session.user.id)) return notFound("Item not found");
    await prisma.errorItemTranslation.deleteMany({ where: { errorItemId: id, language } });
    return new NextResponse(null, { status: 204 });
}
