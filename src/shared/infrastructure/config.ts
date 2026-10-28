import type { SignOptions } from 'jsonwebtoken';

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value || value.trim() === '') {
        throw new Error(`Variable d'environnement manquante : ${name} (voir .env.example)`);
    }
    return value;
}

function intEnv(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Lue une seule fois au démarrage : une configuration incomplète arrête l'application tout de suite. */
export function loadConfig() {
    const jwtSecret = requireEnv('JWT_SECRET');
    if (jwtSecret.length < 32) {
        throw new Error('JWT_SECRET doit faire au moins 32 caractères (voir .env.example)');
    }
    return {
        port: intEnv('PORT', 3000),
        dbPath: process.env.DB_PATH || 'data/arch-rivals.db',
        jwtSecret,
        jwtExpiresIn: (process.env.JWT_EXPIRES_IN || '1h') as NonNullable<SignOptions['expiresIn']>,
        // Liste d'origines séparées par des virgules, jamais "*"
        corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim()),
        logLevel: process.env.LOG_LEVEL || 'info',
        // Requêtes par minute et par adresse IP
        rateLimitGlobal: intEnv('RATE_LIMIT_GLOBAL', 300),
        // Tentatives de connexion / inscription par 15 minutes et par adresse IP
        rateLimitAuth: intEnv('RATE_LIMIT_AUTH', 20),
    };
}

export type Config = ReturnType<typeof loadConfig>;
