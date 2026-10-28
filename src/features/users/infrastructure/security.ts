// Implémentations des ports de sécurité : hachage, jetons, freinage des essais de connexion
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { TooManyAttemptsError, UnauthenticatedError } from '../../../shared/domain/errors.js';
import type { LoginThrottle, PasswordHasher, TokenService } from '../application/ports.js';

const BCRYPT_COST = 12;

export class BcryptPasswordHasher implements PasswordHasher {
    hash(password: string): Promise<string> {
        return bcrypt.hash(password, BCRYPT_COST);
    }

    verify(password: string, hash: string): Promise<boolean> {
        return bcrypt.compare(password, hash);
    }
}

export class JwtTokenService implements TokenService {
    private readonly secret: string;
    private readonly expiresIn: NonNullable<SignOptions['expiresIn']>;

    constructor(secret: string, expiresIn: NonNullable<SignOptions['expiresIn']>) {
        this.secret = secret;
        this.expiresIn = expiresIn;
    }

    // Le payload ne contient que l'identifiant : n'importe qui peut le lire
    sign(userId: number): string {
        return jwt.sign({ sub: String(userId) }, this.secret, { algorithm: 'HS256', expiresIn: this.expiresIn });
    }

    verify(token: string): { userId: number; expiresAt: Date } {
        let payload: string | jwt.JwtPayload;
        try {
            // Algorithme imposé : un jeton ne peut pas choisir le sien
            payload = jwt.verify(token, this.secret, { algorithms: ['HS256'] });
        } catch (err) {
            if (err instanceof jwt.TokenExpiredError) {
                throw new UnauthenticatedError('TOKEN_EXPIRED', 'Session expirée, veuillez vous reconnecter');
            }
            throw new UnauthenticatedError('INVALID_TOKEN', 'Token invalide');
        }
        const userId = typeof payload === 'object' ? Number(payload.sub) : NaN;
        if (!Number.isInteger(userId) || typeof payload !== 'object' || payload.exp === undefined) {
            throw new UnauthenticatedError('INVALID_TOKEN', 'Token invalide');
        }
        return { userId, expiresAt: new Date(payload.exp * 1000) };
    }
}

const MAX_DELAY_SECONDS = 15 * 60;
const MAX_TRACKED_ACCOUNTS = 10_000;

/**
 * Délai qui double après chaque échec consécutif sur un compte (1 s, 2 s, 4 s…, 15 min au plus) :
 * gêne l'attaquant sans permettre de bloquer le compte de quelqu'un d'autre pendant des heures.
 * shortcut: compteurs en mémoire, valables pour une seule instance ; passer par Redis à plusieurs instances.
 */
export class MemoryLoginThrottle implements LoginThrottle {
    private readonly attempts = new Map<string, { failures: number; retryAt: number }>();
    private readonly now: () => number;

    constructor(now: () => number = Date.now) {
        this.now = now;
    }

    assertAllowed(accountKey: string): void {
        const entry = this.attempts.get(accountKey.toLowerCase());
        const waitMs = entry ? entry.retryAt - this.now() : 0;
        if (waitMs > 0) {
            throw new TooManyAttemptsError('TOO_MANY_ATTEMPTS', 'Trop de tentatives, réessayez plus tard', Math.ceil(waitMs / 1000));
        }
    }

    recordFailure(accountKey: string): void {
        if (this.attempts.size >= MAX_TRACKED_ACCOUNTS) this.forgetExpired();
        const key = accountKey.toLowerCase();
        const failures = (this.attempts.get(key)?.failures ?? 0) + 1;
        const delaySeconds = Math.min(2 ** (failures - 1), MAX_DELAY_SECONDS);
        this.attempts.set(key, { failures, retryAt: this.now() + delaySeconds * 1000 });
    }

    reset(accountKey: string): void {
        this.attempts.delete(accountKey.toLowerCase());
    }

    private forgetExpired(): void {
        const limit = this.now() - MAX_DELAY_SECONDS * 1000;
        for (const [key, entry] of this.attempts) if (entry.retryAt < limit) this.attempts.delete(key);
    }
}
