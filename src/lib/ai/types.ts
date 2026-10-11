import type { Language } from '../translations';
// Re-export the Zod-validated type from schema.ts
export type { ParsedQuestionFromSchema as ParsedQuestion } from './schema';
import type { ParsedQuestionFromSchema } from './schema';

// Import and re-export MistakeStatus from the single source of truth
import type { MistakeStatus } from '../mistake-status';
export type { MistakeStatus };

export type DifficultyLevel = 'easy' | 'medium' | 'hard' | 'harder';

/** Error-item prose that can be machine-translated. */
export interface TranslatableContent {
    questionText?: string | null;
    answerText?: string | null;
    analysis?: string | null;
    mistakeAnalysis?: string | null;
    userNotes?: string | null;
}

/** Result of a translation: same keys, translated values, only what was sent. */
export type TranslatedContent = {
    [K in keyof TranslatableContent]?: string;
};

export interface ReanswerQuestionResult {
    answerText: string;
    analysis: string;
    knowledgePoints: string[];
    wrongAnswerText: string;
    mistakeAnalysis: string;
    mistakeStatus: MistakeStatus;
}

export interface GeogebraAnalysisResult {
    suitable: boolean;
    commands: string[];
    description: string;
}

export interface AIService {
    analyzeImage(imageBase64: string, mimeType?: string, language?: Language, grade?: 7 | 8 | 9 | 10 | 11 | 12 | null, subject?: string | null, gradeSemester?: string | null): Promise<ParsedQuestionFromSchema>;
    generateSimilarQuestion(originalQuestion: string, knowledgePoints: string[], language?: Language, difficulty?: DifficultyLevel, gradeSemester?: string | null): Promise<ParsedQuestionFromSchema>;
    reanswerQuestion(questionText: string, language?: Language, subject?: string | null, imageBase64?: string, gradeSemester?: string | null): Promise<ReanswerQuestionResult>;
    analyzeForGeogebra(questionText: string, answerText: string, analysis: string, previousErrors?: string): Promise<GeogebraAnalysisResult>;
    /**
     * Translate the prose fields of an error item into `target`.
     * Only the fields present in the request come back in the result.
     */
    translateContent(content: TranslatableContent, target: Language): Promise<TranslatedContent>;
}

export interface AIConfig {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    // Azure OpenAI 特有字段
    azureDeployment?: string;   // Azure 部署名称
    azureApiVersion?: string;   // API 版本 (如 2024-02-15-preview)
}
