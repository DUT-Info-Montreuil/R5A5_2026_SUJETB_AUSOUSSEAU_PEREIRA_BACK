import type { Page, Paginated } from '../../../shared/application/ports.js';
import type { Match, MatchPlan, Slot } from '../domain/bracket.js';
import type { Tournament, TournamentStatus } from '../domain/tournament.js';

export interface TournamentRepository {
    search(filters: { search?: string; status?: TournamentStatus }, page: Page): Paginated<Tournament>;
    findById(id: number): Tournament | undefined;
    create(name: string, gameId: number, createdBy: number): Tournament;
    setStatus(id: number, status: Exclude<TournamentStatus, 'registration_open'>): void;
}

export interface MatchRepository {
    findById(id: number): Match | undefined;
    findByTournament(tournamentId: number): Match[];
    findAt(tournamentId: number, round: number, position: number): Match | undefined;
    create(tournamentId: number, plan: MatchPlan): void;
    finish(id: number, result: { winnerId: number; scoreA: number | null; scoreB: number | null; isForfeit: boolean }): void;
    /** Place une équipe ; le match devient jouable quand ses deux équipes sont connues. */
    placeTeam(id: number, slot: Slot, teamId: number): void;
}
