function validateProductionEnv(env = process.env) {
    if (env.NODE_ENV !== 'production') return;
    const secret = env.NEXTAUTH_SECRET || '';
    if (secret.length < 32 || /^(your[_-]|change[_-]?me|replace|secret|placeholder|example)/i.test(secret)) {
        throw new Error('Production requires a random NEXTAUTH_SECRET of at least 32 characters');
    }
}

if (require.main === module) {
    try { validateProductionEnv(); } catch (error) { console.error(error.message); process.exit(1); }
}
module.exports = { validateProductionEnv };
