// DTO communes : identifiants, pagination, format d'erreur
import { z } from 'zod';

export const idSchema = z.coerce.number({ error: 'Identifiant invalide' }).int('Identifiant invalide').positive('Identifiant invalide');

export const idParams = z.object({ id: idSchema });

export const memberParams = z.object({ id: idSchema, userId: idSchema });

/** Date ISO 8601 avec fuseau (« 2026-11-03T18:00:00+01:00 »), stockée en UTC comme les autres dates. */
export const dateTimeSchema = z.iso
    .datetime({ offset: true, error: 'Date ISO 8601 attendue, avec fuseau' })
    .transform((value) => new Date(value).toISOString());

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
