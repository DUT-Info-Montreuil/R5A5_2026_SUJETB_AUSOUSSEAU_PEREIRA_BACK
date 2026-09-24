import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError.js';

// À placer après requireAuth
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentification requise');
    }
    if (!req.user.isAdmin) {
        throw new AppError(403, 'FORBIDDEN', 'Accès réservé aux administrateurs');
    }
    next();
}
