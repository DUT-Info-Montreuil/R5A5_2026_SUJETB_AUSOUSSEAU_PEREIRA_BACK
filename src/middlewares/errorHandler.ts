import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError.js';

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

    if (err instanceof AppError) {
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

    console.error(err);
    res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Erreur interne du serveur' },
    });
}
