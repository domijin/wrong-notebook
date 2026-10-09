import { z } from "zod";
import { getAppConfig } from "@/lib/config";
import { validateAIDestination } from "@/lib/ai-destination";

const requestSchema = z.object({
    provider: z.enum(['gemini', 'openai', 'azure']),
    instanceId: z.string().max(256).optional(), apiKey: z.string().max(4096).optional(),
    baseUrl: z.string().max(2048).optional(), endpoint: z.string().max(2048).optional(),
    model: z.string().max(256).optional(), deploymentName: z.string().max(256).optional(),
    apiVersion: z.string().max(256).optional(), language: z.enum(['zh', 'en']).optional(),
}).strict();

export function resolveAIRequest(input: unknown) {
    const body = requestSchema.parse(input);
    const config = getAppConfig();
    const stored = body.provider === 'openai'
        ? config.openai?.instances?.find(i => i.id === (body.instanceId || config.openai?.activeInstanceId))
        : body.provider === 'azure' ? config.azure : config.gemini;
    const apiKey = body.apiKey && body.apiKey !== '********' ? body.apiKey : stored?.apiKey;
    if (!apiKey) throw new Error('API key is required');
    const storedBaseUrl = stored && 'baseUrl' in stored ? stored.baseUrl : undefined;
    const baseUrl = validateAIDestination(body.baseUrl || storedBaseUrl
        || (body.provider === 'gemini' ? 'https://generativelanguage.googleapis.com' : 'https://api.openai.com/v1'));
    const endpoint = body.provider === 'azure'
        ? validateAIDestination(body.endpoint || config.azure?.endpoint || '') : undefined;
    return { ...body, apiKey, baseUrl, endpoint,
        model: body.model ?? stored?.model,
        deploymentName: body.deploymentName ?? config.azure?.deploymentName,
        apiVersion: body.apiVersion ?? config.azure?.apiVersion,
    };
}
