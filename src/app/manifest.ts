import type { MetadataRoute } from 'next'

import { translations } from '@/lib/translations'

/**
 * PWA manifest. The browser fetches this before any script runs, so it cannot
 * react to a language chosen at runtime: it ships the Chinese names, and the
 * client-side AppTitle keeps document.title in sync afterwards.
 */
export default function manifest(): MetadataRoute.Manifest {
    const app = translations.zh.app
    const title = translations.zh.appTitle
    return {
        name: title,
        short_name: app.appNameShort,
        description: app.appDescription,
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#f97316',
        orientation: 'portrait',
        icons: [
            {
                src: '/icons/icon.png',
                sizes: 'any',
                type: 'image/png',
            },
        ],
    }
}
