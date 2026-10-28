import type { Page, Paginated } from '../../../shared/application/ports.js';
import type { JoinRequest, JoinRequestStatus, Team, TeamVisibility } from '../domain/team.js';

export interface TeamRepository {
    /** L'agrégat complet : l'équipe et ses membres. */
    findById(id: number): Team | undefined;
    findByTournament(tournamentId: number, search?: string): Team[];
    /** Les équipes du joueur, tous tournois confondus, les plus récentes d'abord. */
    findByUser(userId: number, page: Page): Paginated<Team>;
    countByTournament(tournamentId: number): number;
    findTeamIdOfUser(tournamentId: number, userId: number): number | undefined;
    /** Crée l'équipe avec son capitaine. Lève ConflictError (TEAM_NAME_TAKEN). */
    create(tournamentId: number, name: string, captainId: number): Team;
    /** Lève ConflictError (TEAM_NAME_TAKEN). */
    rename(id: number, name: string): void;
    setVisibility(id: number, visibility: TeamVisibility): void;
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
    /** Les demandes du joueur, les plus récentes d'abord. */
    findByUser(userId: number, status: JoinRequestStatus | undefined, page: Page): Paginated<JoinRequest>;
    /** Lève ConflictError (REQUEST_ALREADY_PENDING). */
    create(teamId: number, userId: number): JoinRequest;
    setStatus(id: number, status: Exclude<JoinRequestStatus, 'pending'>): void;
    /** Le joueur vient d'entrer dans une équipe : ses autres demandes du tournoi n'ont plus de sens. Renvoie les demandes touchées. */
    cancelPendingOfUserInTournament(userId: number, tournamentId: number): JoinRequest[];
    /** Renvoie les demandes touchées. */
    rejectPendingInTournament(tournamentId: number): JoinRequest[];
}
