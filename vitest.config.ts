import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        setupFiles: ['tests/setup.ts'],
        // Base en mémoire : chaque fichier de test tourne dans son propre worker,
        // donc a sa propre base, et le fichier de dev n'est jamais touché
        env: {
            DB_PATH: ':memory:',
            // Valeur de test uniquement (32+ octets), jamais utilisée ailleurs
            JWT_SECRET: 'test-only-secret-0123456789abcdefghijklmnopqrstuvwxyz',
            // Supertest parle en HTTP : réglage « dev local » (jamais en production)
            COOKIE_SECURE: 'false',
            COOKIE_SAMESITE: 'lax',
            // Limites larges pour la suite ; les tests de limitation les abaissent eux-mêmes
            RATE_LIMIT_GLOBAL_PER_MIN: '100000',
            RATE_LIMIT_LOGIN_PER_MIN: '100000',
            RATE_LIMIT_REGISTER_PER_MIN: '100000',
            RATE_LIMIT_REFRESH_PER_MIN: '100000',
            RATE_LIMIT_CSRF_PER_MIN: '100000',
        },
    },
});
