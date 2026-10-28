import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { Logger } from '../../application/ports.js';
import {
    AccessDeniedError,
    ConflictError,
    DomainError,
    NotFoundError,
    RuleViolationError,
    TooManyAttemptsError,
    UnauthenticatedError,
} from '../../domain/errors.js';

// Seul endroit qui traduit une erreur métier en statut HTTP
const STATUS_BY_ERROR = new Map<Function, number>([
    [NotFoundError, 404],
    [UnauthenticatedError, 401],
    [AccessDeniedError, 403],
    [ConflictError, 409],
    [RuleViolationError, 422],
    [TooManyAttemptsError, 429],
]);

function sendError(res: Response, status: number, code: string, message: string, details?: unknown): void {
    res.status(status).json({ error: { code, message, ...(details !== undefined && { details }) } });
}

export function notFoundHandler(req: Request, res: Response): void {
    sendError(res, 404, 'NOT_FOUND', `Route introuvable : ${req.method} ${req.path}`);
}

/**
 * Trois rôles : traduire l'exception en réponse, ne jamais exposer le détail technique au client,
 * et ranger la classe et le message de l'exception pour la ligne de log de fin de requête.
 */
export function createErrorHandler(logger: Logger) {
    // Express reconnaît un middleware d'erreur à ses 4 paramètres : `next` doit rester
    return (err: unknown, req: Request, res: Response, next: NextFunction): void => {
        if (res.headersSent) {
            next(err);
            return;
        }
        res.locals.exception = err instanceof Error ? err.name : typeof err;
        res.locals.error = err instanceof Error ? err.message : String(err);

        if (err instanceof DomainError) {
            if (err instanceof TooManyAttemptsError) res.setHeader('Retry-After', String(err.retryAfterSeconds));
            sendError(res, STATUS_BY_ERROR.get(err.constructor) ?? 400, err.code, err.message);
            return;
        }

        if (err instanceof ZodError) {
            const details = err.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
            res.locals.error = details.map((d) => `${d.field}: ${d.message}`).join('; ');
            sendError(res, 400, 'VALIDATION_ERROR', 'Données invalides', details);
            return;
        }

        // Erreurs levées par express.json()
        const type = err instanceof Error && 'type' in err ? err.type : undefined;
        if (type === 'entity.parse.failed') {
            sendError(res, 400, 'INVALID_JSON', 'Le corps de la requête n\'est pas un JSON valide');
            return;
        }
        if (type === 'entity.too.large') {
            sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Le corps de la requête est trop volumineux');
            return;
        }

        // Imprévu : la pile d'appels va dans une ligne à part, reliée par request_id, jamais au client
        logger.error('unhandled_exception', {
            exception: res.locals.exception,
            error: res.locals.error,
            stack: err instanceof Error ? err.stack : undefined,
            request_id: res.locals.requestId,
        });
        sendError(res, 500, 'INTERNAL_ERROR', 'Erreur interne du serveur');
    };
}
