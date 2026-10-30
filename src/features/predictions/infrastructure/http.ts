import { z } from 'zod';
import { route, type AnyRoute } from '../../../shared/infrastructure/http/routing.js';
import { idParams, idSchema, paginationQuery, paginationSchema, toPagination } from '../../../shared/infrastructure/http/schemas.js';
import type { PredictionSummary } from '../application/ports.js';
import type { PredictionService } from '../application/predictionService.js';
import type { Pick, Score } from '../domain/prediction.js';

// --- DTO d'entrée ---

const predictBody = z.strictObject({
    picks: z
        .array(z.strictObject({ matchId: idSchema, teamId: idSchema.describe('Le vainqueur annoncé') }))
        .max(7)
        .describe('Un pronostic par match de l\'arbre (7)'),
});

// --- DTO de sortie ---

const myPredictionResponse = z.object({
    picks: z.array(z.object({ matchId: z.number().int(), teamId: z.number().int() })).describe('Vide si rien n\'a été envoyé'),
    points: z.number().int().describe('1 point par quart, 2 par demie, 4 pour la finale'),
    correct: z.number().int(),
});

const summaryResponse = z.object({
    participants: z.number().int(),
    matches: z.array(
        z.object({
            matchId: z.number().int(),
            picks: z.array(z.object({ teamId: z.number().int(), count: z.number().int() })),
        }),
    ),
});

const standingResponse = z.object({
    rank: z.number().int().describe('Ex aequo au même rang'),
    user: z.object({ id: z.number().int(), username: z.string() }),
    points: z.number().int(),
    correct: z.number().int(),
});

function toMyPredictionResponse(p: Score & { picks: Pick[] }): z.infer<typeof myPredictionResponse> {
    return { picks: p.picks.map((pick) => ({ matchId: pick.matchId, teamId: pick.teamId })), points: p.points, correct: p.correct };
}

export function toPredictionSummaryResponse(summary: PredictionSummary): z.infer<typeof summaryResponse> & { tournamentId: number } {
    return { tournamentId: summary.tournamentId, participants: summary.participants, matches: summary.matches };
}

const NOT_FOUND = { 404: 'Tournoi introuvable (TOURNAMENT_NOT_FOUND)' } as const;

export function predictionRoutes(predictions: PredictionService): AnyRoute[] {
    return [
        route({
            method: 'post',
            path: '/api/tournaments/:id/predictions',
            tag: 'Pronostics',
            summary: 'Pronostiquer tout l\'arbre (remplace le précédent), entre la clôture et le lancement',
            access: 'authenticated',
            params: idParams,
            body: predictBody,
            response: myPredictionResponse,
            errors: {
                ...NOT_FOUND,
                403: 'Joueur de ce tournoi (PLAYER_CANNOT_PREDICT)',
                409: 'Tournoi pas encore clos ou déjà lancé (PREDICTIONS_CLOSED)',
                422: 'Il manque un match, ou une équipe ne peut pas arriver là d\'après l\'arbre envoyé (INVALID_PREDICTION)',
            },
            handle: ({ params, body, user }) => toMyPredictionResponse(predictions.submit(params.id, user.id, body.picks)),
        }),
        route({
            method: 'get',
            path: '/api/tournaments/:id/predictions/me',
            tag: 'Pronostics',
            summary: 'Mon pronostic et mes points',
            access: 'authenticated',
            params: idParams,
            response: myPredictionResponse,
            errors: NOT_FOUND,
            handle: ({ params, user }) => toMyPredictionResponse(predictions.mine(params.id, user.id)),
        }),
        route({
            method: 'get',
            path: '/api/tournaments/:id/predictions',
            tag: 'Pronostics',
            summary: 'Répartition des pronostics du public, match par match',
            access: 'public',
            params: idParams,
            response: summaryResponse,
            errors: NOT_FOUND,
            handle: ({ params }) => toPredictionSummaryResponse(predictions.summary(params.id)),
        }),
        route({
            method: 'get',
            path: '/api/tournaments/:id/predictions/leaderboard',
            tag: 'Pronostics',
            summary: 'Classement des pronostiqueurs : points, puis bons pronostics',
            access: 'public',
            params: idParams,
            query: paginationQuery,
            response: z.object({ leaderboard: z.array(standingResponse), pagination: paginationSchema }),
            errors: NOT_FOUND,
            handle: ({ params, query }) => {
                const result = predictions.leaderboard(params.id, query);
                return {
                    leaderboard: result.items.map((s) => ({ rank: s.rank, user: { id: s.user.id, username: s.user.username }, points: s.points, correct: s.correct })),
                    pagination: toPagination(query, result.total),
                };
            },
        }),
    ];
}
