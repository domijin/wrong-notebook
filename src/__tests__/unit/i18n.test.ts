import { describe, it, expect } from 'vitest';
import {
    translations,
    resolveTranslations,
    normalizeLanguage,
    LANGUAGES,
    FALLBACK_LANGUAGE,
    clearTranslationCache,
    LANGUAGE_LABELS,
    LANGUAGE_NATIVE_NAMES,
    type Language,
} from '@/lib/translations';
import { extractJsonObject, runTranslate } from '@/lib/ai/translate';
import { generateTranslatePrompt } from '@/lib/ai/prompts';

function flatten(o: unknown, p = '', out = new Set<string>()): Set<string> {
    if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
            flatten(v, p ? `${p}.${k}` : k, out);
        }
    } else {
        out.add(p);
    }
    return out;
}

describe('locale catalogs', () => {
    it('exposes exactly the three supported locales', () => {
        expect(LANGUAGES).toEqual(['zh', 'en', 'es']);
        expect(Object.keys(translations).sort()).toEqual(['en', 'es', 'zh']);
    });

    it('has a native label for every locale', () => {
        for (const lang of LANGUAGES) {
            expect(LANGUAGE_LABELS[lang]).toBeTruthy();
            expect(LANGUAGE_NATIVE_NAMES[lang]).toBeTruthy();
        }
        expect(LANGUAGE_NATIVE_NAMES.es).toBe('Español');
    });

    it('keeps identical key sets across all locales', () => {
        const base = flatten(translations.en);
        for (const lang of ['zh', 'es'] as Language[]) {
            const other = flatten(translations[lang]);
            expect([...other].sort()).toEqual([...base].sort());
        }
    });

    it('has a non-empty string for every leaf key', () => {
        for (const lang of LANGUAGES) {
            const flat = translations[lang] as unknown as Record<string, unknown>;
            const walk = (node: unknown, path: string) => {
                if (node && typeof node === 'object') {
                    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
                        walk(v, `${path}.${k}`);
                    }
                } else {
                    expect(typeof node, `${lang}${path} must be a string`).toBe('string');
                    expect(String(node).length, `${lang}${path} must not be empty`).toBeGreaterThan(0);
                }
            };
            walk(flat, '');
        }
    });

    it('actually translates Spanish instead of copying English', () => {
        const en = translations.en as unknown as Record<string, unknown>;
        const es = translations.es as unknown as Record<string, unknown>;
        expect(es.common).not.toEqual(en.common);
        expect((es.common as Record<string, string>).save).toBe('Guardar');
        expect((es.common as Record<string, string>).cancel).toBe('Cancelar');
        expect((es.tags as Record<string, Record<string, string>>).subjects.math).toBe('Matemáticas');
    });
});

describe('resolveTranslations', () => {
    it('returns the requested locale when it is complete', () => {
        // Value equality, not identity: withFallback rebuilds the tree so that
        // partial locales can be merged, and identity is not part of the API.
        expect(resolveTranslations('es')).toStrictEqual(translations.es);
        expect(resolveTranslations('zh')).toStrictEqual(translations.zh);
    });

    it('falls back to English for keys a locale is missing', () => {
        // Simulate a partially translated locale.
        const original = (translations as Record<string, unknown>).es;
        const partial = { common: { save: 'Guardar' } } as unknown;
        (translations as Record<string, unknown>).es = partial;
        clearTranslationCache();
        try {
            const resolved = resolveTranslations('es') as unknown as {
                common: Record<string, string>;
                tags: Record<string, unknown>;
            };
            expect(resolved.common.save).toBe('Guardar');
            // Missing keys come from English, not undefined.
            expect(resolved.common.cancel).toBe('Cancel');
            expect(resolved.tags).toBeDefined();
        } finally {
            (translations as Record<string, unknown>).es = original;
            clearTranslationCache();
        }
    });

    it('uses English as the fallback locale', () => {
        expect(FALLBACK_LANGUAGE).toBe('en');
    });
});

