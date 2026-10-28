// Description OpenAPI générée depuis la table des routes : les mêmes schémas zod valident et documentent
import { z } from 'zod';
import type { AnyRoute } from './routing.js';
import { errorResponseSchema } from './schemas.js';

function toJsonSchema(schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> {
    const { $schema: _ignored, ...json } = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as Record<string, unknown>;
    return json;
}

function parameters(schema: z.ZodType | undefined, location: 'path' | 'query') {
    if (!(schema instanceof z.ZodObject)) return [];
    return Object.entries(schema.shape as Record<string, z.ZodType>).map(([name, field]) => ({
        name,
        in: location,
        required: location === 'path' || !field.safeParse(undefined).success,
        schema: toJsonSchema(field, 'output'),
    }));
}

const errorContent = { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } };

function errorResponse(description: string) {
    return { description, content: errorContent };
}

function responses(spec: AnyRoute) {
    const status = String(spec.status ?? 200);
    const result: Record<string, unknown> = {
        [status]: spec.status === 204
            ? { description: 'Succès, sans contenu' }
            : { description: 'Succès', ...(spec.response && { content: { 'application/json': { schema: toJsonSchema(spec.response, 'output') } } }) },
    };
    const errors: Record<string, string[]> = {};
    const add = (code: number, description: string) => (errors[code] ??= []).push(description);

    if (spec.params || spec.query || spec.body) add(400, 'Données invalides (VALIDATION_ERROR)');
    if (spec.access !== 'public') add(401, 'Jeton absent, invalide ou expiré');
    if (spec.access === 'admin') add(403, 'Réservé aux administrateurs (FORBIDDEN)');
    for (const [code, description] of Object.entries(spec.errors ?? {})) add(Number(code), description);
    add(429, 'Trop de requêtes (RATE_LIMITED)');

    for (const [code, descriptions] of Object.entries(errors)) result[code] = errorResponse(descriptions.join(' ; '));
    return result;
}

export function buildOpenApiDocument(routes: AnyRoute[]) {
    const paths: Record<string, Record<string, unknown>> = {};
    for (const spec of routes) {
        const path = spec.path.replace(/:(\w+)/g, '{$1}');
        paths[path] ??= {};
        paths[path][spec.method] = {
            tags: [spec.tag],
            summary: spec.summary,
            security: spec.access === 'public' ? [] : [{ bearerAuth: [] }],
            parameters: [...parameters(spec.params, 'path'), ...parameters(spec.query, 'query')],
            ...(spec.body && {
                requestBody: { required: true, content: { 'application/json': { schema: toJsonSchema(spec.body, 'input') } } },
            }),
            responses: responses(spec),
        };
    }
    return {
        openapi: '3.1.0',
        info: {
            title: 'Arch Rivals API',
            version: '1.0.0',
            description:
                'API de la plateforme de tournois (R5A5, sujet B). Toutes les erreurs ont la forme `{ "error": { "code", "message" } }`. ' +
                'Les événements temps réel (Socket.IO) sont décrits dans api-routes.md.',
        },
        components: {
            securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
            schemas: { Error: toJsonSchema(errorResponseSchema, 'output') },
        },
        paths,
    };
}
