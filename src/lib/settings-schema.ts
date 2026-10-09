import { z } from "zod";
import { AppConfig } from "@/lib/config";
import { validateAIDestination } from "@/lib/ai-destination";

const text = z.string().max(256);
const key = z.string().max(4096).optional();
const destination = z.string().max(2048).refine(value => {
    if (!value) return true;
    try { validateAIDestination(value); return true; } catch { return false; }
}, 'AI destination is invalid or not allowlisted');
const provider = z.object({ apiKey: key, keyConfigured: z.boolean().optional(), baseUrl: destination.optional(), model: text.optional() }).strict();

export const settingsSchema = z.object({
    aiProvider: z.enum(['gemini', 'openai', 'azure']).optional(),
    allowRegistration: z.boolean().optional(),
    openai: z.object({
        instances: z.array(z.object({
            id: text.min(1), name: text.min(1), apiKey: key, keyConfigured: z.boolean().optional(),
            baseUrl: destination, model: text.min(1),
        }).strict()).max(10).optional(),
        activeInstanceId: text.optional(),
    }).strict().optional(),
    gemini: provider.optional(),
    azure: z.object({
        apiKey: key, keyConfigured: z.boolean().optional(), endpoint: destination.optional(),
        deploymentName: text.optional(), apiVersion: text.optional(), model: text.optional(),
    }).strict().optional(),
    prompts: z.object({ analyze: z.string().max(50000).optional(), similar: z.string().max(50000).optional() }).strict().optional(),
    timeouts: z.object({ analyze: z.number().int().min(1000).max(180000).optional() }).strict().optional(),
}).strict();

export function sanitizeConfig(config: AppConfig) {
    const { apiKey: geminiKey, ...gemini } = config.gemini || {};
    const { apiKey: azureKey, ...azure } = config.azure || {};
    return {
        ...config,
        openai: { ...config.openai, instances: (config.openai?.instances || []).map(({ apiKey, ...instance }) => ({
            ...instance, keyConfigured: !!apiKey,
        })) },
        gemini: { ...gemini, keyConfigured: !!geminiKey },
        azure: { ...azure, keyConfigured: !!azureKey },
    };
}

export function prepareSettings(input: z.infer<typeof settingsSchema>, current: AppConfig): Partial<AppConfig> {
    const preserveKey = (value: string | undefined, previous?: string) => value === undefined || value === '********' ? previous : value;
    const result: Partial<AppConfig> = { ...input, openai: undefined };
    if (input.gemini) {
        const rest = { ...input.gemini };
        delete rest.keyConfigured;
        const { apiKey } = rest;
        result.gemini = { ...rest, apiKey: preserveKey(apiKey, current.gemini?.apiKey) };
    }
    if (input.azure) {
        const rest = { ...input.azure };
        delete rest.keyConfigured;
        const { apiKey } = rest;
        result.azure = { ...rest, apiKey: preserveKey(apiKey, current.azure?.apiKey) };
    }
    if (input.openai) {
        const instances = input.openai.instances?.map(inputInstance => {
            const instance = { ...inputInstance };
            delete instance.keyConfigured;
            return { ...instance, apiKey: preserveKey(instance.apiKey, current.openai?.instances?.find(i => i.id === instance.id)?.apiKey) || '' };
        }) ?? current.openai?.instances ?? [];
        const ids = new Set(instances.map(i => i.id));
        const previousActive = current.openai?.activeInstanceId;
        const active = input.openai.activeInstanceId ?? (previousActive && ids.has(previousActive) ? previousActive : undefined);
        if (ids.size !== instances.length || (active && !ids.has(active))) throw new Error('Invalid OpenAI instance selection');
        result.openai = { instances, activeInstanceId: active };
    }
    return result;
}
