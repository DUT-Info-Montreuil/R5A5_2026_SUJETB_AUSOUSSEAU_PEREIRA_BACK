import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

// Identifiant généré côté serveur (on ne reprend pas celui du client) : il relie
// une réponse d'erreur générique au détail écrit dans les logs
export function requestId(req: Request, res: Response, next: NextFunction): void {
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
}
