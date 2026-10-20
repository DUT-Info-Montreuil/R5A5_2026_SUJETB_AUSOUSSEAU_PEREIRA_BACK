import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError.js';
import { CSRF_COOKIE } from './cookies.js';
import { securityLog } from './securityLog.js';

// Double-submit cookie : le serveur pose un cookie `csrf` aléatoire et renvoie la même valeur
// dans le corps de GET /api/auth/csrf. Le front (autre domaine, il ne peut pas lire le cookie)
// la garde en mémoire et la recopie dans X-CSRF-Token sur chaque requête non sûre.
// Une page piégée sur un autre site fait envoyer le cookie mais ne connaît pas sa valeur.

export const CSRF_HEADER = 'X-CSRF-Token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// 32 octets en base64url
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export function generateCsrfToken(): string {
    return randomBytes(32).toString('base64url');
}

export function isWellFormedCsrfToken(value: unknown): value is string {
    return typeof value === 'string' && TOKEN_FORMAT.test(value);
}

// Comparaison en temps constant (équivalent de secrets.compare_digest, jamais ===).
// Les empreintes ont toujours la même longueur, ce qu'exige timingSafeEqual
function safeEqual(a: string, b: string): boolean {
    return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

/** Toutes les méthodes non sûres, login et register compris (login CSRF). */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
    if (SAFE_METHODS.has(req.method)) {
        next();
        return;
    }
    const cookie: unknown = req.cookies?.[CSRF_COOKIE];
    const header = req.get(CSRF_HEADER);
    if (typeof cookie !== 'string' || !header || !safeEqual(cookie, header)) {
        securityLog('csrf_rejected', req, { reason: !cookie ? 'missing_cookie' : !header ? 'missing_header' : 'mismatch' });
        throw new AppError(403, 'CSRF_INVALID', 'Jeton anti-CSRF absent ou invalide');
    }
    next();
}
