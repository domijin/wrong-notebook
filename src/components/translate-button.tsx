"use client";

import { useCallback, useEffect, useState } from "react";
import { Languages, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api-client";
import { useLanguage } from "@/contexts/LanguageContext";
import { aiBudgetMessage } from "@/lib/ai-budget-messages";

export interface ItemTranslation {
    language: string;
    fields: {
        questionText?: string;
        answerText?: string;
        analysis?: string;
        wrongAnswerText?: string;
        mistakeAnalysis?: string;
        userNotes?: string;
    };
    stale: boolean;
}

// 翻译一整道题加解析常常要 30–60 秒以上，超过 apiClient 默认的 60 秒
const TRANSLATE_TIMEOUT_MS = 180000;

/**
 * 错题的机器翻译视图。译文单独保存，原文永远不被覆盖：
 * 有译文时默认显示译文并清楚标注「机器翻译」，一键切回原文。
 */
export function useItemTranslation(itemId: string | undefined, sourceKey = '') {
    const { t, language } = useLanguage();
    // 视图选择和提示都绑定到「这道题 + 这个语言」：换题或换语言时自然回到默认（显示译文、无提示），
    // 不需要在 effect 里重置 state
    const scope = `${itemId ?? ''}:${language}`;
    const [loaded, setLoaded] = useState<{ scope: string; translation: ItemTranslation | null } | null>(null);
    const [originalFor, setOriginalFor] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const [noticeState, setNotice] = useState<{ scope: string; kind: 'error' | 'info'; text: string } | null>(null);
    const translation = loaded?.scope === scope ? loaded.translation : null;
    const notice = noticeState?.scope === scope ? noticeState : null;
    const setTranslation = useCallback((value: ItemTranslation | null) => setLoaded({ scope, translation: value }), [scope]);

    // 读取已保存的译文；原文改动（sourceKey 变化）后重新读取，服务端据此标出「译文已过期」
    useEffect(() => {
        if (!itemId) return;
        let cancelled = false;
        apiClient.get<{ translation: ItemTranslation | null }>(`/api/error-items/${itemId}/translation?lang=${language}`)
            .then(res => { if (!cancelled) setLoaded({ scope: `${itemId}:${language}`, translation: res.translation }); })
            .catch(() => { if (!cancelled) setLoaded({ scope: `${itemId}:${language}`, translation: null }); });
        return () => { cancelled = true; };
    }, [itemId, language, sourceKey]);

    const translate = useCallback(async (force = false) => {
        if (!itemId) return;
        setPending(true);
        setNotice(null);
        try {
            const res = await apiClient.post<{ translation: ItemTranslation | null; unchanged: boolean }>(
                `/api/error-items/${itemId}/translation`,
                { target: language, force },
                { timeout: TRANSLATE_TIMEOUT_MS }
            );
            if (res.unchanged || !res.translation) {
                setNotice({ scope, kind: 'info', text: t.translate?.noContent || '' });
            } else {
                setTranslation(res.translation);
                setOriginalFor(null);
            }
        } catch (error: unknown) {
            const code = (error as { data?: { message?: string } })?.data?.message;
            const errors = t.errors as Record<string, unknown> | undefined;
            const known = typeof code === 'string' && typeof errors?.[code] === 'string' ? (errors[code] as string) : undefined;
            setNotice({ scope, kind: 'error', text: aiBudgetMessage(code, errors) ?? known ?? t.translate?.failed ?? 'Translation failed' });
        } finally {
            setPending(false);
        }
    }, [itemId, language, t, scope, setTranslation]);

    const remove = useCallback(async () => {
        if (!itemId) return;
        await apiClient.delete(`/api/error-items/${itemId}/translation?lang=${language}`).catch(() => {});
        setTranslation(null);
    }, [itemId, language, setTranslation]);

    const active = !!translation && originalFor !== scope;
    return {
        translation,
        active,
        /** 正在显示译文时，用译文覆盖要展示的字段；编辑始终针对原文 */
        fields: active ? translation!.fields : {},
        showOriginal: () => setOriginalFor(scope),
        showTranslation: () => setOriginalFor(null),
        translate,
        remove,
        pending,
        notice,
        language,
    };
}

export type ItemTranslationState = ReturnType<typeof useItemTranslation>;

/** 标题栏里的「翻译」按钮；已有译文时变成原文/译文切换 */
export function TranslateButton({ state }: { state: ItemTranslationState }) {
    const { t } = useLanguage();
    if (state.translation) {
        return state.active ? null : (
            <Button variant="outline" size="sm" onClick={state.showTranslation}>
                <Languages className="h-4 w-4 mr-1" />
                {t.translate?.showTranslation}
            </Button>
        );
    }
    return (
        <Button variant="outline" size="sm" onClick={() => state.translate()} disabled={state.pending}>
            {state.pending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Languages className="h-4 w-4 mr-1" />}
            {state.pending ? t.translate?.translatingOne : t.translate?.action}
        </Button>
    );
}

/** 内容上方的说明条：标明是机器翻译、原文是否改过，以及出错/无需翻译的提示 */
export function TranslationBanner({ state }: { state: ItemTranslationState }) {
    const { t, languageName } = useLanguage();
    if (state.notice) {
        return (
            <p role={state.notice.kind === 'error' ? 'alert' : 'status'}
                className={`text-sm rounded-md border px-3 py-2 ${state.notice.kind === 'error' ? 'border-destructive/40 text-destructive' : 'text-muted-foreground'}`}>
                {state.notice.text.replace('{language}', languageName)}
            </p>
        );
    }
    if (!state.active || !state.translation) return null;
    return (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-sky-300/60 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
            <Languages className="h-4 w-4 shrink-0" aria-hidden />
            <span className="font-medium">{(t.translate?.machineTranslated || '').replace('{language}', languageName)}</span>
            {state.translation.stale && <span className="text-amber-700 dark:text-amber-300">{t.translate?.stale}</span>}
            <span className="ml-auto flex flex-wrap gap-1">
                {state.translation.stale && (
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => state.translate(true)} disabled={state.pending}>
                        {state.pending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
                        {t.translate?.retranslate}
                    </Button>
                )}
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={state.showOriginal}>
                    {t.translate?.backToOriginal}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={state.remove}>
                    {t.translate?.removeTranslation}
                </Button>
            </span>
        </div>
    );
}
