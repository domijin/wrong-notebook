import type { Language } from './translations';
export type ReanswerRequestBody = {
    questionText: string;
    language: Language;
    subject: string;
    imageBase64?: string;
    gradeSemester?: string;
};

export function buildReanswerRequestBody({
    questionText,
    language,
    subject,
    imagePreview,
    gradeSemester,
}: {
    questionText: string;
    language: Language;
    subject: string;
    imagePreview?: string | null;
    gradeSemester?: string;
}): ReanswerRequestBody {
    const requestBody: ReanswerRequestBody = {
        questionText,
        language,
        subject,
    };

    if (imagePreview) {
        requestBody.imageBase64 = imagePreview;
    }

    if (gradeSemester) {
        requestBody.gradeSemester = gradeSemester;
    }

    return requestBody;
}
