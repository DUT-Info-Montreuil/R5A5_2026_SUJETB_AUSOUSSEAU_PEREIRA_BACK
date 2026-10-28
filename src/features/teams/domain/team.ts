// Agrégat Team : l'équipe et ses membres (5 au plus), avec les règles qui les concernent
import { AccessDeniedError, ConflictError, NotFoundError, RuleViolationError } from '../../../shared/domain/errors.js';

export const TEAM_SIZE = 5;

export interface TeamMember {
    userId: number;
    username: string;
    role: { id: number; name: string } | null;
    isCaptain: boolean;
    joinedAt: string;
}

export const TEAM_VISIBILITIES = ['open', 'private'] as const;

export type TeamVisibility = (typeof TEAM_VISIBILITIES)[number];

export interface Team {
    id: number;
    tournamentId: number;
    name: string;
    isEliminated: boolean;
    /** Une équipe privée ne reçoit plus de demandes d'adhésion. */
    visibility: TeamVisibility;
    createdAt: string;
    members: TeamMember[];
}

export type JoinRequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

export interface JoinRequest {
    id: number;
    teamId: number;
    teamName: string;
    tournamentId: number;
    user: { id: number; username: string };
    status: JoinRequestStatus;
    createdAt: string;
    decidedAt: string | null;
}

export function findMember(team: Team, userId: number): TeamMember | undefined {
    return team.members.find((m) => m.userId === userId);
}

/** B-10 : personne n'agit sur une équipe dont il n'est pas membre. */
export function assertMember(team: Team, userId: number): TeamMember {
    const member = findMember(team, userId);
    if (!member) throw new AccessDeniedError('NOT_TEAM_MEMBER', 'Vous n\'êtes pas membre de cette équipe');
    return member;
}

/** B-10 : seul le capitaine touche à la composition. */
export function assertCaptain(team: Team, userId: number): void {
    if (!assertMember(team, userId).isCaptain) {
        throw new AccessDeniedError('NOT_CAPTAIN', 'Action réservée au capitaine de l\'équipe');
    }
}

export function assertTargetMember(team: Team, userId: number): TeamMember {
    const member = findMember(team, userId);
    if (!member) throw new NotFoundError('MEMBER_NOT_FOUND', 'Ce joueur n\'est pas membre de l\'équipe');
    return member;
}

export function assertCanKick(team: Team, captainId: number, targetUserId: number): void {
    if (targetUserId === captainId) {
        throw new RuleViolationError('CANNOT_KICK_SELF', 'Le capitaine ne peut pas s\'exclure : il doit quitter l\'équipe');
    }
    assertTargetMember(team, targetUserId);
}

/** B-08 : cinq joueurs au plus, capitaine compris. */
export function assertNotFull(team: Team): void {
    if (team.members.length >= TEAM_SIZE) {
        throw new ConflictError('TEAM_FULL', `L'équipe est complète (${TEAM_SIZE} joueurs)`);
    }
}

export function assertOpenToRequests(team: Team): void {
    if (team.visibility === 'private') {
        throw new ConflictError('TEAM_PRIVATE', 'Cette équipe n\'accepte pas de demandes d\'adhésion');
    }
}

export function captainOf(team: Team): TeamMember | undefined {
    return team.members.find((m) => m.isCaptain);
}

/** B-04 + B-08 : une équipe au complet a cinq joueurs, chacun avec un rôle de jeu. */
export function isComplete(team: Team): boolean {
    return team.members.length >= TEAM_SIZE && team.members.every((m) => m.role !== null);
}

/** Si le capitaine part : le membre arrivé le plus tôt reprend (départage par identifiant). */
export function successorOf(team: Team, leavingUserId: number): TeamMember | undefined {
    return team.members
        .filter((m) => m.userId !== leavingUserId)
        .sort((x, y) => x.joinedAt.localeCompare(y.joinedAt) || x.userId - y.userId)[0];
}

/** B-18 : l'espace d'une équipe éliminée est fermé. */
export function assertChatOpen(team: Team): void {
    if (team.isEliminated) {
        throw new ConflictError('TEAM_CHAT_CLOSED', 'L\'équipe est éliminée : son espace d\'échange est fermé');
    }
}

export function assertPending(request: JoinRequest): void {
    if (request.status !== 'pending') throw new ConflictError('REQUEST_NOT_PENDING', 'Cette demande a déjà été traitée');
}
