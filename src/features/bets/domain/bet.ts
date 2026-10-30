// Paris en Écus (points de jeu, pas d'argent réel) : pari mutuel, match par match
import { AccessDeniedError, ConflictError } from '../../../shared/domain/errors.js';
import type { Match } from '../../tournaments/domain/bracket.js';
import type { Tournament } from '../../tournaments/domain/tournament.js';

export type BetStatus = 'pending' | 'won' | 'lost' | 'refunded';

export interface Bet {
    id: number;
    userId: number;
    matchId: number;
    teamId: number;
    amount: number;
    status: BetStatus;
    /** null tant que le match n'est pas réglé ; 0 si perdu. */
    payout: number | null;
}

export const STARTING_BALANCE = 100;
export const HOURLY_INCOME = 10;
export const MIN_BET = 10;
const HOUR_MS = 3_600_000;

/** Revenu des heures pleines écoulées depuis l'inscription : calculé à la lecture, sans tâche planifiée. */
export function incomeOf(registeredAt: string, now: Date): { income: number; nextIncomeAt: string } {
    const start = Date.parse(registeredAt);
    const hours = Math.max(0, Math.floor((now.getTime() - start) / HOUR_MS));
    return { income: STARTING_BALANCE + hours * HOURLY_INCOME, nextIncomeAt: new Date(start + (hours + 1) * HOUR_MS).toISOString() };
}

/** L'admin saisit les résultats, un joueur joue le match : ni l'un ni l'autre ne parie. */
export function assertCanBet(user: { isAdmin: boolean }, isPlayer: boolean): void {
    if (user.isAdmin) throw new AccessDeniedError('ADMIN_CANNOT_BET', 'L\'administrateur saisit les résultats : il ne parie pas');
    if (isPlayer) throw new AccessDeniedError('PLAYER_CANNOT_BET', 'Les joueurs du tournoi ne peuvent pas parier');
}

/**
 * Ouvert sur un match dont les deux équipes sont connues, jusqu'à son horaire prévu s'il est fixé,
 * sinon jusqu'à la saisie du résultat.
 */
export function isOpen(match: Match, tournament: Tournament, now: Date): boolean {
    return (
        match.status === 'ready' &&
        (tournament.status === 'registration_closed' || tournament.status === 'in_progress') &&
        (match.scheduledAt === null || now.getTime() < Date.parse(match.scheduledAt))
    );
}

export function assertOpen(match: Match, tournament: Tournament, now: Date): void {
    if (!isOpen(match, tournament, now)) throw new ConflictError('BETS_CLOSED', 'Les paris de ce match sont fermés');
}

export function assertAffordable(amount: number, balance: number): void {
    if (amount > balance) throw new ConflictError('INSUFFICIENT_FUNDS', `Solde insuffisant (${balance} Écus)`);
}

/**
 * Pari mutuel : les gagnants se partagent la cagnotte au prorata de leur mise (arrondi inférieur).
 * Si personne n'a misé sur le vainqueur, chacun est remboursé.
 */
export function settle(bets: Pick<Bet, 'id' | 'teamId' | 'amount'>[], winnerId: number): { id: number; status: Exclude<BetStatus, 'pending'>; payout: number }[] {
    const pot = bets.reduce((sum, b) => sum + b.amount, 0);
    const onWinner = bets.filter((b) => b.teamId === winnerId).reduce((sum, b) => sum + b.amount, 0);
    return bets.map((b) => {
        if (onWinner === 0) return { id: b.id, status: 'refunded', payout: b.amount };
        if (b.teamId !== winnerId) return { id: b.id, status: 'lost', payout: 0 };
        return { id: b.id, status: 'won', payout: Math.floor((b.amount * pot) / onWinner) };
    });
}

const TIME_ZONE = 'Europe/Paris';

/** Décalage de Paris par rapport à UTC (ms) à cet instant : +1 h l'hiver, +2 h l'été. */
function parisOffset(at: number): number {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
            .formatToParts(at)
            .map((p) => [p.type, Number(p.value)]),
    );
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(at / 1000) * 1000;
}

/** Minuit, heure de Paris, du jour donné (calendrier de Paris), en UTC. */
function parisMidnight(year: number, month: number, day: number): number {
    const asUtc = Date.UTC(year, month, day);
    const guess = asUtc - parisOffset(asUtc);
    return asUtc - parisOffset(guess); // corrige si minuit et la valeur estimée sont de part et d'autre d'un changement d'heure
}

/** Semaine du lundi 00:00 au dimanche 23:59:59.999, heure de Paris. `weeksAgo` : 0 cette semaine, 1 la précédente. */
export function parisWeek(now: Date, weeksAgo: number): { from: string; to: string } {
    const local = new Date(now.getTime() + parisOffset(now.getTime())); // lu en UTC, c'est l'heure de Paris
    const daysSinceMonday = (local.getUTCDay() + 6) % 7;
    const monday = (shift: number) =>
        parisMidnight(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday - 7 * weeksAgo + shift);
    return { from: new Date(monday(0)).toISOString(), to: new Date(monday(7) - 1).toISOString() };
}
