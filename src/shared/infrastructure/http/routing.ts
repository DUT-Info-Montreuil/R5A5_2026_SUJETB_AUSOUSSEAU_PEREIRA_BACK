import { Router, type RequestHandler } from 'express';
import type { z } from 'zod';
import type { User } from '../../../features/users/domain/user.js';

/**
 * Chaque route déclare explicitement qui peut l'appeler : aucune route n'est publique par oubli.
 * - public : sans jeton
 * - authenticated : jeton valide (401 sinon) ; le droit sur la ressource est vérifié par le use case
 * - admin : jeton valide et rôle administrateur (403 sinon)
 */
export type Access = 'public' | 'authenticated' | 'admin';

type Out<S> = S extends z.ZodType ? z.output<S> : undefined;

export type DocumentedError = 401 | 403 | 404 | 409 | 422 | 429;

export interface RouteSpec<P, Q, B, A extends Access> {
    method: 'get' | 'post' | 'patch' | 'delete';
    path: string;
    tag: string;
    summary: string;
    access: A;
    params?: P;
    query?: Q;
    body?: B;
    status?: 200 | 201 | 204;
    /** Schéma de la réponse de succès : sert à la documentation OpenAPI. */
    response?: z.ZodType;
    /** Cas d'erreur propres à la route, documentés dans OpenAPI. */
    errors?: Partial<Record<DocumentedError, string>>;
    /** Limite de débit serrée (connexion, inscription). */
    strictRateLimit?: boolean;
    handle(input: {
        params: Out<P>;
        query: Out<Q>;
        body: Out<B>;
        user: A extends 'public' ? undefined : User;
    }): unknown;
}

export type AnyRoute = RouteSpec<any, any, any, Access>;

/** Déclare une route : les types de `handle` sont déduits des schémas zod. */
export function route<
    P extends z.ZodType | undefined = undefined,
    Q extends z.ZodType | undefined = undefined,
    B extends z.ZodType | undefined = undefined,
    A extends Access = Access,
>(spec: RouteSpec<P, Q, B, A>): AnyRoute {
    return spec as AnyRoute;
}

/**
 * Monte les routes. Pour chacune, dans l'ordre : limite de débit, authentification, rôle,
 * validation des entrées (DTO zod), appel du use case, réponse.
 */
export function buildRouter(
    routes: AnyRoute[],
    middlewares: { authenticate: RequestHandler; requireAdmin: RequestHandler; strictRateLimit: RequestHandler },
): Router {
    const router = Router();
    for (const spec of routes) {
        const chain: RequestHandler[] = [
            (req, res, next) => {
                res.locals.route = spec.path; // motif de route pour les logs : /api/teams/:id
                next();
            },
        ];
        if (spec.strictRateLimit) chain.push(middlewares.strictRateLimit);
        if (spec.access !== 'public') chain.push(middlewares.authenticate);
        if (spec.access === 'admin') chain.push(middlewares.requireAdmin);
        chain.push(async (req, res) => {
            const result = await spec.handle({
                params: spec.params?.parse(req.params),
                query: spec.query?.parse(req.query),
                body: spec.body?.parse(req.body),
                user: req.user,
            });
            if (spec.status === 204) {
                res.status(204).end();
            } else {
                res.status(spec.status ?? 200).json(result);
            }
        });
        router[spec.method](spec.path, ...chain);
    }
    return router;
}
