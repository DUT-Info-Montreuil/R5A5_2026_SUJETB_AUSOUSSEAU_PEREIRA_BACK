// Règles métier testées seules : ni base de données, ni serveur
import { describe, expect, it } from 'vitest';
import { isComplete, successorOf, type Team, type TeamMember } from '../../src/features/teams/domain/team.js';
import {
    nextMatchSlot,
    opponentOf,
    planBracket,
    resultOf,
    startForfeitWinner,
    winnerByScore,
    type Match,
} from '../../src/features/tournaments/domain/bracket.js';
import { MemoryLoginThrottle } from '../../src/features/users/infrastructure/security.js';
import { ConflictError, RuleViolationError, TooManyAttemptsError } from '../../src/shared/domain/errors.js';

function match(overrides: Partial<Match> = {}): Match {
    return {
        id: 1, tournamentId: 1, round: 1, position: 1, teamAId: 10, teamBId: 20,
        scoreA: null, scoreB: null, winnerId: null, isForfeit: false, status: 'ready', validatedAt: null, scheduledAt: null,
        ...overrides,
    };
}

function member(userId: number, joinedAt: string, withRole = true): TeamMember {
    return { userId, username: `u${userId}`, role: withRole ? { id: 1, name: 'Mid' } : null, isCaptain: false, joinedAt };
}

function team(members: TeamMember[]): Team {
    return { id: 1, tournamentId: 1, game: { id: 1, name: 'Jeu' }, name: 'Equipe', isEliminated: false, visibility: 'open', createdAt: '', members };
}

describe('Arbre (B-12, B-14)', () => {
    it('place les 8 équipes en 4 quarts, demies et finale vides', () => {
        const plan = planBracket([1, 2, 3, 4, 5, 6, 7, 8], () => 0);
        expect(plan).toHaveLength(7);
        expect(plan.filter((m) => m.round === 1).flatMap((m) => [m.teamAId, m.teamBId]).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(plan.filter((m) => m.round > 1).every((m) => m.teamAId === null && m.teamBId === null)).toBe(true);
    });

    it('refuse un nombre d\'équipes différent de 8', () => {
        expect(() => planBracket([1, 2, 3], () => 0)).toThrow(ConflictError);
    });

    it('envoie le gagnant du match n au match ceil(n/2), côté A si n est impair ; rien après la finale', () => {
        expect(nextMatchSlot(match({ round: 1, position: 3 }))).toEqual({ round: 2, position: 2, slot: 'a' });
        expect(nextMatchSlot(match({ round: 1, position: 4 }))).toEqual({ round: 2, position: 2, slot: 'b' });
        expect(nextMatchSlot(match({ round: 3, position: 1 }))).toBeNull();
    });

    it('désigne le vainqueur au score, refuse l\'égalité', () => {
        expect(winnerByScore(match(), 2, 1)).toBe(10);
        expect(winnerByScore(match(), 0, 3)).toBe(20);
        expect(() => winnerByScore(match(), 1, 1)).toThrow(RuleViolationError);
    });

    it('qualifie l\'adversaire d\'un forfait, refuse une équipe hors du match (B-15)', () => {
        expect(opponentOf(match(), 10)).toBe(20);
        expect(() => opponentOf(match(), 99)).toThrow(RuleViolationError);
    });
});

describe('Forfait au lancement (B-04)', () => {
    it('ne décide rien si les deux équipes sont complètes', () => {
        expect(startForfeitWinner(match(), 5, 5, 5)).toBeNull();
    });

    it('qualifie l\'équipe complète face à une incomplète', () => {
        expect(startForfeitWinner(match(), 4, 5, 5)).toBe(20);
        expect(startForfeitWinner(match(), 5, 2, 5)).toBe(10);
    });

    it('deux incomplètes : la plus fournie, puis la plus ancienne', () => {
        expect(startForfeitWinner(match(), 3, 4, 5)).toBe(20);
        expect(startForfeitWinner(match(), 3, 3, 5)).toBe(10);
    });
});

describe('Équipe (B-06, B-08)', () => {
    it('est complète avec 5 joueurs ayant tous un rôle', () => {
        const five = [1, 2, 3, 4, 5].map((id) => member(id, `2026-01-0${id}`));
        expect(isComplete(team(five))).toBe(true);
        expect(isComplete(team(five.slice(0, 4)))).toBe(false);
        expect(isComplete(team([...five.slice(0, 4), member(5, '2026-01-05', false)]))).toBe(false);
    });

    it('le successeur du capitaine est le membre arrivé le plus tôt, départagé par identifiant', () => {
        const members = [member(1, '2026-01-01'), member(7, '2026-01-02'), member(3, '2026-01-02')];
        expect(successorOf(team(members), 1)?.userId).toBe(3);
        expect(successorOf(team([member(1, '2026-01-01')]), 1)).toBeUndefined();
    });
});

describe('Freinage des connexions par compte', () => {
    it('le délai double après chaque échec et repart à zéro après un succès', () => {
        let now = 0;
        const throttle = new MemoryLoginThrottle(() => now);
        throttle.assertAllowed('alice@example.com');

        throttle.recordFailure('alice@example.com');
        expect(() => throttle.assertAllowed('alice@example.com')).toThrow(TooManyAttemptsError);
        now = 1000;
        throttle.assertAllowed('ALICE@example.com');

        throttle.recordFailure('alice@example.com');
        now = 2500;
        expect(() => throttle.assertAllowed('alice@example.com')).toThrow(TooManyAttemptsError);
        now = 3000;
        throttle.assertAllowed('alice@example.com');

        throttle.reset('alice@example.com');
        throttle.recordFailure('alice@example.com');
        now = 4000;
        throttle.assertAllowed('alice@example.com');
    });
});

describe('Résultat d\'une équipe dans un tournoi terminé (profil)', () => {
    const quarter = match({ id: 1, round: 1, teamAId: 10, teamBId: 20, winnerId: 10, status: 'finished' });
    const semi = match({ id: 2, round: 2, teamAId: 10, teamBId: 30, winnerId: 10, status: 'finished' });
    const final = match({ id: 3, round: 3, teamAId: 10, teamBId: 40, winnerId: 40, status: 'finished' });

    it('le dernier match joué donne le tour atteint', () => {
        expect(resultOf([quarter, semi, final], 20)).toBe('quarter');
        expect(resultOf([quarter, semi, final], 30)).toBe('semi');
        expect(resultOf([quarter, semi, final], 10)).toBe('final');
        expect(resultOf([quarter, semi, final], 40)).toBe('champion');
    });
});
