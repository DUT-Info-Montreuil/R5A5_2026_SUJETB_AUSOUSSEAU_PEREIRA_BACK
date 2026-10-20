import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { AppError } from '../errors/AppError.js';
import * as loginFailureRepository from '../repositories/loginFailureRepository.js';

// Ralentissement PAR COMPTE, en plus de la limite par IP : après chaque échec, le délai
// avant la tentative suivante double (1 s, 2 s, 4 s...). Jamais de blocage à durée fixe,
// qui permettrait à n'importe qui d'empêcher n'importe qui de se connecter ; le plafond
// garde le délai raisonnable.
// Indexé sur l'identifiant SAISI (email normalisé), qu'il existe ou non : la réponse ne
// révèle pas quelles adresses sont inscrites. On stocke son SHA-256, pas l'email.

function identifierHash(email: string): string {
    return createHash('sha256').update(email).digest('hex');
}

function delaySeconds(failureCount: number): number {
    const { baseSeconds, maxSeconds } = config.loginDelay;
    return Math.min(baseSeconds * 2 ** (failureCount - 1), maxSeconds);
}

/** Lève une 429 avec Retry-After si le délai consécutif au dernier échec n'est pas écoulé. */
export function assertLoginAllowed(email: string): void {
    const failure = loginFailureRepository.find(identifierHash(email));
    if (!failure) return;
    const waitMs = Date.parse(failure.next_allowed_at) - Date.now();
    if (waitMs > 0) {
        const retryAfter = String(Math.ceil(waitMs / 1000));
        throw new AppError(429, 'LOGIN_DELAYED', 'Trop de tentatives, réessayez plus tard', undefined, { 'Retry-After': retryAfter });
    }
}

export function recordLoginFailure(email: string): void {
    const key = identifierHash(email);
    const failureCount = (loginFailureRepository.find(key)?.failure_count ?? 0) + 1;
    const now = Date.now();
    loginFailureRepository.save({
        identifier_hash: key,
        failure_count: failureCount,
        next_allowed_at: new Date(now + delaySeconds(failureCount) * 1000).toISOString(),
        last_failure_at: new Date(now).toISOString(),
    });
}

export function resetLoginFailures(email: string): void {
    loginFailureRepository.remove(identifierHash(email));
}
