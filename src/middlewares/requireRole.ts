import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError.js';
import type { Role } from '../types/user.js';

/**
 * Garde de rôle réutilisable (le rôle vient du claim `role` de l'access token) :
 *   router.post('/games', requireRole('admin'), controller.create)
 * Ne remplace pas la vérification de propriété faite dans le use case.
 */
export function requireRole(...roles: Role[]) {
    return function roleGuard(req: Request, res: Response, next: NextFunction): void {
        if (!req.user) {
            throw new AppError(401, 'UNAUTHORIZED', 'Authentification requise');
        }
        if (!roles.includes(req.user.role)) {
            throw new AppError(403, 'FORBIDDEN', 'Accès refusé');
        }
        next();
    };
}
