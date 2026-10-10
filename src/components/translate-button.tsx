"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Languages, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { apiClient } from '@/lib/api-client';

export interface TranslateableFields {
    questionText: string;
    answerText: string;
    analysis: string;
    mistakeAnalysis?: string | null;
    userNotes?: string | null;
}

type TranslatedContent = Partial<Record<keyof TranslateableFields, string>>;

interface TranslateButtonProps {
    item: Partial<TranslateableFields>;
    onApply: (fields: Partial<TranslateableFields>) => Promise<void> | void;
    className?: string;
}

/**
 * Offer an on-demand machine translation of an error item's prose when it is
 * not written in the currently selected interface language.
 *
 * The translation is never applied silently: the user gets a preview first and
 * has to confirm, so a poor machine translation can be discarded before it
 * replaces the stored content.
 */
export function TranslateButton({ item, onApply, className }: TranslateButtonProps) {
    const { t, language, languageName } = useLanguage();
    const [pending, setPending] = useState(false);
    const [preview, setPreview] = useState<TranslatedContent | null>(null);
    const [error, setError] = useState<string | null>(null);

    const hasContent = Boolean(
        (item.questionText || '').trim() ||
        (item.answerText || '').trim() ||
        (item.analysis || '').trim()
    );

    if (!hasContent) return null;

    const run = async () => {
        setPending(true);
        setError(null);
        setPreview(null);
        try {
            const res = await apiClient.post<{ translated: TranslatedContent; unchanged: boolean }>(
                '/api/translate',
                {
                    target: language,
                    content: {
                        questionText: item.questionText,
                        answerText: item.answerText,
                        analysis: item.analysis,
                        mistakeAnalysis: item.mistakeAnalysis,
                        userNotes: item.userNotes,
                    },
                }
            );
            setPreview(res.translated || {});
        } catch (e: any) {
            const code = String(e?.data?.message || e?.message || '');
            setError(
                code.includes('AI_AUTH_ERROR') || code.includes('AI_RESPONSE_ERROR')
                    ? t.errors?.AI_RESPONSE_ERROR || t.translate?.failed
                    : t.translate?.failed
            );
        } finally {
            setPending(false);
        }
    };

    const apply = async () => {
        if (!preview) return;
        await onApply(preview);
        setPreview(null);
    };

    const labelFor = (field: 'questionText' | 'answerText' | 'analysis') =>
        field === 'questionText'
            ? t.detail?.question
            : field === 'answerText'
              ? t.detail?.correctAnswer
              : t.detail?.analysis;

    return (
        <>
            <Button
                variant="outline"
                size="sm"
                className={className}
                disabled={pending}
                onClick={run}
                title={t.translate?.description}
            >
                {pending ? (
                    <>
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        {t.translate?.translating}
                    </>
                ) : (
                    <>
                        <Languages className="h-4 w-4 mr-1" />
                        {t.translate?.action}
                    </>
                )}
            </Button>

            {preview && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                    <div className="bg-background rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6 space-y-4">
                        <div className="space-y-1">
                            <h3 className="text-lg font-semibold flex items-center gap-2">
                                <Languages className="h-4 w-4" />
                                {t.translate?.title}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                {t.translate?.targetLanguage}: {languageName}
                            </p>
                        </div>

                        {Object.keys(preview).length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                {t.translate?.description}
                            </p>
                        ) : (
                            <div className="space-y-4">
                                {(['questionText', 'answerText', 'analysis'] as const).map(field => {
                                    const translated = preview[field];
                                    if (!translated) return null;
                                    return (
                                        <div key={field} className="space-y-1">
                                            <div className="text-xs font-semibold uppercase text-muted-foreground">
                                                {labelFor(field)}
                                            </div>
                                            <div className="text-sm whitespace-pre-wrap border rounded p-2 bg-muted/30">
                                                {translated}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {error && <p className="text-sm text-destructive">{error}</p>}

                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={() => setPreview(null)}>
                                {t.common?.cancel}
                            </Button>
                            <Button onClick={apply} disabled={Object.keys(preview).length === 0}>
                                {t.translate?.applyTranslation}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
