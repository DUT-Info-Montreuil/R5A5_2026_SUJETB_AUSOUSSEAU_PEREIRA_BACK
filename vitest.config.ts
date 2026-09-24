import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        setupFiles: ['tests/setup.ts'],
        // Base en mémoire : chaque fichier de test tourne dans son propre worker,
        // donc a sa propre base, et le fichier de dev n'est jamais touché
        env: {
            DB_PATH: ':memory:',
            JWT_SECRET: 'test-secret',
            JWT_EXPIRES_IN: '1h',
        },
    },
});
