import { z } from 'zod';
import { route, type AnyRoute } from '../../../shared/infrastructure/http/routing.js';
import { paginationQuery, paginationSchema, toPagination } from '../../../shared/infrastructure/http/schemas.js';
import type { GameService } from '../application/gameService.js';
import type { Game } from '../domain/game.js';

export const createGameBody = z.strictObject({
    name: z.string().trim().min(1, 'Nom requis').max(50),
    roles: z.array(z.string().trim().min(1).max(32)).min(1, 'Au moins un rôle').max(10),
});

export const gameResponse = z.object({
    id: z.number().int(),
    name: z.string(),
    roles: z.array(z.object({ id: z.number().int(), name: z.string() })),
});

export function toGameResponse(game: Game): z.infer<typeof gameResponse> {
    return { id: game.id, name: game.name, roles: game.roles.map((r) => ({ id: r.id, name: r.name })) };
}

export function gameRoutes(games: GameService): AnyRoute[] {
    return [
        route({
            method: 'get',
            path: '/api/games',
            tag: 'Jeux',
            summary: 'Liste des jeux et de leurs rôles',
            access: 'public',
            query: paginationQuery,
            response: z.object({ games: z.array(gameResponse), pagination: paginationSchema }),
            handle: ({ query }) => {
                const page = games.list(query);
                return { games: page.items.map(toGameResponse), pagination: toPagination(query, page.total) };
            },
        }),
        route({
            method: 'post',
            path: '/api/games',
            tag: 'Jeux',
            summary: 'Créer un jeu avec ses rôles',
            access: 'admin',
            body: createGameBody,
            status: 201,
            response: z.object({ game: gameResponse }),
            errors: { 409: 'Ce jeu existe déjà (GAME_NAME_TAKEN)', 422: 'Deux rôles portent le même nom (DUPLICATE_ROLES)' },
            handle: ({ body }) => ({ game: toGameResponse(games.create(body)) }),
        }),
    ];
}
