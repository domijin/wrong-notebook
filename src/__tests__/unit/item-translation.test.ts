import { describe, it, expect } from 'vitest';
import { looksLikeTargetLanguage, parseStoredFields, sourceHash, translatableContent } from '@/lib/item-translation';

describe('looksLikeTargetLanguage', () => {
    const chinese = '已知二次函数 $f(x)=x^2-4x+3$，求它在区间上的最小值，并说明理由。';
    const english = 'Given the quadratic function $f(x)$, find the minimum value on the interval and explain why it is the minimum.';
    const spanish = 'Dada la función cuadrática $f(x)$, halla el valor mínimo en el intervalo y explica por qué es el mínimo.';

    it('recognises Chinese', () => {
        expect(looksLikeTargetLanguage(chinese, 'zh')).toBe(true);
        expect(looksLikeTargetLanguage(chinese, 'en')).toBe(false);
    });
    it('tells English and Spanish apart, so either can be translated into the other', () => {
        expect(looksLikeTargetLanguage(english, 'en')).toBe(true);
        expect(looksLikeTargetLanguage(english, 'es')).toBe(false);
        expect(looksLikeTargetLanguage(spanish, 'es')).toBe(true);
        expect(looksLikeTargetLanguage(spanish, 'en')).toBe(false);
    });
    it('does not skip short or math-only text', () => {
        expect(looksLikeTargetLanguage('$x=2$', 'en')).toBe(false);
        expect(looksLikeTargetLanguage('A. 3  B. 4', 'en')).toBe(false);
    });
});

describe('translation storage helpers', () => {
    it('only keeps non-empty translatable fields', () => {
        expect(translatableContent({ questionText: 'q', answerText: '  ', analysis: null })).toEqual({ questionText: 'q' });
    });
    it('changes the source hash when any translatable field changes', () => {
        const a = sourceHash({ questionText: 'q', analysis: 'a' });
        expect(sourceHash({ questionText: 'q', analysis: 'a' })).toBe(a);
        expect(sourceHash({ questionText: 'q', analysis: 'b' })).not.toBe(a);
        expect(sourceHash({ questionText: 'qa' })).not.toBe(sourceHash({ questionText: 'q', analysis: 'a' }));
    });
    it('drops unknown or malformed stored fields', () => {
        expect(parseStoredFields('{"questionText":"Q","evil":"x","analysis":5}')).toEqual({ questionText: 'Q' });
        expect(parseStoredFields('not json')).toEqual({});
    });
});
