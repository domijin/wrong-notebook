import { timingSafeEqual } from "crypto";
import { acquireAIWork, consumeRateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { createErrorResponse, ErrorCode } from "@/lib/api-errors";
import { calculateGrade } from "@/lib/grade-calculator";
import { inferSubjectFromName } from "@/lib/knowledge-tags";
import { findParentTagIdForGrade, findVisibleTagByName } from "@/lib/tag-recognition";
import { compare } from "bcryptjs";

const logger = createLogger('api:openclaw:batch-upload');

const MAX_IMAGES = 20;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

interface ImageData {
    base64: string;
    mimeType: string;
    filename: string;
}

interface OpenclawResponse {
    success: boolean;
    data?: {
        questionText: string;
        answerText: string;
        analysis: string;
        knowledgePoints: string[];
        subject?: string;
        errorType?: string;
        source?: string;
    };
    error?: string;
}

function validateImage(base64: string, filename: string): { valid: boolean; error?: string } {
    if (!base64 || base64.length === 0) {
        return { valid: false, error: '图片数据为空' };
    }

    const extension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
        return { valid: false, error: `不支持的图片格式: ${extension}，仅支持 JPG、PNG` };
    }

    const estimatedSize = (base64.length * 3) / 4;
    if (estimatedSize > MAX_IMAGE_SIZE) {
        return { valid: false, error: `图片大小超过限制: ${Math.round(estimatedSize / 1024 / 1024)}MB > 5MB` };
    }

    return { valid: true };
}

async function callOpenclawAgent(imageBase64: string, mimeType: string, timeout: number): Promise<OpenclawResponse> {
    const openclawUrl = process.env.OPENCLAW_API_URL!.replace(/\/$/, '');
    const openclawApiKey = process.env.OPENCLAW_API_KEY || '';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(`${openclawUrl}/api/recognize`, {
            method: 'POST',
            redirect: 'error',
            headers: {
                'Content-Type': 'application/json',
                ...(openclawApiKey ? { 'Authorization': `Bearer ${openclawApiKey}` } : {}),
            },
            body: JSON.stringify({
                image: imageBase64,
                mimeType: mimeType,
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            logger.error({ status: response.status }, 'Openclaw agent error');
            return {
                success: false,
                error: `识别服务异常: HTTP ${response.status}`,
            };
        }

        const data = await response.json() as OpenclawResponse;
        return data;
    } catch (error: any) {
        if (error.name === 'AbortError') {
            logger.error('Openclaw agent timeout');
            return {
                success: false,
                error: '识别服务超时',
            };
        }
        
        logger.error({ error: error?.message || String(error) }, 'Openclaw agent request failed');
        return {
            success: false,
            error: `识别服务请求失败: ${error?.message || String(error)}`,
        };
    } finally {
        clearTimeout(timeoutId);
    }
}

async function createErrorItem(
    userId: string,
    imageBase64: string,
    mimeType: string,
    parsedData: OpenclawResponse['data'],
    subjectId?: string
) {
    const { questionText, answerText, analysis, knowledgePoints, errorType, source } = parsedData || {};

    const tagNames: string[] = Array.isArray(knowledgePoints) ? knowledgePoints : [];
    const tagConnections: { id: string }[] = [];

    const subject = subjectId ? await prisma.subject.findUnique({ where: { id: subjectId } }) : null;
    const subjectKey = subject ? inferSubjectFromName(subject.name) : null;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { educationStage: true, enrollmentYear: true }
    });

    let finalGradeSemester: string | null = null;
    if (user?.educationStage && user?.enrollmentYear) {
        finalGradeSemester = calculateGrade(user.educationStage, user.enrollmentYear);
    }

    for (const tagName of tagNames) {
        try {
            let tag = await findVisibleTagByName(tagName, subjectKey, userId);

            if (!tag) {
                const parentId = finalGradeSemester && subjectKey 
                    ? await findParentTagIdForGrade(finalGradeSemester, subjectKey)
                    : null;

                tag = await prisma.knowledgeTag.create({
                    data: {
                        name: tagName,
                        subject: subjectKey || 'other',
                        isSystem: false,
                        userId: userId,
                        parentId: parentId || undefined,
                    },
                });
            }

            tagConnections.push({ id: tag.id });
        } catch (tagError) {
            logger.error({ tagName, error: tagError }, 'Error processing tag');
        }
    }

    const errorItem = await prisma.errorItem.create({
        data: {
            userId: userId,
            subjectId: subjectId || undefined,
            originalImageUrl: `data:${mimeType};base64,${imageBase64}`,
            ocrText: questionText || null,
            questionText: questionText || null,
            answerText: answerText || null,
            analysis: analysis || null,
            knowledgePoints: JSON.stringify(tagNames),
            gradeSemester: finalGradeSemester,
            paperLevel: null,
            errorType: errorType || null,
            source: source || 'Openclaw',
            masteryLevel: 0,
            tags: {
                connect: tagConnections,
            },
        },
        include: {
            tags: true,
            subject: true,
        },
    });

    return errorItem;
}

