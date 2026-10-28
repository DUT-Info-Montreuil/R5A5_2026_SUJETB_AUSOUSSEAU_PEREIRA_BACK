import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../../application/ports.js';
import { requestContext } from '../logger.js';

/**
 * Branché en premier : il voit toutes les requêtes, y compris celles refusées par l'authentification
 * ou la validation. Une seule ligne par requête, écrite au départ de la réponse.
 * Ni corps, ni en-tête Authorization, ni adresse IP (donnée personnelle, sans besoin identifié).
 */
export function createRequestLogger(logger: Logger) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const requestId = randomUUID();
        const start = performance.now();
        res.locals.requestId = requestId;
        res.setHeader('X-Request-Id', requestId);

        res.on('finish', () => {
            const status = res.statusCode;
            const queryStart = req.originalUrl.indexOf('?');
            const fields = {
                request_id: requestId,
                method: req.method,
                path: queryStart === -1 ? req.originalUrl : req.originalUrl.slice(0, queryStart),
                route: res.locals.route as string | undefined,
                query: queryStart === -1 ? '' : req.originalUrl.slice(queryStart + 1),
                status,
                duration_ms: Math.round(performance.now() - start),
                size_bytes: Number(res.getHeader('Content-Length')) || 0,
                user: req.user?.id,
                user_agent: req.get('User-Agent'),
                exception: res.locals.exception as string | undefined,
                error: res.locals.error as string | undefined,
            };
            if (status >= 500) logger.error('request_failed', fields);
            else if (status >= 400) logger.warn('request_rejected', fields);
            else logger.info('request_completed', fields);
        });

        // Les logs métier écrits pendant la requête portent le même request_id
        requestContext.run({ requestId }, next);
    };
}
