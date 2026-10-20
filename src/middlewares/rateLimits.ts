import type { NextFunction, Request, Response } from 'express';
import { rateLimit, type Options } from 'express-rate-limit';
import { config } from '../config.js';
import { AppError } from '../errors/AppError.js';
import { securityLog } from '../security/securityLog.js';

// Trois niveaux combinés : global large par IP, serré par IP sur les routes sensibles,
// quota par compte sur les opérations consommatrices.
// Stockage en mémoire : à remplacer par un store partagé (Redis...) avec plusieurs instances
function limiter(name: string, limit: number, overrides: Partial<Options> = {}) {
    return rateLimit({
        windowMs: config.rateLimits.windowMs,
        limit,
        identifier: name,
        standardHeaders: 'draft-8', // RateLimit, RateLimit-Policy et Retry-After
        legacyHeaders: false,
        handler: (req: Request, res: Response, next: NextFunction) => {
            securityLog('rate_limited', req, { limiter: name });
            next(new AppError(429, 'RATE_LIMITED', 'Trop de requêtes, réessayez plus tard'));
        },
        ...overrides,
    });
}

export const globalRateLimit = limiter('global', config.rateLimits.globalPerMinute);
export const loginRateLimit = limiter('login', config.rateLimits.loginPerMinute);
export const registerRateLimit = limiter('register', config.rateLimits.registerPerMinute);
export const refreshRateLimit = limiter('refresh', config.rateLimits.refreshPerMinute);
export const csrfRateLimit = limiter('csrf', config.rateLimits.csrfPerMinute);

/**
 * Quota par compte (après le garde d'authentification), pour les opérations coûteuses :
 *   router.post('/tournaments', requireRole('admin'), accountQuota('tournament-create', 10, 24 * 3600_000), ...)
 */
export function accountQuota(name: string, limit: number, windowMs: number) {
    return limiter(name, limit, {
        windowMs,
        keyGenerator: (req: Request) => req.user!.publicId,
        skip: (req: Request) => req.user === undefined,
    });
}