export async function POST(req: Request) {
    logger.info('POST /api/openclaw/batch-upload called');

    const authMode = process.env.OPENCLAW_AUTH_MODE || 'credentials';
    const expectedApiKey = process.env.OPENCLAW_INTEGRATION_API_KEY;
    const configuredEmail = process.env.OPENCLAW_USER_EMAIL;
    const agentUrl = process.env.OPENCLAW_API_URL;
    if (!agentUrl || !['credentials', 'apikey'].includes(authMode)
        || (authMode === 'apikey' && (!expectedApiKey || !configuredEmail))) {
        return createErrorResponse('Openclaw integration is not configured', 503, ErrorCode.OPERATION_NOT_ALLOWED);
    }
    try {
        const url = new URL(agentUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { return createErrorResponse('Invalid Openclaw agent URL', 503, ErrorCode.OPERATION_NOT_ALLOWED); }
    if (!consumeRateLimit('openclaw:global', 60, 60000)) {
        return NextResponse.json({ message: "Too many upload requests" }, { status: 429 });
    }
    let work: { release: () => void } | undefined;
    try {
        const schema = z.object({
            username: z.string().max(254).optional(), password: z.string().refine(value => Buffer.byteLength(value) <= 72).optional(),
            userEmail: z.string().max(254).optional(), subjectId: z.string().max(256).optional(),
            images: z.array(z.object({ base64: z.string().max(7 * 1024 * 1024),
                mimeType: z.enum(['image/jpeg', 'image/png']), filename: z.string().min(1).max(256),
            })).min(1).max(MAX_IMAGES),
        }).strict();
        const parsed = schema.safeParse(await req.json());
        if (!parsed.success) return createErrorResponse('Invalid upload data', 400, ErrorCode.BAD_REQUEST);
        const requestData = parsed.data;
        let dbUser;
        if (authMode === 'apikey') {
            const apiKey = req.headers.get('x-api-key') || '';
            const actual = Buffer.from(apiKey);
            const expected = Buffer.from(expectedApiKey!);
            if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
                return createErrorResponse('Invalid API key', 401, ErrorCode.UNAUTHORIZED);
            }
            if (requestData.userEmail && requestData.userEmail !== configuredEmail) {
                return createErrorResponse('Upload target is not authorized', 403, ErrorCode.FORBIDDEN);
            }
            dbUser = await prisma.user.findUnique({ where: { email: configuredEmail! } });
        } else {
            const { username, password } = requestData;
            if (!username || !password || !consumeRateLimit(`openclaw-login:${username.toLowerCase()}`, 10, 15 * 60000)) {
                return createErrorResponse('Invalid credentials or too many attempts', 401, ErrorCode.UNAUTHORIZED);
            }
            dbUser = await prisma.user.findFirst({ where: { OR: [{ email: username }, { name: username }] } });
            if (!dbUser || !await compare(password, dbUser.password)) {
                return createErrorResponse('Invalid credentials', 401, ErrorCode.UNAUTHORIZED);
            }
        }
        if (!dbUser?.isActive) return createErrorResponse('Account is unavailable', 403, ErrorCode.FORBIDDEN);
        const subjectId = requestData.subjectId;
        if (subjectId && !await prisma.subject.findFirst({ where: { id: subjectId, userId: dbUser.id } })) {
            return createErrorResponse('Notebook not found', 404, ErrorCode.NOT_FOUND);
        }
        if (requestData.images.reduce((size, image) => size + image.base64.length * 3 / 4, 0) > 20 * 1024 * 1024) {
            return createErrorResponse('Batch exceeds 20MB', 400, ErrorCode.BAD_REQUEST);
        }
        const acquired = acquireAIWork(dbUser.id);
        if (acquired instanceof Response) return acquired;
        work = acquired;
        // 获取图片数组
        const { images } = requestData;

        // 验证图片数组
        if (!images || !Array.isArray(images) || images.length === 0) {
            return createErrorResponse(
                '未提供图片数据',
                400,
                ErrorCode.BAD_REQUEST,
                'Missing images array'
            );
        }

        // 验证图片数量
        if (images.length > MAX_IMAGES) {
            return createErrorResponse(
                `图片数量超过限制: 最多${MAX_IMAGES}张`,
                400,
                ErrorCode.BAD_REQUEST,
                `Maximum ${MAX_IMAGES} images allowed`
            );
        }

        const timeout = Math.max(1000, Math.min(60000, Number(process.env.OPENCLAW_TIMEOUT) || 30000));
        const singleImageTimeout = Math.min(3000, timeout / images.length);
        const results: Array<{
            success: boolean;
            index: number;
            errorItemId?: string;
            error?: string;
        }> = [];

        for (let i = 0; i < images.length; i++) {
            const imageData = images[i] as ImageData;
            const { base64, mimeType, filename } = imageData;

            const validation = validateImage(base64, filename);
            if (!validation.valid) {
                logger.warn({ index: i, filename, error: validation.error }, 'Image validation failed');
                results.push({
                    success: false,
                    index: i,
                    error: validation.error,
                });
                continue;
            }

            const openclawResponse = await callOpenclawAgent(base64, mimeType, singleImageTimeout);

            if (!openclawResponse.success || !openclawResponse.data) {
                logger.error({ index: i, error: openclawResponse.error }, 'Openclaw recognition failed');
                results.push({
                    success: false,
                    index: i,
                    error: openclawResponse.error || '识别失败',
                });
                continue;
            }

            try {
                const errorItem = await createErrorItem(
                    dbUser.id,
                    base64,
                    mimeType,
                    openclawResponse.data,
                    subjectId
                );

                results.push({
                    success: true,
                    index: i,
                    errorItemId: errorItem.id,
                });

                logger.info({ index: i, errorItemId: errorItem.id }, 'Error item created successfully');
            } catch (dbError: any) {
                logger.error({ index: i, error: dbError?.message || String(dbError) }, 'Failed to create error item');
                results.push({
                    success: false,
                    index: i,
                    error: `数据库写入失败: ${dbError?.message || String(dbError)}`,
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;

        logger.info({ 
            total: results.length, 
            success: successCount, 
            failed: failCount 
        }, 'Batch upload completed');

        const statusCode = failCount === 0 ? 201 : 207;

        return NextResponse.json({
            success: failCount === 0,
            total: results.length,
            successCount,
            failCount,
            results,
        }, { status: statusCode });
    } catch (error: any) {
        logger.error({ error: error?.message || String(error), stack: error?.stack }, 'Batch upload error');
        return createErrorResponse(
            'Batch upload failed',
            500,
            ErrorCode.INTERNAL_ERROR,
            'Batch upload failed'
        );
    } finally {
        work?.release();
    }
}
