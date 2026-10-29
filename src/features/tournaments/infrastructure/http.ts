import { z } from 'zod';
import type { TournamentDetail } from '../../../shared/application/realtimeNotifier.js';
import { route, type AnyRoute } from '../../../shared/infrastructure/http/routing.js';
import { dateTimeSchema, idParams, idSchema, paginationQuery, paginationSchema, toPagination } from '../../../shared/infrastructure/http/schemas.js';
import type { TeamService } from '../../teams/application/teamService.js';
import { teamResponse, toTeamResponse } from '../../teams/infrastructure/http.js';
import type { MatchService } from '../application/matchService.js';
import type { TournamentService } from '../application/tournamentService.js';
import type { Match } from '../domain/bracket.js';
import { TOURNAMENT_STATUSES, type Tournament } from '../domain/tournament.js';

// --- DTO d'entrée ---

const createTournamentBody = z.strictObject({
    name: z.string().trim().min(3, 'Le nom doit faire au moins 3 caractères').max(100),
    gameId: idSchema,
    registrationClosesAt: dateTimeSchema.nullable().optional().describe('Date de clôture prévue, indicative'),
});

const updateTournamentBody = z.strictObject({ registrationClosesAt: dateTimeSchema.nullable() });

const scheduleMatchBody = z.strictObject({ scheduledAt: dateTimeSchema.nullable().describe('null efface l\'horaire') });

const searchTournamentsQuery = paginationQuery.extend({
    search: z.string().trim().min(1).optional(),
    status: z.enum(TOURNAMENT_STATUSES).optional(),
});

const matchResultBody = z.strictObject({
    scoreA: z.number().int().min(0),
    scoreB: z.number().int().min(0),
});

const forfeitBody = z.strictObject({ teamId: idSchema.describe('L\'équipe qui déclare forfait') });

// --- DTO de sortie ---

