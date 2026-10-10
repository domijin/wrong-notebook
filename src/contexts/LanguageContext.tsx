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

/** BCP-47 tag for each locale, used for <html lang>. */
const HTML_LANG: Record<Language, string> = {
    zh: 'zh-CN',
    en: 'en',
    es: 'es',
};

/** Keep <html lang> in sync for screen readers and font shaping. */
function applyDocumentLanguage(lang: Language) {
    try {
        document.documentElement.lang = HTML_LANG[lang];
    } catch {
        // Non-browser environment; nothing to sync.
    }
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    // Default to Chinese; replaced on mount by the persisted preference.
    const [language, setLanguageState] = useState<Language>('zh');

    // Restore the saved locale, then sync <html lang> for it too — a page load
    // with an already-stored preference must still update the attribute, not
    // only an explicit setLanguage() call.
    useEffect(() => {
        try {
            const saved = normalizeLanguage(localStorage.getItem(STORAGE_KEY));
            setLanguageState(saved);
            applyDocumentLanguage(saved);
        } catch {
            applyDocumentLanguage('zh');
        }
    }, []);

    const setLanguage = (lang: Language) => {
        const next = normalizeLanguage(lang);
        setLanguageState(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // Storage unavailable; the in-memory state still applies.
        }
        applyDocumentLanguage(next);
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