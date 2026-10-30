import type { Page, Paginated } from '../../../shared/application/ports.js';
import type { Match, MatchPlan, Slot } from '../domain/bracket.js';
import type { Tournament, TournamentStatus } from '../domain/tournament.js';

export interface TournamentRepository {
    search(filters: { search?: string; status?: TournamentStatus }, page: Page): Paginated<Tournament>;
    findById(id: number): Tournament | undefined;
    create(name: string, gameId: number, createdBy: number, registrationClosesAt?: string | null): Tournament;
    setStatus(id: number, status: Exclude<TournamentStatus, 'registration_open'>): void;
    setRegistrationClosesAt(id: number, at: string | null): void;
    /** Tournois lancés ou terminés où le joueur a une équipe, les plus récents d'abord. */
    findParticipations(userId: number): Participation[];
}

export interface Participation {
    tournament: Tournament;
    teamId: number;
}

export interface MatchRepository {
    findById(id: number): Match | undefined;
    findByTournament(tournamentId: number): Match[];
    findAt(tournamentId: number, round: number, position: number): Match | undefined;
    create(tournamentId: number, plan: MatchPlan): void;
    finish(id: number, result: { winnerId: number; scoreA: number | null; scoreB: number | null; isForfeit: boolean }): void;
    /** Les matchs de tous les tournois où le joueur a une équipe. */
    findInTournamentsOf(userId: number): Match[];
    schedule(id: number, at: string | null): void;
    /** Place une équipe ; le match devient jouable quand ses deux équipes sont connues. */
    placeTeam(id: number, slot: Slot, teamId: number): void;
}

/** Les paris d'un match se règlent dans la transaction de son résultat, et s'annoncent après le commit. */
export interface BetSettlement {
    /** Renvoie les parieurs du match. */
    settle(matchId: number, winnerId: number): number[];
    announce(tournamentId: number, userIds: number[]): void;
}
