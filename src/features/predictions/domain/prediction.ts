// Pronostics des spectateurs : un arbre complet, rempli entre la clôture et le lancement
import { AccessDeniedError, ConflictError, RuleViolationError } from '../../../shared/domain/errors.js';
import type { Match } from '../../tournaments/domain/bracket.js';
import type { Tournament } from '../../tournaments/domain/tournament.js';

/** Le vainqueur annoncé d'un match. */
export interface Pick {
    matchId: number;
    teamId: number;
}

export interface Bracket {
    user: { id: number; username: string };
    picks: Pick[];
    submittedAt: string;
}

export interface Score {
    points: number;
    correct: number;
}

export interface Standing extends Score {
    rank: number;
    user: { id: number; username: string };
}

/** Un bon pronostic rapporte plus à chaque tour : 4 quarts + 2 demies + 1 finale = 12 points au plus. */
export const POINTS_BY_ROUND: Record<number, number> = { 1: 1, 2: 2, 3: 4 };

/**
 * L'arbre est connu à la clôture et figé au lancement : on ne pronostique qu'entre les deux,
 * donc jamais en connaissant un résultat. Un joueur du tournoi ne pronostique pas (conflit d'intérêts).
 */
export function assertCanPredict(tournament: Tournament, isPlayer: boolean): void {
    if (isPlayer) throw new AccessDeniedError('PLAYER_CANNOT_PREDICT', 'Les joueurs du tournoi ne peuvent pas pronostiquer');
    if (tournament.status !== 'registration_closed') {
        throw new ConflictError('PREDICTIONS_CLOSED', 'Les pronostics s\'ouvrent à la clôture des inscriptions et se ferment au lancement');
    }
}

/**
 * Un pronostic par match, et un arbre cohérent : en quart, une des deux équipes du match ;
 * ensuite, une équipe qu'on a fait gagner dans l'un des deux matchs qui y mènent.
 */
export function assertValidBracket(picks: Pick[], matches: Match[]): void {
    const invalid = (message: string) => new RuleViolationError('INVALID_PREDICTION', message);
    const byMatch = new Map(picks.map((p) => [p.matchId, p.teamId]));
    if (byMatch.size !== picks.length) throw invalid('Un seul pronostic par match');
    if (picks.length !== matches.length || matches.some((m) => !byMatch.has(m.id))) {
        throw invalid(`Il faut un pronostic pour chacun des ${matches.length} matchs du tournoi`);
    }
    const pickAt = (round: number, position: number) =>
        byMatch.get(matches.find((m) => m.round === round && m.position === position)!.id);
    for (const match of matches) {
        const teamId = byMatch.get(match.id)!;
        const allowed =
            match.round === 1
                ? [match.teamAId, match.teamBId]
                : [pickAt(match.round - 1, 2 * match.position - 1), pickAt(match.round - 1, 2 * match.position)];
        if (!allowed.includes(teamId)) {
            throw invalid(`Match ${match.id} : l'équipe ${teamId} ne peut pas y arriver d'après ce pronostic`);
        }
    }
}

/** Les points se calculent sur les matchs joués : un forfait qualifie le vainqueur comme un score. */
export function scoreOf(picks: Pick[], matches: Match[]): Score {
    let points = 0;
    let correct = 0;
    for (const match of matches) {
        if (match.winnerId === null) continue;
        if (picks.some((p) => p.matchId === match.id && p.teamId === match.winnerId)) {
            points += POINTS_BY_ROUND[match.round]!;
            correct++;
        }
    }
    return { points, correct };
}

/** Classement : points, puis bons pronostics ; ex aequo au même rang, le premier inscrit affiché d'abord. */
export function rankBrackets(brackets: Bracket[], matches: Match[]): Standing[] {
    const scored = brackets
        .map((b) => ({ ...b, ...scoreOf(b.picks, matches) }))
        .sort((x, y) => y.points - x.points || y.correct - x.correct || x.submittedAt.localeCompare(y.submittedAt));
    return scored.map((s) => ({
        rank: 1 + scored.filter((o) => o.points > s.points || (o.points === s.points && o.correct > s.correct)).length,
        user: s.user,
        points: s.points,
        correct: s.correct,
    }));
}
