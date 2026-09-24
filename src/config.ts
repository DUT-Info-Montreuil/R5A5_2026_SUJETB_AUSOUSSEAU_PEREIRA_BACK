import type { SignOptions } from 'jsonwebtoken';

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value || value.trim() === '') {
        throw new Error(`Variable d'environnement manquante : ${name} (voir .env.example)`);
    }
    return value;
}

export const config = {
    jwtSecret: requireEnv('JWT_SECRET'),
    jwtExpiresIn: (process.env.JWT_EXPIRES_IN || '1h') as NonNullable<SignOptions['expiresIn']>,
} as const;
