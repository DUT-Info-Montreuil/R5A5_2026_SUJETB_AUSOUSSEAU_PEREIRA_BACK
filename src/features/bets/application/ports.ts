import type { Page, Paginated } from '../../../shared/application/ports.js';
import type { Bet, BetStatus, WalletEvent } from '../domain/bet.js';

export interface Bettor {
    rank: number;
    user: { id: number; username: string };
    /** Gain net cumulé des paris réglés : gains moins mises. */
    net: number;
    bets: number;
    won: number;
}

export interface BetRepository {
    findByUserAndMatch(userId: number, matchId: number): Bet | undefined;
    findByMatch(matchId: number): Bet[];
    findByTournament(tournamentId: number): Bet[];
    findByUserInTournament(userId: number, tournamentId: number): Bet[];
    /** Mise de chaque pari (à sa création) et gain de chaque pari réglé (à son règlement). */
    walletEventsOf(userId: number): WalletEvent[];
    /** Lève ConflictError (ALREADY_BET). */
    create(userId: number, matchId: number, teamId: number, amount: number): Bet;
    remove(id: number): void;
    settle(id: number, status: Exclude<BetStatus, 'pending'>, payout: number): void;
    /** Paris réglés d'un tournoi, ou réglés dans une période ; par gain net, puis paris gagnés. */
    leaderboard(filter: { tournamentId: number } | { from: string; to: string }, page: Page): Paginated<Bettor>;
}

/** Ce que voit le public d'un match : la cagnotte et ce qui est misé sur chaque équipe. */
export interface BetPool {
    matchId: number;
    open: boolean;
    closesAt: string | null;
    pot: number;
    pools: { teamId: number; total: number; bettors: number }[];
}
