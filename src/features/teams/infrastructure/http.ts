import { z } from 'zod';
import { route, type AnyRoute } from '../../../shared/infrastructure/http/routing.js';
import { idParams, idSchema, memberParams, paginationQuery, paginationSchema, toPagination } from '../../../shared/infrastructure/http/schemas.js';
import type { JoinRequestService } from '../application/joinRequestService.js';
import type { TeamService } from '../application/teamService.js';
import type { JoinRequest, Team } from '../domain/team.js';

// --- DTO d'entrée ---

const teamNameBody = z.strictObject({
    name: z.string().trim().min(2, 'Le nom doit faire au moins 2 caractères').max(50),
});

const transferCaptaincyBody = z.strictObject({ userId: idSchema });

const setRoleBody = z.strictObject({ roleId: idSchema.nullable() });

const searchTeamsQuery = z.object({ search: z.string().trim().min(1).optional() });

// --- DTO de sortie : pseudo et rôle des membres, jamais l'email ---

export const teamResponse = z.object({
    id: z.number().int(),
    tournamentId: z.number().int(),
    name: z.string(),
    isEliminated: z.boolean(),
    createdAt: z.string(),
    members: z.array(
        z.object({
            userId: z.number().int(),
            username: z.string(),
            role: z.object({ id: z.number().int(), name: z.string() }).nullable(),
            isCaptain: z.boolean(),
            joinedAt: z.string(),
        }),
    ),
});

export function toTeamResponse(team: Team): z.infer<typeof teamResponse> {
    return {
        id: team.id,
        tournamentId: team.tournamentId,
        name: team.name,
        isEliminated: team.isEliminated,
        createdAt: team.createdAt,
        members: team.members.map((m) => ({
            userId: m.userId,
            username: m.username,
            role: m.role && { id: m.role.id, name: m.role.name },
            isCaptain: m.isCaptain,
            joinedAt: m.joinedAt,
        })),
    };
}

const joinRequestResponse = z.object({
    id: z.number().int(),
    teamId: z.number().int(),
    user: z.object({ id: z.number().int(), username: z.string() }),
    status: z.enum(['pending', 'accepted', 'rejected', 'cancelled']),
    createdAt: z.string(),
    decidedAt: z.string().nullable(),
});

function toJoinRequestResponse(request: JoinRequest): z.infer<typeof joinRequestResponse> {
    return {
        id: request.id,
        teamId: request.teamId,
        user: { id: request.user.id, username: request.user.username },
        status: request.status,
        createdAt: request.createdAt,
        decidedAt: request.decidedAt,
    };
}

const teamEnvelope = z.object({ team: teamResponse });
const joinRequestEnvelope = z.object({ joinRequest: joinRequestResponse });

const CAPTAIN_ERRORS = {
    403: 'Pas membre de l\'équipe (NOT_TEAM_MEMBER) ou pas capitaine (NOT_CAPTAIN)',
    404: 'Équipe introuvable (TEAM_NOT_FOUND)',
    409: 'Inscriptions closes (REGISTRATION_CLOSED)',
} as const;

