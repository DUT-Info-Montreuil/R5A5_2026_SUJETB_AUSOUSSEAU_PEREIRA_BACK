import type { Message } from '../../features/chat/domain/message.js';
import type { JoinRequest, Team } from '../../features/teams/domain/team.js';
import type { Match } from '../../features/tournaments/domain/bracket.js';
import type { Tournament } from '../../features/tournaments/domain/tournament.js';

export interface TournamentDetail {
    tournament: Tournament;
    teams: Team[];
    matches: Match[];
}

/**
 * Ce que l'application annonce en temps réel. Elle ne sait pas comment c'est transporté :
 * Socket.IO aujourd'hui, SSE demain, sans toucher aux services.
 */
export interface RealtimeNotifier {
    tournamentUpdated(detail: TournamentDetail): void;
    matchUpdated(match: Match): void;
    teamUpdated(team: Team): void;
    teamDeleted(teamId: number): void;
    /** Le joueur a quitté l'équipe : il ne reçoit plus rien de son espace. */
    memberLeft(teamId: number, userId: number): void;
    /** B-17 : le joueur exclu est prévenu et perd immédiatement l'accès à l'espace. */
    memberKicked(teamId: number, userId: number): void;
    /** B-18 : l'équipe est éliminée, plus personne ne reçoit son flux. */
    teamChatClosed(teamId: number): void;
    messagePosted(message: Message): void;
    /** Le capitaine voit arriver la demande sans recharger. */
    joinRequestCreated(request: JoinRequest, captainId: number): void;
    /** L'auteur apprend que sa demande est acceptée, refusée ou annulée. */
    joinRequestUpdated(request: JoinRequest): void;
}