describe('normalizeLanguage', () => {
    it('accepts supported locales', () => {
        expect(normalizeLanguage('es')).toBe('es');
        expect(normalizeLanguage('zh')).toBe('zh');
        expect(normalizeLanguage('en')).toBe('en');
    });

    it('rejects anything else and defaults to Chinese', () => {
        expect(normalizeLanguage('fr')).toBe('zh');
        expect(normalizeLanguage(undefined)).toBe('zh');
        expect(normalizeLanguage(null)).toBe('zh');
        expect(normalizeLanguage(42)).toBe('zh');
        expect(normalizeLanguage('__proto__')).toBe('zh');
    });
});

describe('extractJsonObject', () => {
    it('parses a bare object', () => {
        expect(extractJsonObject('{"a":"b"}')).toEqual({ a: 'b' });
    });

    it('parses an object wrapped in a markdown fence', () => {
        expect(extractJsonObject('```json\n{"a":"b"}\n```')).toEqual({ a: 'b' });
    });

    it('parses an object surrounded by prose', () => {
        expect(extractJsonObject('Sure!\n{"a":"b"}\nHope that helps.')).toEqual({ a: 'b' });
    });

    it('returns null when there is no object', () => {
        expect(extractJsonObject('no json here')).toBeNull();
        expect(extractJsonObject('')).toBeNull();
        expect(extractJsonObject('{ broken')).toBeNull();
    });
});

describe('generateTranslatePrompt', () => {
    it('asks for the target language by name', () => {
        const { prompt } = generateTranslatePrompt({ analysis: 'hola' }, 'en');
        expect(prompt).toContain('English');
        expect(prompt).toContain('Translate');
    });

    it('lists only the non-empty fields', () => {
        const { fields, prompt } = generateTranslatePrompt(
            { questionText: 'q', answerText: '  ', analysis: null },
            'es'
        );
        expect(fields).toEqual(['questionText']);
        expect(prompt).toContain('questionText');
        expect(prompt).not.toContain('answerText');
    });

    it('returns no fields when there is nothing to translate', () => {
        expect(generateTranslatePrompt({}, 'es').fields).toEqual([]);
        expect(generateTranslatePrompt({ analysis: '   ' }, 'es').fields).toEqual([]);
    });
});

describe('runTranslate', () => {
    it('returns the translated fields', async () => {
        const out = await runTranslate(
            { questionText: '问题', analysis: '解析' },
            'es',
            async () => '{"questionText":"Pregunta","analysis":"Análisis"}'
        );
        expect(out).toEqual({ questionText: 'Pregunta', analysis: 'Análisis' });
    });

    it('drops fields the model omitted', async () => {
        const out = await runTranslate(
            { questionText: 'q', answerText: 'a', analysis: 'x' },
            'es',
            async () => '{"questionText":"P"}'
        );
        expect(out).toEqual({ questionText: 'P' });
    });

    it('never returns fields the caller did not ask about', async () => {
        const out = await runTranslate({ questionText: 'q' }, 'es', async () =>
            JSON.stringify({ questionText: 'P', answerText: 'invented', secret: 'x' })
        );
        expect(out).toEqual({ questionText: 'P' });
        expect('secret' in out).toBe(false);
        expect('answerText' in out).toBe(false);
    });

    it('short-circuits without calling the model when there is no content', async () => {
        let called = false;
        const out = await runTranslate({ analysis: '  ' }, 'es', async () => {
            called = true;
            return '{}';
        });
        expect(called).toBe(false);
        expect(out).toEqual({});
    });

    it('throws when the reply has no usable JSON', async () => {
        await expect(
            runTranslate({ questionText: 'q' }, 'es', async () => 'sorry, I cannot')
        ).rejects.toThrow(/AI_RESPONSE_ERROR/);
    });

    it('throws when the reply is JSON but empty of usable fields', async () => {
        await expect(
            runTranslate({ questionText: 'q' }, 'es', async () => '{"questionText":"  "}')
        ).rejects.toThrow(/AI_RESPONSE_ERROR/);
    });
});
