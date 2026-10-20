import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError.js';

function hasBody(req: Request): boolean {
    return req.headers['transfer-encoding'] !== undefined
        || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0');
}

// Une requête qui porte un corps doit l'annoncer en JSON, sinon 415
export function requireJson(req: Request, res: Response, next: NextFunction): void {
    if (hasBody(req) && !req.is('application/json')) {
        throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Le corps de la requête doit être en application/json');
    }
    next();
}
