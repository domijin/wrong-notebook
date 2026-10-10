// 杭州中考五科的教材目录来源清单。
// 2024 年秋起七年级全面换用新教材，2026 学年的七到九年级都在用新版；
// 新版九下要到 2027 年春发行，九下暂用旧版目录或课标内容（provisional）。

export const BASE_URL = 'http://www.dzkbw.com/books';

// 「中考专项」放跨年级的题型与能力类知识点
export const GRADES = ['七年级上', '七年级下', '八年级上', '八年级下', '九年级上', '九年级下', '中考专项'];

export const SUBJECTS = {
    math: {
        name: '数学',
        edition: '浙教版（2024 新版，九下为旧版）',
        volumes: [
            { grade: '七年级上', path: 'zjb/shuxue/7s_2024' },
            { grade: '七年级下', path: 'zjb/shuxue/7x_2025' },
            { grade: '八年级上', path: 'zjb/shuxue/8s_2025' },
            { grade: '八年级下', path: 'zjb/shuxue/8x_2026' },
            { grade: '九年级上', path: 'zjb/shuxue/9s_2026' },
            { grade: '九年级下', path: 'zjb/shuxue/9x', provisional: true },
        ],
        // 新版八下、九上都没有反比例函数，课标仍要求，暂列九下
        static: ['math-extra.json'],
    },
    science: {
        name: '科学',
        edition: '浙教版（2024 新版，九下按课标暂列）',
        volumes: [
            { grade: '七年级上', path: 'zjb/kexue/7s_2024' },
            { grade: '七年级下', path: 'zjb/kexue/7x_2025' },
            { grade: '八年级上', path: 'zjb/kexue/8s_2025' },
            { grade: '八年级下', path: 'zjb/kexue/8x_2026' },
            { grade: '九年级上', path: 'zjb/kexue/9s_2026' },
            // 旧版九下与新版九上大量重复，不使用；九下内容见 science-extra.json
        ],
        static: ['science-extra.json'],
    },
    society: {
        name: '社会',
        edition: '统编道德与法治 + 统编历史（2024 新版，九下为旧版）+ 人文地理（浙江）',
        volumes: [
            { grade: '七年级上', path: 'rjb/zhengzhi/7s_2024', module: '道法' },
            { grade: '七年级下', path: 'rjb/zhengzhi/7x_2025', module: '道法' },
            { grade: '八年级上', path: 'rjb/zhengzhi/8s_2025', module: '道法' },
            { grade: '八年级下', path: 'rjb/zhengzhi/8x_2026', module: '道法' },
            { grade: '九年级上', path: 'rjb/zhengzhi/9s_2026', module: '道法' },
            { grade: '九年级下', path: 'rjb/zhengzhi/9x', module: '道法', provisional: true },
            { grade: '七年级上', path: 'rjb/lishi/7s_2024', module: '历史' },
            { grade: '七年级下', path: 'rjb/lishi/7x_2025', module: '历史' },
            { grade: '八年级上', path: 'rjb/lishi/8s_2025', module: '历史' },
            { grade: '八年级下', path: 'rjb/lishi/8x_2026', module: '历史' },
            { grade: '九年级上', path: 'rjb/lishi/9s_2026', module: '历史' },
            { grade: '九年级下', path: 'rjb/lishi/9x_2019', module: '历史', provisional: true },
        ],
        // 人文地理（浙江版）没有可抓取的在线目录，按课标主题整理
        static: ['society-geography.json'],
    },
    chinese: {
        name: '语文',
        edition: '统编版（2024 新版，九下为旧版）',
        // 官方评析里的语文条目都是题型，不对应具体课文；高频只来自中考专项的题型清单
        llmHighFrequency: false,
        volumes: [
            { grade: '七年级上', path: 'rjb/yuwen/7s_2024' },
            { grade: '七年级下', path: 'rjb/yuwen/7x_2025' },
            { grade: '八年级上', path: 'rjb/yuwen/8s_2025' },
            { grade: '八年级下', path: 'rjb/yuwen/8x_2026' },
            { grade: '九年级上', path: 'rjb/yuwen/9s_2026' },
            { grade: '九年级下', path: 'rjb/yuwen/9x_2019', provisional: true },
        ],
        static: ['chinese-exam.json'],
    },
    english: {
        name: '英语',
        edition: '人教版（2024 新版）语法体系 + 中考题型',
        // 单元话题对错题归类帮助不大，语法按课标分年级整理
        volumes: [],
        static: ['english.json'],
    },
};

// 源站错字修正
export const CORRECTIONS = {
    '酸城盐': '酸碱盐',
    '拿破仓': '拿破仑',
    '明治雏新': '明治维新',
    '简?爱': '简·爱',
};
