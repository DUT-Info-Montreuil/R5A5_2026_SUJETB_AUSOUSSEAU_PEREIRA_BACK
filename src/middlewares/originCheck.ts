import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { AppError } from '../errors/AppError.js';
import { securityLog } from '../security/securityLog.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Défense supplémentaire (au-delà du cours) : une requête non sûre venant d'un navigateur
 * porte l'en-tête Origin, qui doit être une origine autorisée. Sans Origin (client hors
 * navigateur), la requête continue : le jeton anti-CSRF reste exigé.
 */
export function originCheck(req: Request, res: Response, next: NextFunction): void {
    const origin = req.get('Origin');
    if (SAFE_METHODS.has(req.method) || origin === undefined || config.corsOrigins.includes(origin)) {
        next();
        return;
    }
    securityLog('origin_rejected', req, { origin });
    throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origine non autorisée');
}
