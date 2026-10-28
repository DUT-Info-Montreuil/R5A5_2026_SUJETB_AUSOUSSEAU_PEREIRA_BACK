import type { NextFunction, Request, Response } from 'express';
import type { Authenticated } from '../../../features/users/application/authService.js';
import { AccessDeniedError, UnauthenticatedError } from '../../domain/errors.js';

/** Vérifie que le jeton est présent, valide et non expiré, puis expose l'utilisateur sur `req.user`. */
export function createAuthenticate(authenticate: (token: string) => Authenticated) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
        if (scheme !== 'Bearer' || !token) throw new UnauthenticatedError('UNAUTHORIZED', 'Authentification requise');
        req.user = authenticate(token).user;
        next();
    };
}

/** Garde de route : le rôle administrateur. Le droit sur une ressource précise reste vérifié par le use case. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    if (!req.user?.isAdmin) throw new AccessDeniedError('FORBIDDEN', 'Accès réservé aux administrateurs');
    next();
}
