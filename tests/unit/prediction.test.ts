// Règles des pronostics testées seules : ni base de données, ni serveur
import { describe, expect, it } from 'vitest';
import { assertValidBracket, rankBrackets, scoreOf, type Pick } from '../../src/features/predictions/domain/prediction.js';
import type { Match } from '../../src/features/tournaments/domain/bracket.js';

// Arbre de 7 matchs : quart n oppose les équipes 2n-1 et 2n ; ids 1-4 quarts, 5-6 demies, 7 finale
const matches: Match[] = [
    ...[1, 2, 3, 4].map((p) => ({ id: p, round: 1, position: p, teamAId: 2 * p - 1, teamBId: 2 * p })),
    { id: 5, round: 2, position: 1, teamAId: null, teamBId: null },
    { id: 6, round: 2, position: 2, teamAId: null, teamBId: null },
    { id: 7, round: 3, position: 1, teamAId: null, teamBId: null },
].map((m) => ({ tournamentId: 1, scoreA: null, scoreB: null, winnerId: null, isForfeit: false, status: 'ready' as const, validatedAt: null, scheduledAt: null, ...m }));

// Les équipes impaires gagnent leur quart, 1 et 5 en demie, 1 en finale
const valid: Pick[] = [[1, 1], [2, 3], [3, 5], [4, 7], [5, 1], [6, 5], [7, 1]].map(([matchId, teamId]) => ({ matchId: matchId!, teamId: teamId! }));

const withPick = (matchId: number, teamId: number) => valid.map((p) => (p.matchId === matchId ? { matchId, teamId } : p));

describe('Arbre pronostiqué', () => {
    it('accepte un arbre complet et cohérent', () => {
        expect(() => assertValidBracket(valid, matches)).not.toThrow();
    });

    it('refuse un match manquant, un doublon, une équipe hors du quart ou absente des matchs qui y mènent', () => {
        expect(() => assertValidBracket(valid.slice(1), matches)).toThrow('chacun des 7 matchs');
        expect(() => assertValidBracket([...valid.slice(1), valid[1]!], matches)).toThrow('Un seul pronostic');
        expect(() => assertValidBracket(withPick(1, 3), matches)).toThrow('Match 1');
        expect(() => assertValidBracket(withPick(5, 2), matches)).toThrow('Match 5'); // 2 perd son quart d'après l'arbre
        expect(() => assertValidBracket(withPick(7, 3), matches)).toThrow('Match 7'); // 3 perd sa demie
    });
});

describe('Points et classement', () => {
    const played = matches.map((m) => (m.id === 1 ? { ...m, winnerId: 1 } : m.id === 2 ? { ...m, winnerId: 4 } : m.id === 5 ? { ...m, winnerId: 1 } : m));

    it('1 point par quart, 2 par demie, 4 pour la finale, sur les seuls matchs joués', () => {
        expect(scoreOf(valid, matches)).toEqual({ points: 0, correct: 0 });
        expect(scoreOf(valid, played)).toEqual({ points: 3, correct: 2 });
        const champion = played.map((m) => (m.id === 7 ? { ...m, winnerId: 1 } : m));
        expect(scoreOf(valid, champion)).toEqual({ points: 7, correct: 3 });
    });

    it('trie par points puis bons pronostics, ex aequo au même rang, le premier envoyé d\'abord', () => {
        const bracket = (id: number, picks: Pick[], submittedAt: string) => ({ user: { id, username: `u${id}` }, picks, submittedAt });
        const ranking = rankBrackets(
            [bracket(1, withPick(1, 2), '2026-01-01'), bracket(2, valid, '2026-01-03'), bracket(3, valid, '2026-01-02')],
            played,
        );
        expect(ranking.map((s) => [s.user.id, s.rank, s.points])).toEqual([[3, 1, 3], [2, 1, 3], [1, 3, 2]]);
    });
});
