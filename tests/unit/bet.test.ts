// Règles des paris testées seules : ni base de données, ni serveur
import { describe, expect, it } from 'vitest';
import { incomeOf, isOpen, parisWeek, settle } from '../../src/features/bets/domain/bet.js';
import type { Match } from '../../src/features/tournaments/domain/bracket.js';
import type { Tournament } from '../../src/features/tournaments/domain/tournament.js';

describe('Règlement (pari mutuel)', () => {
    it('les gagnants se partagent la cagnotte au prorata, arrondi inférieur', () => {
        const result = settle([{ id: 1, teamId: 10, amount: 30 }, { id: 2, teamId: 10, amount: 20 }, { id: 3, teamId: 20, amount: 25 }], 10);
        // cagnotte 75, 50 misés sur le vainqueur
        expect(result).toEqual([
            { id: 1, status: 'won', payout: 45 },
            { id: 2, status: 'won', payout: 30 },
            { id: 3, status: 'lost', payout: 0 },
        ]);
        expect(settle([{ id: 1, teamId: 10, amount: 10 }, { id: 2, teamId: 10, amount: 10 }, { id: 3, teamId: 20, amount: 11 }], 10)[0]!.payout).toBe(15);
    });

    it('rembourse tout le monde si personne n\'a misé sur le vainqueur', () => {
        expect(settle([{ id: 1, teamId: 20, amount: 40 }], 10)).toEqual([{ id: 1, status: 'refunded', payout: 40 }]);
    });
});

describe('Portefeuille', () => {
    it('100 Écus au départ, puis 10 par heure pleine', () => {
        const now = new Date('2026-10-30T12:00:00.000Z');
        expect(incomeOf('2026-10-30T11:30:00.000Z', now)).toEqual({ income: 100, nextIncomeAt: '2026-10-30T12:30:00.000Z' });
        expect(incomeOf('2026-10-30T09:00:00.000Z', now)).toEqual({ income: 130, nextIncomeAt: '2026-10-30T13:00:00.000Z' });
    });
});

describe('Ouverture des paris', () => {
    const tournament = { status: 'in_progress' } as Tournament;
    const match = { status: 'ready', scheduledAt: null } as Match;
    const now = new Date('2026-10-30T12:00:00Z');

    it('ouverts sur un match prêt, jusqu\'à son horaire s\'il est fixé', () => {
        expect(isOpen(match, tournament, now)).toBe(true);
        expect(isOpen({ ...match, scheduledAt: '2026-10-30T12:00:01.000Z' }, tournament, now)).toBe(true);
        expect(isOpen({ ...match, scheduledAt: '2026-10-30T12:00:00.000Z' }, tournament, now)).toBe(false);
    });

    it('fermés sur un match en attente ou joué, ou un tournoi aux inscriptions ouvertes ou terminé', () => {
        expect(isOpen({ ...match, status: 'pending' }, tournament, now)).toBe(false);
        expect(isOpen({ ...match, status: 'finished' }, tournament, now)).toBe(false);
        expect(isOpen(match, { status: 'registration_open' } as Tournament, now)).toBe(false);
        expect(isOpen(match, { status: 'finished' } as Tournament, now)).toBe(false);
    });
});

describe('Semaine, heure de Paris', () => {
    it('du lundi minuit au dimanche 23:59:59.999, heure d\'hiver comme d\'été', () => {
        // Jeudi 29 octobre 2026, heure d'hiver (UTC+1)
        expect(parisWeek(new Date('2026-10-29T12:00:00Z'), 0)).toEqual({ from: '2026-10-25T23:00:00.000Z', to: '2026-11-01T22:59:59.999Z' });
        // Semaine précédente : le changement d'heure du dimanche 25 octobre tombe dedans (lundi à UTC+2)
        expect(parisWeek(new Date('2026-10-29T12:00:00Z'), 1)).toEqual({ from: '2026-10-18T22:00:00.000Z', to: '2026-10-25T22:59:59.999Z' });
        // Dimanche 23:30 à Paris : encore la même semaine
        expect(parisWeek(new Date('2026-11-01T22:30:00Z'), 0).from).toBe('2026-10-25T23:00:00.000Z');
        // Lundi 00:30 à Paris, encore dimanche en UTC : nouvelle semaine
        expect(parisWeek(new Date('2026-11-01T23:30:00Z'), 0).from).toBe('2026-11-01T23:00:00.000Z');
    });
});