export function teamRoutes(teams: TeamService, joinRequests: JoinRequestService): AnyRoute[] {
    return [
        route({
            method: 'get',
            path: '/api/tournaments/:id/teams',
            tag: 'Équipes',
            summary: 'Chercher une équipe dans un tournoi (B-06). Au plus 8 équipes : pas de pagination',
            access: 'public',
            params: idParams,
            query: searchTeamsQuery,
            response: z.object({ teams: z.array(teamResponse) }),
            errors: { 404: 'Tournoi introuvable (TOURNAMENT_NOT_FOUND)' },
            handle: ({ params, query }) => ({ teams: teams.listByTournament(params.id, query.search).map(toTeamResponse) }),
        }),
        route({
            method: 'post',
            path: '/api/tournaments/:id/teams',
            tag: 'Équipes',
            summary: 'Créer une équipe et en devenir capitaine (B-05, B-07)',
            access: 'authenticated',
            params: idParams,
            body: teamNameBody,
            status: 201,
            response: teamEnvelope,
            errors: {
                404: 'Tournoi introuvable (TOURNAMENT_NOT_FOUND)',
                409: 'Inscriptions closes, déjà dans une équipe, tournoi complet ou nom pris (REGISTRATION_CLOSED, ALREADY_IN_TEAM, TOURNAMENT_FULL, TEAM_NAME_TAKEN)',
            },
            handle: ({ params, body, user }) => ({ team: toTeamResponse(teams.create(params.id, user.id, body.name)) }),
        }),
        route({
            method: 'get',
            path: '/api/teams/:id',
            tag: 'Équipes',
            summary: 'Détail d\'une équipe',
            access: 'public',
            params: idParams,
            response: teamEnvelope,
            errors: { 404: 'Équipe introuvable (TEAM_NOT_FOUND)' },
            handle: ({ params }) => ({ team: toTeamResponse(teams.get(params.id)) }),
        }),
        route({
            method: 'patch',
            path: '/api/teams/:id',
            tag: 'Équipes',
            summary: 'Renommer l\'équipe (B-09)',
            access: 'authenticated',
            params: idParams,
            body: teamNameBody,
            response: teamEnvelope,
            errors: { ...CAPTAIN_ERRORS, 409: 'Inscriptions closes ou nom pris (REGISTRATION_CLOSED, TEAM_NAME_TAKEN)' },
            handle: ({ params, body, user }) => ({ team: toTeamResponse(teams.rename(params.id, user.id, body.name)) }),
        }),
        route({
            method: 'delete',
            path: '/api/teams/:id',
            tag: 'Équipes',
            summary: 'Supprimer l\'équipe : membres, demandes et messages en cascade (B-10)',
            access: 'authenticated',
            params: idParams,
            status: 204,
            errors: CAPTAIN_ERRORS,
            handle: ({ params, user }) => teams.remove(params.id, user.id),
        }),
        route({
            method: 'post',
            path: '/api/teams/:id/transfer-captaincy',
            tag: 'Équipes',
            summary: 'Passer le capitanat à un membre (B-09)',
            access: 'authenticated',
            params: idParams,
            body: transferCaptaincyBody,
            response: teamEnvelope,
            errors: { ...CAPTAIN_ERRORS, 404: 'Équipe ou membre introuvable (TEAM_NOT_FOUND, MEMBER_NOT_FOUND)' },
            handle: ({ params, body, user }) => ({ team: toTeamResponse(teams.transferCaptaincy(params.id, user.id, body.userId)) }),
        }),
        // Déclarée avant /members/:userId, sinon "me" serait pris pour un identifiant
        route({
            method: 'delete',
            path: '/api/teams/:id/members/me',
            tag: 'Équipes',
            summary: 'Quitter l\'équipe ; si le capitaine part, le membre le plus ancien reprend (B-06)',
            access: 'authenticated',
            params: idParams,
            status: 204,
            errors: {
                403: 'Pas membre de l\'équipe (NOT_TEAM_MEMBER)',
                404: 'Équipe introuvable (TEAM_NOT_FOUND)',
                409: 'Inscriptions closes (REGISTRATION_CLOSED)',
            },
            handle: ({ params, user }) => teams.leave(params.id, user.id),
        }),
        route({
            method: 'patch',
            path: '/api/teams/:id/members/:userId',
            tag: 'Équipes',
            summary: 'Attribuer (ou retirer avec null) un rôle de jeu (B-08, B-09)',
            access: 'authenticated',
            params: memberParams,
            body: setRoleBody,
            response: teamEnvelope,
            errors: {
                ...CAPTAIN_ERRORS,
                404: 'Équipe ou membre introuvable (TEAM_NOT_FOUND, MEMBER_NOT_FOUND)',
                422: 'Rôle d\'un autre jeu (INVALID_ROLE)',
            },
            handle: ({ params, body, user }) => ({
                team: toTeamResponse(teams.setMemberRole(params.id, user.id, params.userId, body.roleId)),
            }),
        }),
        route({
            method: 'delete',
            path: '/api/teams/:id/members/:userId',
            tag: 'Équipes',
            summary: 'Exclure un membre : il perd immédiatement l\'accès au chat (B-09, B-17)',
            access: 'authenticated',
            params: memberParams,
            response: teamEnvelope,
            errors: {
                ...CAPTAIN_ERRORS,
                404: 'Équipe ou membre introuvable (TEAM_NOT_FOUND, MEMBER_NOT_FOUND)',
                422: 'Le capitaine ne peut pas s\'exclure (CANNOT_KICK_SELF)',
            },
            handle: ({ params, user }) => ({ team: toTeamResponse(teams.kick(params.id, user.id, params.userId)) }),
        }),
        route({
            method: 'post',
            path: '/api/teams/:id/join-requests',
            tag: 'Demandes d\'adhésion',
            summary: 'Demander à rejoindre une équipe (B-06, B-07)',
            access: 'authenticated',
            params: idParams,
            status: 201,
            response: joinRequestEnvelope,
            errors: {
                404: 'Équipe introuvable (TEAM_NOT_FOUND)',
                409: 'Inscriptions closes, déjà dans une équipe, équipe complète ou demande déjà en attente (REGISTRATION_CLOSED, ALREADY_IN_TEAM, TEAM_FULL, REQUEST_ALREADY_PENDING)',
            },
            handle: ({ params, user }) => ({ joinRequest: toJoinRequestResponse(joinRequests.create(params.id, user.id)) }),
        }),
        route({
            method: 'get',
            path: '/api/teams/:id/join-requests',
            tag: 'Demandes d\'adhésion',
            summary: 'Demandes en attente, réservées au capitaine (B-10)',
            access: 'authenticated',
            params: idParams,
            query: paginationQuery,
            response: z.object({ joinRequests: z.array(joinRequestResponse), pagination: paginationSchema }),
            errors: { 403: CAPTAIN_ERRORS[403], 404: CAPTAIN_ERRORS[404] },
            handle: ({ params, query, user }) => {
                const page = joinRequests.listPending(params.id, user.id, query);
                return { joinRequests: page.items.map(toJoinRequestResponse), pagination: toPagination(query, page.total) };
            },
        }),
        route({
            method: 'post',
            path: '/api/join-requests/:id/accept',
            tag: 'Demandes d\'adhésion',
            summary: 'Accepter une demande, refusé si l\'équipe a déjà 5 membres (B-08, B-10)',
            access: 'authenticated',
            params: idParams,
            response: joinRequestEnvelope,
            errors: {
                403: CAPTAIN_ERRORS[403],
                404: 'Demande introuvable (JOIN_REQUEST_NOT_FOUND)',
                409: 'Inscriptions closes, demande déjà traitée, joueur déjà dans une équipe ou équipe complète (REGISTRATION_CLOSED, REQUEST_NOT_PENDING, ALREADY_IN_TEAM, TEAM_FULL)',
            },
            handle: ({ params, user }) => ({ joinRequest: toJoinRequestResponse(joinRequests.accept(params.id, user.id)) }),
        }),
        route({
            method: 'post',
            path: '/api/join-requests/:id/reject',
            tag: 'Demandes d\'adhésion',
            summary: 'Refuser une demande (B-10)',
            access: 'authenticated',
            params: idParams,
            response: joinRequestEnvelope,
            errors: {
                403: CAPTAIN_ERRORS[403],
                404: 'Demande introuvable (JOIN_REQUEST_NOT_FOUND)',
                409: 'Inscriptions closes ou demande déjà traitée (REGISTRATION_CLOSED, REQUEST_NOT_PENDING)',
            },
            handle: ({ params, user }) => ({ joinRequest: toJoinRequestResponse(joinRequests.reject(params.id, user.id)) }),
        }),
        route({
            method: 'delete',
            path: '/api/join-requests/:id',
            tag: 'Demandes d\'adhésion',
            summary: 'Annuler sa propre demande',
            access: 'authenticated',
            params: idParams,
            status: 204,
            errors: {
                403: 'Seul l\'auteur peut annuler (NOT_REQUEST_AUTHOR)',
                404: 'Demande introuvable (JOIN_REQUEST_NOT_FOUND)',
                409: 'Demande déjà traitée (REQUEST_NOT_PENDING)',
            },
            handle: ({ params, user }) => joinRequests.cancel(params.id, user.id),
        }),
    ];
}
