
export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { validateProductionEnv } = await import('../scripts/validate-production-env');
        try { validateProductionEnv(); }
        catch (error) {
            console.error(error instanceof Error ? error.message : 'Invalid production environment');
            process.exit(1);
        }
        const { guardAIFetch } = await import('./lib/ai-destination');
        globalThis.fetch = guardAIFetch(globalThis.fetch);
        const { setupGlobalProxy } = await import('./lib/global-proxy');
        setupGlobalProxy();
    }
}
