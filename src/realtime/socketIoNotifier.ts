import type { Server } from 'socket.io';
import type { RealtimeNotifier, TournamentDetail } from '../shared/application/realtimeNotifier.js';
import type { Message } from '../features/chat/domain/message.js';
import { toMessageResponse } from '../features/chat/infrastructure/http.js';
import type { Team } from '../features/teams/domain/team.js';
import { toTeamResponse } from '../features/teams/infrastructure/http.js';
import type { Match } from '../features/tournaments/domain/bracket.js';
import { toMatchResponse, toTournamentDetailResponse } from '../features/tournaments/infrastructure/http.js';

export const rooms = {
    tournament: (id: number) => `tournament:${id}`,
    team: (id: number) => `team:${id}`,
    user: (id: number) => `user:${id}`,
};

/**
 * Implémente le port RealtimeNotifier avec Socket.IO. Les charges utiles passent par les mêmes
 * mappers que les réponses HTTP : un client reçoit la même forme par les deux canaux.
 * Sans serveur attaché (tests HTTP, script), les annonces sont ignorées.
 */
export class SocketIoNotifier implements RealtimeNotifier {
    private io?: Server;

    attach(io: Server | undefined): void {
        this.io = io;
    }

    tournamentUpdated(detail: TournamentDetail): void {
        this.io?.to(rooms.tournament(detail.tournament.id)).emit('tournament:updated', toTournamentDetailResponse(detail));
    }

    matchUpdated(match: Match): void {
        this.io?.to(rooms.tournament(match.tournamentId)).emit('match:updated', toMatchResponse(match));
    }

    teamUpdated(team: Team): void {
        this.io?.to(rooms.team(team.id)).emit('team:updated', toTeamResponse(team));
    }

    teamDeleted(teamId: number): void {
        this.io?.to(rooms.team(teamId)).emit('team:deleted', { teamId });
        this.teamChatClosed(teamId);
    }

    memberLeft(teamId: number, userId: number): void {
        this.io?.in(rooms.user(userId)).socketsLeave(rooms.team(teamId));
    }

    memberKicked(teamId: number, userId: number): void {
        this.memberLeft(teamId, userId);
        this.io?.to(rooms.user(userId)).emit('member:kicked', { teamId });
    }

    teamChatClosed(teamId: number): void {
        this.io?.in(rooms.team(teamId)).socketsLeave(rooms.team(teamId));
    }

    messagePosted(message: Message): void {
        this.io?.to(rooms.team(message.teamId)).emit('message:new', toMessageResponse(message));
    }
}
