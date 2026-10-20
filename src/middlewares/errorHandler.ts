import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { config } from '../config.js';
import { AccessDenied } from '../errors/AccessDenied.js';
import { AppError } from '../errors/AppError.js';
import { securityLog } from '../security/securityLog.js';

export function notFoundHandler(req: Request, res: Response): void {
    res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Route introuvable : ${req.method} ${req.path}` },
    });
}

// Express reconnaît un middleware d'erreur à ses 4 paramètres : `next` doit rester
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
    if (res.headersSent) {
        next(err);
        return;
    }

    // Seul point de conversion de l'exception métier en statut HTTP
    if (err instanceof AccessDenied) {
        securityLog('access_denied', req, { userId: req.user?.publicId });
        res.status(403).json({ error: { code: 'FORBIDDEN', message: err.message } });
        return;
    }

    if (err instanceof AppError) {
        if (err.status === 403) securityLog('forbidden', req, { userId: req.user?.publicId, code: err.code });
        if (err.headers) res.set(err.headers);
        res.status(err.status).json({
            error: {
                code: err.code,
                message: err.message,
                ...(err.details !== undefined && { details: err.details }),
            },
        });
        return;
    }

    if (err instanceof ZodError) {
        res.status(400).json({
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Données invalides',
                details: err.issues.map((issue) => ({
                    field: issue.path.join('.'),
                    message: issue.message,
                })),
            },
        });
        return;
    }

    // Body JSON mal formé (levé par express.json())
    if (err instanceof SyntaxError && 'type' in err && err.type === 'entity.parse.failed') {
        res.status(400).json({
            error: { code: 'INVALID_JSON', message: 'Le corps de la requête n\'est pas un JSON valide' },
        });
        return;
    }

    // Autres erreurs de express.json() : corps trop gros, encodage ou charset non pris en charge
    if (err instanceof Error && 'type' in err) {
        if (err.type === 'entity.too.large') {
            res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Corps de requête trop volumineux' } });
            return;
        }
        if (err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') {
            res.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Encodage non pris en charge' } });
            return;
        }
    }

    // Détail dans les logs uniquement, relié à la réponse par l'identifiant de requête
    console.error(JSON.stringify({
        level: 'error',
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        error: err instanceof Error ? err.stack : String(err),
    }));
    res.status(500).json({
        error: {
            code: 'INTERNAL_ERROR',
            message: 'Erreur interne du serveur',
            requestId: req.requestId,
            // Jamais en production : config.ts refuse de démarrer avec DEBUG=true
            ...(config.debug && err instanceof Error && { details: err.message }),
        },
    });
}
