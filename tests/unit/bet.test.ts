// Règles des paris testées seules : ni base de données, ni serveur
import { describe, expect, it } from 'vitest';
import { isOpen, parisWeek, settle, walletOf } from '../../src/features/bets/domain/bet.js';
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
    const now = new Date('2026-10-30T12:00:00.000Z');
    const registered = '2026-10-30T02:30:00.000Z'; // heures pleines à 03:30, 04:30...

    it('100 Écus au départ ; le revenu horaire ne fait pas dépasser 100', () => {
        expect(walletOf(registered, [], now)).toEqual({ balance: 100, nextIncomeAt: null });
    });

    it('après une mise, 10 par heure pleine jusqu\'à 100 ; prochain revenu à l\'heure pleine suivante', () => {
        const events = [{ at: '2026-10-30T09:00:00.000Z', delta: -80 }]; // 20, puis 09:30, 10:30, 11:30
        expect(walletOf(registered, events, now)).toEqual({ balance: 50, nextIncomeAt: '2026-10-30T12:30:00.000Z' });
        const longAgo = [{ at: '2026-10-30T03:00:00.000Z', delta: -80 }]; // 8 heures pleines ensuite, plafonné
        expect(walletOf(registered, longAgo, now).balance).toBe(100);
    });

    it('les gains dépassent le plafond, et le revenu reprend une fois redescendu dessous', () => {
        const events = [
            { at: '2026-10-30T03:00:00.000Z', delta: -100 }, // 0
            { at: '2026-10-30T03:45:00.000Z', delta: 300 }, // 03:30 : 10, puis 310
            { at: '2026-10-30T07:00:00.000Z', delta: -250 }, // 60, puis 07:30 à 11:30 : 5 heures, plafonné à 100
        ];
        expect(walletOf(registered, events, now).balance).toBe(100);
        expect(walletOf(registered, events.slice(0, 2), now)).toEqual({ balance: 310, nextIncomeAt: null });
        expect(walletOf(registered, [...events, { at: '2026-10-30T11:45:00.000Z', delta: -30 }], now).balance).toBe(70);
    });
});

describe('Ouverture des paris', () => {
    const tournament = { status: 'in_progress' } as Tournament;
    const match = { status: 'ready', scheduledAt: '2026-10-31T00:00:00.000Z' } as Match;
    const now = new Date('2026-10-30T12:00:00Z');

    it('ouverts sur un match prêt, seulement s\'il a un horaire, jusqu\'à cet horaire', () => {
        expect(isOpen(match, tournament, now)).toBe(true);
        expect(isOpen({ ...match, scheduledAt: null }, tournament, now)).toBe(false);
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
