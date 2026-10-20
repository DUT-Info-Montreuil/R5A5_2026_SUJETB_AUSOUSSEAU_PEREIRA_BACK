import { afterEach, describe, expect, it, vi } from 'vitest';

// config.ts est évalué au chargement : on le réimporte avec un environnement modifié
async function loadConfig(env: Record<string, string | undefined>) {
    vi.resetModules();
    vi.unstubAllEnvs();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value as string);
    return import('../src/config.js');
}

afterEach(() => {
    vi.unstubAllEnvs();
});

const STRONG = 'Zx8!kq2Lp0vT9wRb4mN7cY1hJ6dF3sGa';

describe('validation de la configuration au démarrage', () => {
    it('refuse de démarrer sans JWT_SECRET', async () => {
        await expect(loadConfig({ JWT_SECRET: '' })).rejects.toThrow(/JWT_SECRET/);
    });

    it('refuse une clé JWT de moins de 32 octets ou non aléatoire', async () => {
        await expect(loadConfig({ JWT_SECRET: 'court' })).rejects.toThrow(/trop faible/);
        await expect(loadConfig({ JWT_SECRET: 'a'.repeat(64) })).rejects.toThrow(/trop faible/);
    });

    it('ne recopie jamais la valeur du secret dans le message d\'erreur', async () => {
        await expect(loadConfig({ JWT_SECRET: 'secret-tres-court' })).rejects.not.toThrow(/secret-tres-court/);
    });

    it('accepte une clé forte et fixe les durées 15 min / 30 j', async () => {
        const { config } = await loadConfig({ JWT_SECRET: STRONG });

        expect(config.accessTokenTtlSeconds).toBe(900);
        expect(config.refreshTokenTtlSeconds).toBe(2_592_000);
    });

    it('refuse SameSite=None sans Secure', async () => {
        await expect(
            loadConfig({ JWT_SECRET: STRONG, COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' }),
        ).rejects.toThrow(/COOKIE_SECURE/);
    });

    it('en production : refuse DEBUG, les cookies non Secure et les origines http', async () => {
        const prod = { JWT_SECRET: STRONG, NODE_ENV: 'production', CORS_ORIGINS: 'https://front.example', COOKIE_SECURE: 'true', COOKIE_SAMESITE: 'none' };

        await expect(loadConfig({ ...prod, DEBUG: 'true' })).rejects.toThrow(/DEBUG/);
        await expect(loadConfig({ ...prod, COOKIE_SECURE: 'false', COOKIE_SAMESITE: 'lax' })).rejects.toThrow(/COOKIE_SECURE/);
        await expect(loadConfig({ ...prod, CORS_ORIGINS: 'http://front.example' })).rejects.toThrow(/https/);
        await expect(loadConfig({ ...prod, CORS_ORIGINS: '' })).rejects.toThrow(/CORS_ORIGINS/);

        const { config } = await loadConfig(prod);
        expect(config.forceHttps).toBe(true);
        expect(config.cookies).toEqual({ secure: true, sameSite: 'none', domain: undefined });
    });
});
