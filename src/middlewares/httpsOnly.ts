import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { AppError } from '../errors/AppError.js';

// Derrière un reverse proxy, req.secure n'est fiable qu'avec TRUST_PROXY configuré
export function httpsOnly(req: Request, res: Response, next: NextFunction): void {
    if (!config.forceHttps || req.secure) {
        next();
        return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
        // Pas res.redirect() : il produirait un corps HTML ; l'API ne répond qu'en JSON
        res.status(308)
            .location(`https://${req.hostname}${req.originalUrl}`)
            .json({ error: { code: 'HTTPS_REQUIRED', message: 'HTTPS obligatoire' } });
        return;
    }
    // Une requête d'écriture en clair a déjà exposé son contenu : on ne la rejoue pas
    throw new AppError(403, 'HTTPS_REQUIRED', 'HTTPS obligatoire');
}
