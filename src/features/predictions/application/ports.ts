import type { Bracket, Pick } from '../domain/prediction.js';

export interface PredictionRepository {
    /** Les pronostics du spectateur pour ce tournoi (vide s'il n'a rien envoyé). */
    findPicks(tournamentId: number, userId: number): Pick[];
    /** Tous les arbres pronostiqués du tournoi, du plus ancien au plus récent. */
    findBrackets(tournamentId: number): Bracket[];
    /** Remplace l'arbre du spectateur : à appeler dans une transaction. */
    replace(tournamentId: number, userId: number, picks: Pick[]): void;
}

/** Ce que pense le public : combien de spectateurs voient chaque équipe gagner chaque match. */
export interface PredictionSummary {
    tournamentId: number;
    participants: number;
    matches: { matchId: number; picks: { teamId: number; count: number }[] }[];
}
