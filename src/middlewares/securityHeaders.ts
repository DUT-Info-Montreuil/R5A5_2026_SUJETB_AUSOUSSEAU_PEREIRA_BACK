import type { NextFunction, Request, Response } from 'express';

// Posés une fois pour toutes les réponses (l'API ne sert que du JSON)
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
}

// Réponses d'authentification : jamais en cache (navigateur ou proxy)
export function noStore(req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Cache-Control', 'no-store');
    next();
}
