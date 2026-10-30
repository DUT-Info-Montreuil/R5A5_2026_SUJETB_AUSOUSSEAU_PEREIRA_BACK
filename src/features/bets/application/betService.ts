import type { Logger, Page, Paginated, UnitOfWork } from '../../../shared/application/ports.js';
import type { RealtimeNotifier } from '../../../shared/application/realtimeNotifier.js';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import type { TeamRepository } from '../../teams/application/ports.js';
import type { BetSettlement, MatchRepository } from '../../tournaments/application/ports.js';
import type { TournamentReader } from '../../tournaments/application/tournamentReader.js';
import { opponentOf, type Match } from '../../tournaments/domain/bracket.js';
import type { UserRepository } from '../../users/application/ports.js';
import type { User } from '../../users/domain/user.js';
import { assertAffordable, assertCanBet, assertOpen, isOpen, walletOf, parisWeek, settle as settleBets, type Bet } from '../domain/bet.js';
import type { BetPool, BetRepository, Bettor } from './ports.js';

export class BetService implements BetSettlement {
    private readonly bets: BetRepository;
    private readonly users: UserRepository;
    private readonly teams: TeamRepository;
    private readonly matches: MatchRepository;
    private readonly reader: TournamentReader;
    private readonly notifier: RealtimeNotifier;
    private readonly uow: UnitOfWork;
    private readonly logger: Logger;
    private readonly clock: () => Date;

    constructor(deps: {
        bets: BetRepository;
        users: UserRepository;
        teams: TeamRepository;
        matches: MatchRepository;
        reader: TournamentReader;
        notifier: RealtimeNotifier;
        uow: UnitOfWork;
        logger: Logger;
        clock: () => Date;
    }) {
        this.bets = deps.bets;
        this.users = deps.users;
        this.teams = deps.teams;
        this.matches = deps.matches;
        this.reader = deps.reader;
        this.notifier = deps.notifier;
        this.uow = deps.uow;
        this.logger = deps.logger;
        this.clock = deps.clock;
    }

    wallet(userId: number): { balance: number; nextIncomeAt: string | null } {
        return walletOf(this.users.findById(userId)!.createdAt, this.bets.walletEventsOf(userId), this.clock());
    }

    pools(tournamentId: number): BetPool[] {
        const { tournament, matches } = this.reader.getDetail(tournamentId);
        const bets = this.bets.findByTournament(tournamentId);
        const now = this.clock();
        return matches.map((match) => {
            const onMatch = bets.filter((b) => b.matchId === match.id);
            const teamIds = [match.teamAId, match.teamBId].filter((id): id is number => id !== null);
            return {
                matchId: match.id,
                open: isOpen(match, tournament, now),
                closesAt: match.scheduledAt,
                pot: onMatch.reduce((sum, b) => sum + b.amount, 0),
                pools: teamIds.map((teamId) => {
                    const onTeam = onMatch.filter((b) => b.teamId === teamId);
                    return { teamId, total: onTeam.reduce((sum, b) => sum + b.amount, 0), bettors: onTeam.length };
                }),
            };
        });
    }

    mine(tournamentId: number, userId: number): Bet[] {
        this.reader.requireTournament(tournamentId);
        return this.bets.findByUserInTournament(userId, tournamentId);
    }

    place(matchId: number, user: User, teamId: number, amount: number): { bet: Bet; balance: number } {
        const bet = this.uow.run(() => {
            const match = this.requireMatch(matchId);
            const tournament = this.reader.requireTournament(match.tournamentId);
            assertCanBet(user, this.teams.findTeamIdOfUser(match.tournamentId, user.id) !== undefined);
            assertOpen(match, tournament, this.clock());
            opponentOf(match, teamId); // 422 TEAM_NOT_IN_MATCH
            if (this.bets.findByUserAndMatch(user.id, matchId)) throw new ConflictError('ALREADY_BET', 'Vous avez déjà parié sur ce match');
            assertAffordable(amount, this.wallet(user.id).balance);
            return this.bets.create(user.id, matchId, teamId, amount);
        });
        this.logger.info('bet_placed', { match: matchId, user: user.id, team: teamId, amount });
        this.announceMatch(matchId, [user.id]);
        return { bet, balance: this.wallet(user.id).balance };
    }

    /** Annulable tant que les paris du match sont ouverts : la mise est rendue. */
    cancel(matchId: number, userId: number): { balance: number } {
        this.uow.run(() => {
            const match = this.requireMatch(matchId);
            const bet = this.bets.findByUserAndMatch(userId, matchId);
            if (!bet) throw new NotFoundError('BET_NOT_FOUND', 'Aucun pari sur ce match');
            assertOpen(match, this.reader.requireTournament(match.tournamentId), this.clock());
            this.bets.remove(bet.id);
        });
        this.logger.info('bet_cancelled', { match: matchId, user: userId });
        this.announceMatch(matchId, [userId]);
        return this.wallet(userId);
    }

    tournamentLeaderboard(tournamentId: number, page: Page): Paginated<Bettor> {
        this.reader.requireTournament(tournamentId);
        return this.bets.leaderboard({ tournamentId }, page);
    }

    /** Le revenu horaire n'y compte pas : seuls les paris réglés dans la semaine. */
    weeklyLeaderboard(week: 'current' | 'previous', page: Page): Paginated<Bettor> & { from: string; to: string } {
        const range = parisWeek(this.clock(), week === 'current' ? 0 : 1);
        return { ...range, ...this.bets.leaderboard(range, page) };
    }

    /** Dans la transaction du résultat ou du forfait. Renvoie les parieurs du match. */
    settle(matchId: number, winnerId: number): number[] {
        const bets = this.bets.findByMatch(matchId);
        for (const s of settleBets(bets, winnerId)) this.bets.settle(s.id, s.status, s.payout);
        if (bets.length > 0) this.logger.info('bets_settled', { match: matchId, bets: bets.length });
        return bets.map((b) => b.userId);
    }

    /** Après le commit : la cagnotte du tournoi au public, le solde à chaque parieur concerné. */
    announce(tournamentId: number, userIds: number[]): void {
        this.notifier.betsUpdated(tournamentId, this.pools(tournamentId));
        for (const userId of userIds) this.notifier.walletUpdated(userId, this.wallet(userId).balance);
    }

    private announceMatch(matchId: number, userIds: number[]): void {
        this.announce(this.matches.findById(matchId)!.tournamentId, userIds);
    }

    private requireMatch(matchId: number): Match {
        const match = this.matches.findById(matchId);
        if (!match) throw new NotFoundError('MATCH_NOT_FOUND', 'Match introuvable');
        return match;
    }
}
