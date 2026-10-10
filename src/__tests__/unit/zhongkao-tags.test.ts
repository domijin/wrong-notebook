/**
 * 杭州中考知识点数据与系统标签构建测试
 */
import { describe, it, expect, vi } from 'vitest';
import { ZHONGKAO_CURRICULA, buildSystemTagTrees, seedSystemTags, findSystemTagByName, type SeedNode } from '@/lib/tag-data/seed';
import { inferSubjectFromName } from '@/lib/knowledge-tags';
import { generateAnalyzePrompt } from '@/lib/ai/prompts';
import { AI_SUBJECTS } from '@/lib/ai/schema';

const GRADES = ['七年级上', '七年级下', '八年级上', '八年级下', '九年级上', '九年级下', '中考专项'];

const leaves = (nodes: SeedNode[]): SeedNode[] =>
    nodes.flatMap(node => node.children?.length ? leaves(node.children) : [node]);

describe('中考知识点数据 (zhongkao/*.json)', () => {
    it.each(Object.entries(ZHONGKAO_CURRICULA))('%s：年级合法、知识点名称唯一且长度合规', (_, curriculum) => {
        expect(curriculum.grades.length).toBeGreaterThan(0);
        const names = new Set<string>();
        for (const grade of curriculum.grades) {
            expect(GRADES).toContain(grade.name);
            expect(grade.chapters.length).toBeGreaterThan(0);
            for (const chapter of grade.chapters) {
                expect(chapter.sections.length).toBeGreaterThan(0);
                for (const section of chapter.sections) {
                    expect(section.tags.length).toBeGreaterThan(0);
                    for (const tag of section.tags) {
                        expect(tag.name.length).toBeGreaterThanOrEqual(2);
                        expect(tag.name.length).toBeLessThanOrEqual(20);
                        expect(tag.name).not.toBe(chapter.name);
                        expect(names.has(tag.name)).toBe(false);
                        names.add(tag.name);
                    }
                }
            }
        }
    });

    it.each(Object.entries(ZHONGKAO_CURRICULA))('%s：有高频标记，但不超过知识点总数的 25%%', (_, curriculum) => {
        const tags = curriculum.grades.flatMap(g => g.chapters.flatMap(c => c.sections.flatMap(s => s.tags)));
        const hf = tags.filter(t => t.hf).length;
        expect(hf).toBeGreaterThan(0);
        expect(hf / tags.length).toBeLessThanOrEqual(0.25);
    });
});

describe('buildSystemTagTrees', () => {
    const trees = buildSystemTagTrees();

    it('数学：小学在前、浙教版初中居中、高中在后，旧的初中数据被替换', () => {
        const grades = trees.math.map(g => g.name);
        expect(grades.slice(0, 6)).toEqual(['一年级', '二年级', '三年级', '四年级', '五年级', '六年级']);
        expect(grades.slice(6, 12)).toEqual(['七年级上', '七年级下', '八年级上', '八年级下', '九年级上', '九年级下']);
        expect(grades[12]).toMatch(/^高/);
        const juniorChapters = trees.math.find(g => g.name === '七年级上')!.children!.map(c => c.name);
        expect(juniorChapters).toEqual(ZHONGKAO_CURRICULA.math.grades[0].chapters.map(c => c.name));
    });

    it('新增科学、社会两门学科', () => {
        expect(trees.science.length).toBeGreaterThan(0);
        expect(trees.society.length).toBeGreaterThan(0);
        expect(trees.society.flatMap(g => g.children!.map(c => c.name)).some(n => n.startsWith('历史·'))).toBe(true);
    });

    it('英语、语文的旧初中年级（七年级/八年级/九年级）被替换，空年级不生成节点', () => {
        for (const subject of ['english', 'chinese']) {
            const grades = trees[subject].map(g => g.name);
            expect(grades).not.toContain('七年级');
            expect(grades).toContain('七年级上');
            expect(trees[subject].every(g => (g.children?.length ?? 0) > 0)).toBe(true);
        }
    });

    it('高频标记传递到叶子节点', () => {
        const expected = ZHONGKAO_CURRICULA.science.grades
            .flatMap(g => g.chapters.flatMap(c => c.sections.flatMap(s => s.tags)))
            .filter(t => t.hf).length;
        expect(leaves(trees.science).filter(n => n.isHighFrequency).length).toBe(expected);
    });
});

