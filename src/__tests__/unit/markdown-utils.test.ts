import { describe, it, expect } from 'vitest';
import { cleanMarkdown } from '@/lib/markdown-utils';

describe('cleanMarkdown (card previews)', () => {
    it('keeps units written with \\text{} and drops LaTeX spacing commands', () => {
        expect(cleanMarkdown('体积为 $200\\,\\text{cm}^3$ 的木块')).toBe('体积为 200 cm^3 的木块');
        expect(cleanMarkdown('$g=10\\,\\text{N/kg}$')).toBe('g=10 N/kg');
    });
    it('still simplifies fractions', () => {
        expect(cleanMarkdown('露出 $\\frac{2}{5}$')).toBe('露出 2/5');
    });
});
