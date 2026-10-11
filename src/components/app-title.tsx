"use client";

import { useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Keeps the document title and the description meta tag in the active UI
 * language.
 *
 * `metadata` in the root layout is server-rendered, so it can only ship one
 * language, and Next applies it *after* this component's effect on hydration —
 * which silently reverts document.title while leaving the description alone.
 * Re-applying on the next tick wins that race. The interval keeps it correct if
 * a client-side navigation rewrites the title again later.
 */
export function AppTitle() {
    const { t } = useLanguage();
    const title = t.appTitle || t.app?.appName;
    const description = t.app?.appDescription;

    useEffect(() => {
        if (!title) return;

        const apply = () => {
            if (document.title !== title) document.title = title;
            if (description) {
                let meta = document.querySelector('meta[name="description"]');
                if (!meta) {
                    meta = document.createElement('meta');
                    meta.setAttribute('name', 'description');
                    document.head.appendChild(meta);
                }
                meta.setAttribute('content', description);
            }
        };

        apply();
        // Next.js writes metadata after the initial effect; defer one tick.
        const raf = requestAnimationFrame(apply);
        const timer = window.setInterval(apply, 1000);

        return () => {
            cancelAnimationFrame(raf);
            window.clearInterval(timer);
        };
    }, [title, description]);

    return null;
}
