import type { NextFunction, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';

/** Headers de durcissement posés sur toutes les réponses de l'API. */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    // Une réponse d'API n'a besoin de charger aucune ressource ; la page /docs a sa propre politique
    res.setHeader(
        'Content-Security-Policy',
        req.path.startsWith('/docs')
            ? "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"
            : "default-src 'none'",
    );
    next();
}

/** Un corps de requête doit être du JSON : le serveur ne devine pas le format. */
export function requireJsonBody(req: Request, res: Response, next: NextFunction): void {
    const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
    if (hasBody && !req.is('application/json')) {
        res.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Le corps doit être en JSON (Content-Type: application/json)' } });
        return;
    }
    next();
}

/** Limitation de débit par adresse IP. C'est la bibliothèque qui renvoie le 429, au format d'erreur de l'API. */
export function createRateLimiter(limit: number, windowMs: number) {
    return rateLimit({
        windowMs,
        limit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        handler: (req, res) => {
            res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Trop de requêtes, réessayez plus tard' } });
        },
    });
}
