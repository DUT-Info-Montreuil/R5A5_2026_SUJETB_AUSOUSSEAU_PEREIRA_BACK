import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError.js';
import { publicMode } from '../security/publicRoutes.js';
import { authenticateAccessToken } from '../services/authService.js';

/**
 * Garde d'authentification GLOBALE (montée une seule fois dans app.ts, avant les routes) :
 * toute requête exige un access token valide, sauf les routes déclarées dans publicRoutes.ts.
 * Le jeton se lit uniquement dans `Authorization: Bearer`, jamais dans l'URL.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
    const mode = publicMode(req.method, req.path);
    if (mode === 'public') {
        next();
        return;
    }

    const header = req.headers.authorization;
    if (header === undefined && mode === 'optional') {
        next();
        return;
    }

    const [scheme, token, ...rest] = header?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token || rest.length > 0) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentification requise');
    }

    req.user = authenticateAccessToken(token);
    next();
}
