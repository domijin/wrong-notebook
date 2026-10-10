"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
    resolveTranslations,
    normalizeLanguage,
    LANGUAGES,
    FALLBACK_LANGUAGE,
    LANGUAGE_LABELS,
    LANGUAGE_NATIVE_NAMES,
    type Language,
    type TranslationTree,
} from '@/lib/translations';

interface LanguageContextType {
    language: Language;
    setLanguage: (lang: Language) => void;
    /** Fully resolved catalog for `language` (never has holes: falls back to English). */
    t: TranslationTree;
    /** Native name of the active locale, e.g. "简体中文". */
    languageName: string;
    languages: Language[];
    languageLabels: Record<Language, string>;
}

const STORAGE_KEY = 'app-language';

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    // Default to Chinese; replaced on mount by the persisted preference.
    const [language, setLanguageState] = useState<Language>('zh');

    useEffect(() => {
        try {
            const saved = normalizeLanguage(localStorage.getItem(STORAGE_KEY));
            setLanguageState(saved);
        } catch {
            // Private-mode / storage-disabled browsers keep the default.
        }
    }, []);

    const setLanguage = (lang: Language) => {
        const next = normalizeLanguage(lang);
        setLanguageState(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
            // Keep <html lang> in sync for screen readers and font shaping.
            document.documentElement.lang = next === 'zh' ? 'zh-CN' : next;
        } catch {
            // Ignore storage failures; the in-memory state still applies.
        }
    };

    const value: LanguageContextType = {
        language,
        setLanguage,
        t: resolveTranslations(language),
        languageName: LANGUAGE_NATIVE_NAMES[language],
        languages: LANGUAGES,
        languageLabels: LANGUAGE_LABELS,
    };

    return (
        <LanguageContext.Provider value={value}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (context === undefined) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
}

export { FALLBACK_LANGUAGE };