const tournamentResponse = z.object({
    id: z.number().int(),
    name: z.string(),
    status: z.enum(TOURNAMENT_STATUSES),
    game: z.object({ id: z.number().int(), name: z.string() }),
    teamCount: z.number().int(),
    createdAt: z.string(),
    registrationClosesAt: z.string().nullable().describe('Clôture prévue, indicative'),
    closedAt: z.string().nullable(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
});

export const matchResponse = z.object({
    id: z.number().int(),
    tournamentId: z.number().int(),
    round: z.number().int().describe('1 = quarts, 2 = demies, 3 = finale'),
    position: z.number().int(),
    teamAId: z.number().int().nullable(),
    teamBId: z.number().int().nullable(),
    scoreA: z.number().int().nullable(),
    scoreB: z.number().int().nullable(),
    winnerId: z.number().int().nullable(),
    isForfeit: z.boolean(),
    status: z.enum(['pending', 'ready', 'finished']),
    validatedAt: z.string().nullable(),
    scheduledAt: z.string().nullable().describe('Horaire prévu'),
});

// Équipes (8 au plus) et matchs (7) sont bornés par nature : on peut les embarquer dans le détail
export const tournamentDetailResponse = tournamentResponse.extend({
    teams: z.array(teamResponse),
    matches: z.array(matchResponse),
});

function toTournamentResponse(t: Tournament): z.infer<typeof tournamentResponse> {
    return {
        id: t.id,
        name: t.name,
        status: t.status,
        game: { id: t.game.id, name: t.game.name },
        teamCount: t.teamCount,
        createdAt: t.createdAt,
        registrationClosesAt: t.registrationClosesAt,
        closedAt: t.closedAt,
        startedAt: t.startedAt,
        finishedAt: t.finishedAt,
    };
}

export function toMatchResponse(m: Match): z.infer<typeof matchResponse> {
    return {
        id: m.id,
        tournamentId: m.tournamentId,
        round: m.round,
        position: m.position,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        scoreA: m.scoreA,
        scoreB: m.scoreB,
        winnerId: m.winnerId,
        isForfeit: m.isForfeit,
        status: m.status,
        validatedAt: m.validatedAt,
        scheduledAt: m.scheduledAt,
    };
}

export function toTournamentDetailResponse(detail: TournamentDetail): z.infer<typeof tournamentDetailResponse> {
    return {
        ...toTournamentResponse(detail.tournament),
        teams: detail.teams.map(toTeamResponse),
        matches: detail.matches.map(toMatchResponse),
    };
}

const detailEnvelope = z.object({ tournament: tournamentDetailResponse });
const matchEnvelope = z.object({ match: matchResponse });
const NOT_FOUND = { 404: 'Tournoi introuvable (TOURNAMENT_NOT_FOUND)' } as const;

const playerStatsResponse = z.object({
    tournaments: z.number().int().describe('Tournois lancés ou terminés où le joueur avait une équipe'),
    matchesPlayed: z.number().int(),
    matchesWon: z.number().int(),
    titles: z.number().int(),
    history: z.array(
        z.object({
            tournament: z.object({ id: z.number().int(), name: z.string(), game: z.object({ id: z.number().int(), name: z.string() }) }),
            finishedAt: z.string(),
            result: z.enum(['champion', 'final', 'semi', 'quarter']),
        }),
    ),
    pagination: paginationSchema.describe('Pagination de history'),
});

// Ici plutôt que dans le HTTP des équipes : il a besoin du DTO tournoi, et l'inverse créerait un import circulaire
function myTeamsRoute(teams: TeamService): AnyRoute {
    return route({
        method: 'get',
        path: '/api/me/teams',
        tag: 'Équipes',
        summary: 'Mes équipes, avec leur tournoi (null hors tournoi), les plus récentes d\'abord',
        access: 'authenticated',
        query: paginationQuery,
        response: z.object({ teams: z.array(teamResponse.extend({ tournament: tournamentResponse.nullable() })), pagination: paginationSchema }),
        handle: ({ query, user }) => {
            const result = teams.listMine(user.id, query);
            return {
                teams: result.items.map(({ team, tournament }) => ({ ...toTeamResponse(team), tournament: tournament && toTournamentResponse(tournament) })),
                pagination: toPagination(query, result.total),
            };
        },
    });
}

export function tournamentRoutes(tournaments: TournamentService, matches: MatchService, teams: TeamService): AnyRoute[] {
    return [
        myTeamsRoute(teams),
        route({
            method: 'get',
            path: '/api/users/:id/stats',
            tag: 'Profil',
            summary: 'Bilan d\'un joueur : tournois, matchs, titres, et historique paginé des tournois terminés',
            access: 'public',
            params: idParams,
            query: paginationQuery,
            response: playerStatsResponse,
            errors: { 404: 'Joueur introuvable (USER_NOT_FOUND)' },
            handle: ({ params, query }) => {
                const { history, ...stats } = tournaments.playerStats(params.id, query);
                return {
                    ...stats,
                    history: history.items.map(({ tournament, result }) => ({
                        tournament: { id: tournament.id, name: tournament.name, game: { id: tournament.game.id, name: tournament.game.name } },
                        finishedAt: tournament.finishedAt!,
                        result,
                    })),
                    pagination: toPagination(query, history.total),
                };
            },
        }),
        route({
            method: 'patch',
            path: '/api/tournaments/:id',
            tag: 'Tournois',
            summary: 'Changer la date de clôture prévue (indicative) pendant les inscriptions',
            access: 'admin',
            params: idParams,
            body: updateTournamentBody,
            response: detailEnvelope,
            errors: { ...NOT_FOUND, 409: 'Inscriptions plus ouvertes (INVALID_TOURNAMENT_STATUS)' },
            handle: ({ params, body }) => ({
                tournament: toTournamentDetailResponse(tournaments.setRegistrationClosesAt(params.id, body.registrationClosesAt)),
            }),
        }),
        route({
            method: 'patch',
            path: '/api/matches/:id',
            tag: 'Matchs',
            summary: 'Fixer (ou effacer avec null) l\'horaire prévu d\'un match',
            access: 'admin',
            params: idParams,
            body: scheduleMatchBody,
            response: matchEnvelope,
            errors: { 404: 'Match introuvable (MATCH_NOT_FOUND)', 409: 'Match déjà joué (MATCH_ALREADY_PLAYED)' },
            handle: ({ params, body }) => ({ match: toMatchResponse(matches.schedule(params.id, body.scheduledAt)) }),
        }),
        route({
            method: 'get',
            path: '/api/tournaments',
            tag: 'Tournois',
            summary: 'Rechercher des tournois par nom et par état (B-02)',
            access: 'public',
            query: searchTournamentsQuery,
            response: z.object({ tournaments: z.array(tournamentResponse), pagination: paginationSchema }),
            handle: ({ query }) => {
                const { search, status, ...page } = query;
                const result = tournaments.search({ search, status }, page);
                return { tournaments: result.items.map(toTournamentResponse), pagination: toPagination(page, result.total) };
            },
        }),
        route({
            method: 'post',
            path: '/api/tournaments',
            tag: 'Tournois',
            summary: 'Créer un tournoi, inscriptions ouvertes (B-01)',
            access: 'admin',
            body: createTournamentBody,
            status: 201,
            response: detailEnvelope,
            errors: { 404: 'Jeu introuvable (GAME_NOT_FOUND)' },
            handle: ({ body, user }) => ({ tournament: toTournamentDetailResponse(tournaments.create(body, user.id)) }),
        }),
        route({
            method: 'get',
            path: '/api/tournaments/:id',
            tag: 'Tournois',
            summary: 'Détail complet : tournoi, équipes avec membres, arbre (B-02, B-19)',
            access: 'public',
            params: idParams,
            response: detailEnvelope,
            errors: NOT_FOUND,
            handle: ({ params }) => ({ tournament: toTournamentDetailResponse(tournaments.getDetail(params.id)) }),
        }),
        route({
            method: 'post',
            path: '/api/tournaments/:id/close',
            tag: 'Tournois',
            summary: 'Clore les inscriptions et tirer l\'arbre au sort (B-03, B-12)',
            access: 'admin',
            params: idParams,
            response: detailEnvelope,
            errors: { ...NOT_FOUND, 409: 'Inscriptions pas ouvertes ou pas exactement 8 équipes (INVALID_TOURNAMENT_STATUS, NOT_ENOUGH_TEAMS)' },
            handle: ({ params }) => ({ tournament: toTournamentDetailResponse(tournaments.close(params.id)) }),
        }),
        route({
            method: 'post',
            path: '/api/tournaments/:id/start',
            tag: 'Tournois',
            summary: 'Lancer le tournoi ; les équipes incomplètes sont forfait au premier match (B-04)',
            access: 'admin',
            params: idParams,
            response: detailEnvelope,
            errors: { ...NOT_FOUND, 409: 'Inscriptions pas encore closes (INVALID_TOURNAMENT_STATUS)' },
            handle: ({ params }) => ({ tournament: toTournamentDetailResponse(tournaments.start(params.id)) }),
        }),
        route({
            method: 'get',
            path: '/api/tournaments/:id/matches',
            tag: 'Tournois',
            summary: 'Arbre du tournoi, vide pendant les inscriptions (B-02, B-19)',
            access: 'public',
            params: idParams,
            response: z.object({ matches: z.array(matchResponse) }),
            errors: NOT_FOUND,
            handle: ({ params }) => ({ matches: tournaments.getMatches(params.id).map(toMatchResponse) }),
        }),
        route({
            method: 'post',
            path: '/api/matches/:id/result',
            tag: 'Matchs',
            summary: 'Saisir le résultat, le gagnant avance (B-13, B-14)',
            access: 'admin',
            params: idParams,
            body: matchResultBody,
            response: matchEnvelope,
            errors: {
                404: 'Match introuvable (MATCH_NOT_FOUND)',
                409: 'Tournoi pas en cours, match déjà joué ou équipes pas encore connues (TOURNAMENT_NOT_IN_PROGRESS, MATCH_ALREADY_PLAYED, MATCH_NOT_READY)',
                422: 'Égalité impossible (MATCH_DRAW_NOT_ALLOWED)',
            },
            handle: ({ params, body }) => ({ match: toMatchResponse(matches.recordResult(params.id, body)) }),
        }),
        route({
            method: 'post',
            path: '/api/matches/:id/forfeit',
            tag: 'Matchs',
            summary: 'Déclarer une équipe forfait, l\'adversaire est qualifié (B-15)',
            access: 'admin',
            params: idParams,
            body: forfeitBody,
            response: matchEnvelope,
            errors: {
                404: 'Match introuvable (MATCH_NOT_FOUND)',
                409: 'Tournoi pas en cours, match déjà joué ou équipes pas encore connues (TOURNAMENT_NOT_IN_PROGRESS, MATCH_ALREADY_PLAYED, MATCH_NOT_READY)',
                422: 'Cette équipe ne joue pas ce match (TEAM_NOT_IN_MATCH)',
            },
            handle: ({ params, body }) => ({ match: toMatchResponse(matches.declareForfeit(params.id, body.teamId)) }),
        }),
    ];
}