describe('seedSystemTags', () => {
    it('按学科清空后逐层创建，并写入 isHighFrequency', async () => {
        let id = 0;
        const created: Array<{ name: string; parentId: string | null; isHighFrequency: boolean }> = [];
        const tx = {
            knowledgeTag: {
                deleteMany: vi.fn(async () => ({ count: 0 })),
                create: vi.fn(async ({ data }: { data: { name: string; parentId: string | null; isHighFrequency: boolean } }) => {
                    created.push(data);
                    return { id: String(++id) };
                }),
            },
        };
        const total = await seedSystemTags(tx);
        const trees = buildSystemTagTrees();
        const count = (nodes: SeedNode[]): number => nodes.reduce((n, node) => n + 1 + count(node.children || []), 0);
        expect(total).toBe(Object.values(trees).reduce((n, roots) => n + count(roots), 0));
        expect(tx.knowledgeTag.deleteMany).toHaveBeenCalledTimes(Object.keys(trees).length);
        expect(created.filter(c => c.isHighFrequency).length).toBe(Object.values(trees).reduce((n, roots) => n + leaves(roots).filter(l => l.isHighFrequency).length, 0));
        expect(created.filter(c => c.parentId === null).map(c => c.name)).toContain('中考专项');
    });
});

describe('findSystemTagByName', () => {
    it('与节同名时优先返回叶子节点', async () => {
        const findFirst = vi.fn(async ({ where }: { where: { children?: unknown } }) => where.children ? { id: 'leaf' } : { id: 'section' });
        expect(await findSystemTagByName({ knowledgeTag: { findFirst } }, '垂径定理', 'math')).toEqual({ id: 'leaf' });
    });

    it('找不到叶子时回退到任意同名节点', async () => {
        const findFirst = vi.fn(async ({ where }: { where: { children?: unknown } }) => where.children ? null : { id: 'section' });
        expect(await findSystemTagByName({ knowledgeTag: { findFirst } }, '垂径定理', 'math')).toEqual({ id: 'section' });
    });
});

describe('学科识别与提示词', () => {
    it.each([
        ['科学', 'science'], ['九年级科学错题', 'science'],
        ['社会', 'society'], ['历史与社会', 'society'], ['道德与法治', 'society'],
        ['物理', 'physics'], ['历史', 'history'],
    ])('错题本「%s」识别为 %s', (name, subject) => {
        expect(inferSubjectFromName(name)).toBe(subject);
    });

    it('AI 学科枚举包含科学和社会', () => {
        expect(AI_SUBJECTS).toContain('科学');
        expect(AI_SUBJECTS).toContain('社会');
    });

    it('科学错题本只注入科学标签', () => {
        const prompt = generateAnalyzePrompt('zh', 9, '科学', {
            prefetchedMathTags: ['勾股定理'],
            prefetchedScienceTags: ['欧姆定律的应用'],
        });
        expect(prompt).toContain('"欧姆定律的应用"');
        expect(prompt).not.toContain('"勾股定理"');
    });

    it('未知学科时列出所有有标签的学科', () => {
        const prompt = generateAnalyzePrompt('zh', 9, null, {
            prefetchedMathTags: ['勾股定理'],
            prefetchedSocietyTags: ['宪法是国家的根本法'],
        });
        expect(prompt).toContain('"勾股定理"');
        expect(prompt).toContain('"宪法是国家的根本法"');
        expect(prompt).not.toContain('语文标签');
    });
});
