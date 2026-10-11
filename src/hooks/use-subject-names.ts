"use client";

import { useLanguage } from '@/contexts/LanguageContext';
import { localizeSubjectName, type SubjectKey } from '@/lib/knowledge-tags';

/**
 * Subject names for display, in the active UI language.
 *
 * The database stores Chinese names (notebooks, tag roots) so that tag
 * matching and Chinese search keep working; this only translates what is drawn.
 */
export function useSubjectNames() {
    const { t } = useLanguage();
    const subjects = t.tags?.subjects as Partial<Record<SubjectKey, string>> | undefined;

    /** Localize a stored subject/notebook name, falling back to the original. */
    const subjectName = (name: string | null | undefined) =>
        localizeSubjectName(name, subjects);

    return { subjects, subjectName };
}
