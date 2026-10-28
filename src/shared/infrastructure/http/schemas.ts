// DTO communes : identifiants, pagination, format d'erreur
import { z } from 'zod';

export const idSchema = z.coerce.number({ error: 'Identifiant invalide' }).int('Identifiant invalide').positive('Identifiant invalide');

export const idParams = z.object({ id: idSchema });

export const memberParams = z.object({ id: idSchema, userId: idSchema });

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Toute collection qui peut grossir est paginée, avec une valeur par défaut côté serveur. */
export const paginationQuery = z.object({
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    offset: z.coerce.number().int().min(0).default(0),
});

export const paginationSchema = z.object({
    limit: z.number().int(),
    offset: z.number().int(),
    total: z.number().int(),
});

export function toPagination(page: { limit: number; offset: number }, total: number) {
    return { limit: page.limit, offset: page.offset, total };
}

export const errorResponseSchema = z.object({
    error: z.object({
        code: z.string().meta({ example: 'TEAM_FULL' }),
        message: z.string().meta({ example: 'L\'équipe est complète (5 joueurs)' }),
        details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
    }),
});
