import type { Page, Paginated } from '../../../shared/application/ports.js';
import type { JoinRequest, JoinRequestStatus, Team } from '../domain/team.js';

export interface TeamRepository {
    /** L'agrégat complet : l'équipe et ses membres. */
    findById(id: number): Team | undefined;
    findByTournament(tournamentId: number, search?: string): Team[];
    countByTournament(tournamentId: number): number;
    findTeamIdOfUser(tournamentId: number, userId: number): number | undefined;
    /** Crée l'équipe avec son capitaine. Lève ConflictError (TEAM_NAME_TAKEN). */
    create(tournamentId: number, name: string, captainId: number): Team;
    /** Lève ConflictError (TEAM_NAME_TAKEN). */
    rename(id: number, name: string): void;
    remove(id: number): void;
    setEliminated(id: number): void;
    addMember(teamId: number, tournamentId: number, userId: number): void;
    removeMember(teamId: number, userId: number): void;
    setMemberRole(teamId: number, userId: number, roleId: number | null): void;
    setCaptain(teamId: number, userId: number): void;
}

export interface JoinRequestRepository {
    findById(id: number): JoinRequest | undefined;
    findPendingByTeam(teamId: number, page: Page): Paginated<JoinRequest>;
    /** Lève ConflictError (REQUEST_ALREADY_PENDING). */
    create(teamId: number, userId: number): JoinRequest;
    setStatus(id: number, status: Exclude<JoinRequestStatus, 'pending'>): void;
    /** Le joueur vient d'entrer dans une équipe : ses autres demandes du tournoi n'ont plus de sens. */
    cancelPendingOfUserInTournament(userId: number, tournamentId: number): void;
    rejectPendingInTournament(tournamentId: number): void;
}
