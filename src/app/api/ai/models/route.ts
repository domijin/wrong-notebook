import { getCurrentSession } from "@/lib/current-session";
import { resolveAIRequest } from "@/lib/ai-request";
import { badRequest, forbidden } from "@/lib/api-errors";
import { consumeRateLimit } from "@/lib/rate-limit";
import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:ai:models');

interface ModelInfo {
    id: string;
    name: string;
    owned_by?: string;
}

// 从模型 ID 中提取短名称
function extractModelName(modelId: string): string {
    // models/gemini-2.0-flash -> gemini-2.0-flash
    return modelId.replace(/^models\//, '');
}

async function fetchGeminiModels(apiKey: string, baseUrl: string): Promise<ModelInfo[]> {
    const url = `${baseUrl}/v1beta/models`;

    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        redirect: 'error', signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
        logger.error({ status: response.status }, 'Gemini models API error');
        throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    return (data.models || [])
        .map((m: any) => {
            const id = extractModelName(m.name);
            return {
                id,
                name: id,
                owned_by: 'Google',
            };
        });
}

async function fetchOpenAIModels(apiKey: string, baseUrl: string): Promise<ModelInfo[]> {
    const url = `${baseUrl}/models`;

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        redirect: 'error', signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
        logger.error({ statusText: response.statusText }, 'OpenAI models API error');
        throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    return (data.data || [])
        .map((model: any) => ({
            id: model.id,
            name: model.id,
            owned_by: model.owned_by,
        }));
}

export async function POST(req: Request) {
    const session = await getCurrentSession();
    if (session?.user.role !== 'admin') return forbidden("Current active admin required");
    if (!consumeRateLimit(`models:${session.user.id}`, 20, 60000)) {
        return NextResponse.json({ message: "Too many model discovery requests" }, { status: 429 });
    }
    let body;
    try { body = resolveAIRequest(await req.json()); }
    catch { return badRequest("Invalid provider configuration or AI destination"); }
    if (body.provider === 'azure') return badRequest("Use the Azure deployment name");
    try {
        const models = body.provider === 'gemini'
            ? await fetchGeminiModels(body.apiKey, body.baseUrl)
            : await fetchOpenAIModels(body.apiKey, body.baseUrl);
        return NextResponse.json({ models });
    } catch {
        return NextResponse.json({ error: 'Model discovery failed', models: [] }, { status: 502 });
    }
}
