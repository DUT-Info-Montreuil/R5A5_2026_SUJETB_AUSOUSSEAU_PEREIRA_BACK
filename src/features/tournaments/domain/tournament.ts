import { ConflictError } from '../../../shared/domain/errors.js';

export const TOURNAMENT_STATUSES = ['registration_open', 'registration_closed', 'in_progress', 'finished'] as const;

export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

export interface Tournament {
    id: number;
    name: string;
    status: TournamentStatus;
    game: { id: number; name: string };
    teamCount: number;
    createdBy: number;
    createdAt: string;
    registrationClosesAt: string | null;
    closedAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
}

/** B-11 : une fois les inscriptions closes, plus rien ne bouge dans les équipes. */
export function assertRegistrationOpen(tournament: Tournament): void {
    if (tournament.status !== 'registration_open') {
        throw new ConflictError('REGISTRATION_CLOSED', 'Les inscriptions de ce tournoi ne sont plus ouvertes');
    }
}

/** Hors tournoi, une équipe se gère comme dans un tournoi aux inscriptions ouvertes. */
export function assertTeamEditable(tournament: Tournament | null): void {
    if (tournament) assertRegistrationOpen(tournament);
}

export function assertStatus(tournament: Tournament, expected: TournamentStatus, message: string): void {
    if (tournament.status !== expected) throw new ConflictError('INVALID_TOURNAMENT_STATUS', message);
}
