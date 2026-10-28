// Domain service : les règles de l'arbre à élimination directe (8 équipes, 3 tours)
import { ConflictError, RuleViolationError } from '../../../shared/domain/errors.js';
import type { Tournament } from './tournament.js';

export type MatchStatus = 'pending' | 'ready' | 'finished';

export interface Match {
    id: number;
    tournamentId: number;
    round: number; // 1 = quarts, 2 = demies, 3 = finale
    position: number;
    teamAId: number | null;
    teamBId: number | null;
    scoreA: number | null;
    scoreB: number | null;
    winnerId: number | null;
    isForfeit: boolean;
    status: MatchStatus;
    validatedAt: string | null;
}

export interface MatchPlan {
    round: number;
    position: number;
    teamAId: number | null;
    teamBId: number | null;
}

export type Slot = 'a' | 'b';

export const BRACKET_SIZE = 8;
export const FINAL_ROUND = 3;

/**
 * B-12 : tire au sort les 4 quarts parmi exactement 8 équipes ; demies et finale restent vides.
 * `randomInt(n)` renvoie un entier dans [0, n) : injecté pour que le tirage soit testable.
 */
export function planBracket(teamIds: number[], randomInt: (maxExclusive: number) => number): MatchPlan[] {
    if (teamIds.length !== BRACKET_SIZE) {
        throw new ConflictError('NOT_ENOUGH_TEAMS', `Il faut exactement ${BRACKET_SIZE} équipes (actuellement ${teamIds.length})`);
    }
    const drawn = [...teamIds];
    for (let i = drawn.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [drawn[i], drawn[j]] = [drawn[j]!, drawn[i]!];
    }
    const quarters = [1, 2, 3, 4].map((position) => ({
        round: 1,
        position,
        teamAId: drawn[2 * position - 2]!,
        teamBId: drawn[2 * position - 1]!,
    }));
    const empty = (round: number, position: number) => ({ round, position, teamAId: null, teamBId: null });
    return [...quarters, empty(2, 1), empty(2, 2), empty(FINAL_ROUND, 1)];
}

/** B-14 : un résultat ne se saisit que sur un tournoi en cours, pour un match dont les deux équipes sont connues. */
export function assertPlayable(match: Match, tournament: Tournament): void {
    if (tournament.status !== 'in_progress') {
        throw new ConflictError('TOURNAMENT_NOT_IN_PROGRESS', 'Le tournoi n\'est pas en cours');
    }
    if (match.status === 'finished') throw new ConflictError('MATCH_ALREADY_PLAYED', 'Ce match a déjà un résultat');
    if (match.status !== 'ready') {
        throw new ConflictError('MATCH_NOT_READY', 'Les deux équipes de ce match ne sont pas encore connues');
    }
}

export function winnerByScore(match: Match, scoreA: number, scoreB: number): number {
    if (scoreA === scoreB) {
        throw new RuleViolationError('MATCH_DRAW_NOT_ALLOWED', 'Un match à élimination directe ne peut pas finir sur une égalité');
    }
    return scoreA > scoreB ? match.teamAId! : match.teamBId!;
}

/** B-15 : l'adversaire de l'équipe qui déclare forfait. */
export function opponentOf(match: Match, teamId: number): number {
    if (teamId === match.teamAId) return match.teamBId!;
    if (teamId === match.teamBId) return match.teamAId!;
    throw new RuleViolationError('TEAM_NOT_IN_MATCH', 'Cette équipe ne joue pas ce match');
}

export function loserOf(match: Match, winnerId: number): number {
    return winnerId === match.teamAId ? match.teamBId! : match.teamAId!;
}

/** Le gagnant du match n du tour r joue le match ceil(n/2) du tour r+1, côté A si n est impair. */
export function nextMatchSlot(match: Match): { round: number; position: number; slot: Slot } | null {
    if (match.round === FINAL_ROUND) return null;
    return { round: match.round + 1, position: Math.ceil(match.position / 2), slot: match.position % 2 === 1 ? 'a' : 'b' };
}

/**
 * B-04 : au lancement, une équipe incomplète perd son premier match par forfait.
 * Renvoie le vainqueur, ou null si les deux équipes sont complètes et que le match se joue.
 */
export function startForfeitWinner(match: Match, sizeA: number, sizeB: number, teamSize: number): number | null {
    const a = match.teamAId!;
    const b = match.teamBId!;
    if (sizeA >= teamSize && sizeB >= teamSize) return null;
    if (sizeA >= teamSize) return a;
    if (sizeB >= teamSize) return b;
    // shortcut: les deux sont incomplètes, la plus fournie passe (égalité : la plus ancienne).
    // Le sujet ne tranche pas ce cas, règle à faire valider par le commanditaire.
    return sizeA > sizeB || (sizeA === sizeB && a < b) ? a : b;
}
