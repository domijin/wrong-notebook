const DEFAULT_ORIGINS = ['https://api.openai.com', 'https://generativelanguage.googleapis.com'];

export function validateAIDestination(value: string): string {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('Invalid AI destination URL'); }
    if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol)) {
        throw new Error('AI destination must be an HTTP(S) URL without credentials, query, or fragment');
    }
    const configured = (process.env.AI_ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean);
    const azure = url.protocol === 'https:' && !url.port && /^[a-z0-9-]+\.openai\.azure\.com$/.test(url.hostname);
    if (!DEFAULT_ORIGINS.includes(url.origin) && !azure && !configured.includes(url.origin)) {
        throw new Error('AI destination origin is not allowlisted in AI_ALLOWED_ORIGINS');
    }
    return url.href.replace(/\/$/, '');
}

// Disable redirects so an allowlisted service cannot forward credentials elsewhere.
export const aiFetch: typeof fetch = (input, init) => fetch(input, {
    ...init, redirect: 'error',
    signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
});

// The pinned Gemini SDK uses global fetch and has no custom transport option.
// Guard its allowlisted origins at startup as well as the injectable SDK transports.
export function guardAIFetch(originalFetch: typeof fetch): typeof fetch {
    return (input, init) => {
        const value = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
        let destination: URL;
        try { destination = new URL(value); } catch { return originalFetch(input, init); }
        try {
            validateAIDestination(destination.origin);
            return originalFetch(input, { ...init, redirect: 'error' });
        } catch { return originalFetch(input, init); }
    };
}
