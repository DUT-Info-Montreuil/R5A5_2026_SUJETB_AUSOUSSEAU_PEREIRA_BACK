import { z } from 'zod';
import { route, type AnyRoute } from '../../../shared/infrastructure/http/routing.js';
import { idParams, idSchema, paginationQuery, paginationSchema, toPagination } from '../../../shared/infrastructure/http/schemas.js';
import type { BetService } from '../application/betService.js';
import type { BetPool, Bettor } from '../application/ports.js';
import { MIN_BET, type Bet } from '../domain/bet.js';

// --- DTO d'entrée ---

const placeBetBody = z.strictObject({
    teamId: idSchema,
    amount: z.number().int().min(MIN_BET, `Mise de ${MIN_BET} Écus au moins`),
});

const weekQuery = paginationQuery.extend({ week: z.enum(['current', 'previous']).default('current') });

// --- DTO de sortie ---

const betPoolResponse = z.object({
    matchId: z.number().int(),
    open: z.boolean(),
    closesAt: z.string().nullable().describe('Horaire prévu du match ; null : pas d\'horaire, paris fermés'),
    pot: z.number().int().describe('Somme des mises'),
    pools: z.array(z.object({ teamId: z.number().int(), total: z.number().int(), bettors: z.number().int() })).describe('Une entrée par équipe connue du match'),
});

const myBetResponse = z.object({
    matchId: z.number().int(),
    teamId: z.number().int(),
    amount: z.number().int(),
    status: z.enum(['pending', 'won', 'lost', 'refunded']),
    payout: z.number().int().nullable().describe('null tant que le match n\'est pas réglé'),
});

const bettorResponse = z.object({
    rank: z.number().int().describe('Ex aequo au même rang'),
    user: z.object({ id: z.number().int(), username: z.string() }),
    net: z.number().int().describe('Gains moins mises, sur les paris réglés'),
    bets: z.number().int().describe('Paris réglés'),
    won: z.number().int(),
});

export function toBetPoolResponse(pool: BetPool): z.infer<typeof betPoolResponse> {
    return {
        matchId: pool.matchId,
        open: pool.open,
        closesAt: pool.closesAt,
        pot: pool.pot,
        pools: pool.pools.map((p) => ({ teamId: p.teamId, total: p.total, bettors: p.bettors })),
    };
}

function toMyBetResponse(bet: Bet): z.infer<typeof myBetResponse> {
    return { matchId: bet.matchId, teamId: bet.teamId, amount: bet.amount, status: bet.status, payout: bet.payout };
}

function toBettorResponse(b: Bettor): z.infer<typeof bettorResponse> {
    return { rank: b.rank, user: { id: b.user.id, username: b.user.username }, net: b.net, bets: b.bets, won: b.won };
}

const TOURNAMENT_NOT_FOUND = { 404: 'Tournoi introuvable (TOURNAMENT_NOT_FOUND)' } as const;

export function betRoutes(bets: BetService): AnyRoute[] {
    return [
        route({
            method: 'get',
            path: '/api/me/wallet',
            tag: 'Paris',
            summary: 'Mon solde d\'Écus et l\'heure du prochain revenu',
            access: 'authenticated',
            response: z.object({ balance: z.number().int(), nextIncomeAt: z.string().nullable().describe('null : solde au plafond (100), pas de revenu') }),
            handle: ({ user }) => bets.wallet(user.id),
        }),
        route({
            method: 'get',
            path: '/api/tournaments/:id/bets',
            tag: 'Paris',
            summary: 'Cagnotte de chaque match du tournoi',
            access: 'public',
            params: idParams,
            response: z.object({ matches: z.array(betPoolResponse) }),
            errors: TOURNAMENT_NOT_FOUND,
            handle: ({ params }) => ({ matches: bets.pools(params.id).map(toBetPoolResponse) }),
        }),
        route({
            method: 'get',
            path: '/api/tournaments/:id/bets/me',
            tag: 'Paris',
            summary: 'Mes paris sur ce tournoi (7 au plus)',
            access: 'authenticated',
            params: idParams,
            response: z.object({ bets: z.array(myBetResponse) }),
            errors: TOURNAMENT_NOT_FOUND,
            handle: ({ params, user }) => ({ bets: bets.mine(params.id, user.id).map(toMyBetResponse) }),
        }),
        route({
            method: 'post',
            path: '/api/matches/:id/bets',
            tag: 'Paris',
            summary: 'Miser sur une équipe du match, jusqu\'à son horaire prévu (pas d\'horaire : fermé)',
            access: 'authenticated',
            params: idParams,
            body: placeBetBody,
            status: 201,
            response: z.object({ bet: myBetResponse, balance: z.number().int() }),
            errors: {
                403: 'Administrateur (ADMIN_CANNOT_BET) ou joueur du tournoi (PLAYER_CANNOT_BET)',
                404: 'Match introuvable (MATCH_NOT_FOUND)',
                409: 'Paris fermés (BETS_CLOSED), déjà parié (ALREADY_BET), solde insuffisant (INSUFFICIENT_FUNDS)',
                422: 'L\'équipe ne joue pas ce match (TEAM_NOT_IN_MATCH)',
            },
            handle: ({ params, body, user }) => {
                const { bet, balance } = bets.place(params.id, user, body.teamId, body.amount);
                return { bet: toMyBetResponse(bet), balance };
            },
        }),
        route({
            method: 'delete',
            path: '/api/matches/:id/bets/me',
            tag: 'Paris',
            summary: 'Annuler mon pari tant que les paris du match sont ouverts : la mise est rendue',
            access: 'authenticated',
            params: idParams,
            response: z.object({ balance: z.number().int() }),
            errors: { 404: 'Match introuvable (MATCH_NOT_FOUND) ou aucun pari (BET_NOT_FOUND)', 409: 'Paris fermés (BETS_CLOSED)' },
            handle: ({ params, user }) => ({ balance: bets.cancel(params.id, user.id).balance }),
        }),
        route({
            method: 'get',
            path: '/api/tournaments/:id/bets/leaderboard',
            tag: 'Paris',
            summary: 'Meilleurs parieurs du tournoi : gain net, puis paris gagnés',
            access: 'public',
            params: idParams,
            query: paginationQuery,
            response: z.object({ leaderboard: z.array(bettorResponse), pagination: paginationSchema }),
            errors: TOURNAMENT_NOT_FOUND,
            handle: ({ params, query }) => {
                const result = bets.tournamentLeaderboard(params.id, query);
                return { leaderboard: result.items.map(toBettorResponse), pagination: toPagination(query, result.total) };
            },
        }),
        route({
            method: 'get',
            path: '/api/bets/leaderboard',
            tag: 'Paris',
            summary: 'Meilleurs parieurs de la semaine, tous tournois (lundi au dimanche, heure de Paris)',
            access: 'public',
            query: weekQuery,
            response: z.object({ from: z.string(), to: z.string(), leaderboard: z.array(bettorResponse), pagination: paginationSchema }),
            handle: ({ query }) => {
                const result = bets.weeklyLeaderboard(query.week, query);
                return { from: result.from, to: result.to, leaderboard: result.items.map(toBettorResponse), pagination: toPagination(query, result.total) };
            },
        }),
    ];
}
