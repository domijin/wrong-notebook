import type { Language } from '../translations';
import type { TranslatableContent, TranslatedContent } from './types';
import { generateTranslatePrompt } from './prompts';

/**
 * Pull a JSON object out of a model reply. Handles markdown fences and any
 * prose the model wrapped around the object.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
    let s = (text || '').trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
        const parsed = JSON.parse(s.slice(start, end + 1));
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

/**
 * Translate an error item's prose.
 *
 * `complete` receives the built prompt and returns the raw model reply; each
 * provider supplies its own transport. Keeping the prompt/parse logic here means
 * all three providers behave identically and a new one is a three-line class.
 */
export async function runTranslate(
    content: TranslatableContent,
    target: Language,
    complete: (prompt: string) => Promise<string>
): Promise<TranslatedContent> {
    const { prompt, fields } = generateTranslatePrompt(content, target);
    if (fields.length === 0) return {};

    const raw = await complete(prompt);
    const parsed = extractJsonObject(raw);
    if (!parsed) {
        throw new Error('AI_RESPONSE_ERROR: could not parse translation payload');
    }

    // Only keep the fields we asked for, and only when the model returned a
    // non-empty string for them. Never let the model invent extra fields.
    const out: TranslatedContent = {};
    for (const field of fields) {
        const value = parsed[field];
        if (typeof value === 'string' && value.trim().length > 0) {
            out[field] = value;
        }
    }
    if (Object.keys(out).length === 0) {
        throw new Error('AI_RESPONSE_ERROR: translation returned no usable fields');
    }
    return out;
}
