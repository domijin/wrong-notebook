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

describe('catalog coverage of strings that were once hardcoded', () => {
    it('translates the direct-entry entry point', () => {
        // These two were shipped as literal Chinese inside JSX and only showed
        // up when the live UI was switched to Spanish.
        expect(translations.en.app.directEntry).toBe('Direct Entry');
        expect(translations.zh.app.directEntry).toBe('直接录入');
        expect(translations.es.app.directEntry).toBe('Entrada directa');
        for (const lang of LANGUAGES) {
            expect(translations[lang].app.directEntryHint).toBeTruthy();
        }
    });

    it('has no locale that merely copies another locale wholesale', () => {
        // A cheap guard against shipping a locale that was never translated:
        // the two locales must disagree on a decent share of the catalog.
        const asMap = (o: unknown, p = '', out: Record<string, string> = {}) => {
            for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
                const kp = p ? `${p}.${k}` : k;
                if (v && typeof v === 'object') asMap(v, kp, out);
                else out[kp] = String(v);
            }
            return out;
        };
        const en = asMap(translations.en);
        const es = asMap(translations.es);
        const same = Object.keys(en).filter(k => en[k] === es[k]).length;
        const ratio = same / Object.keys(en).length;
        console.log(
            `es strings identical to en: ${same}/${Object.keys(en).length} (${(ratio * 100).toFixed(1)}%)`
        );
        expect(ratio).toBeLessThan(0.25);
    });
});

describe('localizeSubjectName', () => {
    it('maps stored Chinese subject names to the active UI language', async () => {
        const { localizeSubjectName, inferSubjectFromName } = await import(
            '@/lib/knowledge-tags'
        );
        const es = resolveTranslations('es').tags.subjects as Record<string, string>;
        const en = resolveTranslations('en').tags.subjects as Record<string, string>;

        expect(localizeSubjectName('数学', es)).toBe('Matemáticas');
        expect(localizeSubjectName('科学', es)).toBe('Ciencias');
        expect(localizeSubjectName('社会', es)).toBe('Ciencias Sociales');
        expect(localizeSubjectName('语文', es)).toBe('Lengua y Literatura');
        expect(localizeSubjectName('英语', en)).toBe('English');
        // Composite Zhejiang subject must win over the 历史 substring.
        expect(inferSubjectFromName('历史与社会')).toBe('society');
        expect(localizeSubjectName('历史与社会', en)).toBe('Society');
    });

    it('returns unmapped names unchanged so custom notebooks still show', async () => {
        const { localizeSubjectName } = await import('@/lib/knowledge-tags');
        const es = resolveTranslations('es').tags.subjects as Record<string, string>;
        expect(localizeSubjectName('我的数学本', es)).toBe('我的数学本');
        expect(localizeSubjectName(null, es)).toBe('');
    });
});
