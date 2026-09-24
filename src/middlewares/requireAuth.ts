import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError.js';
import { getUserFromToken } from '../services/authService.js';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    const [scheme, token] = header?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentification requise');
    }

    req.user = getUserFromToken(token);
    next();
}
