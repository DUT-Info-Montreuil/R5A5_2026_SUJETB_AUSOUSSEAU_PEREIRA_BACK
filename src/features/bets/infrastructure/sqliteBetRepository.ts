import type { Page, Paginated } from '../../../shared/application/ports.js';
import { ConflictError } from '../../../shared/domain/errors.js';
import { isUniqueViolation, SQL_NOW, type Database } from '../../../shared/infrastructure/database.js';
import type { BetRepository, Bettor } from '../application/ports.js';
import type { Bet, BetStatus } from '../domain/bet.js';

interface BetRow {
    id: number;
    user_id: number;
    match_id: number;
    team_id: number;
    amount: number;
    status: BetStatus;
    payout: number | null;
}

interface BettorRow {
    rank: number;
    user_id: number;
    username: string;
    net: number;
    bets: number;
    won: number;
}

function toBet(row: BetRow): Bet {
    return {
        id: row.id,
        userId: row.user_id,
        matchId: row.match_id,
        teamId: row.team_id,
        amount: row.amount,
        status: row.status,
        payout: row.payout,
    };
}

const SELECT_BETS = 'SELECT b.* FROM bets b JOIN matches m ON m.id = b.match_id';

export class SqliteBetRepository implements BetRepository {
    private readonly db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    findByUserAndMatch(userId: number, matchId: number): Bet | undefined {
        const row = this.db.prepare<[number, number], BetRow>('SELECT * FROM bets WHERE user_id = ? AND match_id = ?').get(userId, matchId);
        return row && toBet(row);
    }

    findByMatch(matchId: number): Bet[] {
        return this.db.prepare<[number], BetRow>('SELECT * FROM bets WHERE match_id = ? ORDER BY id').all(matchId).map(toBet);
    }

    findByTournament(tournamentId: number): Bet[] {
        return this.db.prepare<[number], BetRow>(`${SELECT_BETS} WHERE m.tournament_id = ? ORDER BY b.id`).all(tournamentId).map(toBet);
    }

    findByUserInTournament(userId: number, tournamentId: number): Bet[] {
        return this.db
            .prepare<[number, number], BetRow>(`${SELECT_BETS} WHERE b.user_id = ? AND m.tournament_id = ? ORDER BY m.round, m.position`)
            .all(userId, tournamentId)
            .map(toBet);
    }

    totalsOf(userId: number): { staked: number; paidOut: number } {
        return this.db
            .prepare<[number], { staked: number; paidOut: number }>(
                'SELECT COALESCE(SUM(amount), 0) AS staked, COALESCE(SUM(payout), 0) AS paidOut FROM bets WHERE user_id = ?',
            )
            .get(userId)!;
    }

    create(userId: number, matchId: number, teamId: number, amount: number): Bet {
        try {
            const row = this.db
                .prepare<[number, number, number, number], BetRow>('INSERT INTO bets (user_id, match_id, team_id, amount) VALUES (?, ?, ?, ?) RETURNING *')
                .get(userId, matchId, teamId, amount)!;
            return toBet(row);
        } catch (err) {
            if (isUniqueViolation(err)) throw new ConflictError('ALREADY_BET', 'Vous avez déjà parié sur ce match');
            throw err;
        }
    }

    remove(id: number): void {
        this.db.prepare('DELETE FROM bets WHERE id = ?').run(id);
    }

    settle(id: number, status: Exclude<BetStatus, 'pending'>, payout: number): void {
        this.db.prepare(`UPDATE bets SET status = ?, payout = ?, settled_at = ${SQL_NOW} WHERE id = ?`).run(status, payout, id);
    }

    leaderboard(filter: { tournamentId: number } | { from: string; to: string }, page: Page): Paginated<Bettor> {
        const [where, args] =
            'tournamentId' in filter
                ? ['m.tournament_id = ?', [filter.tournamentId]]
                : ['b.settled_at BETWEEN ? AND ?', [filter.from, filter.to]];
        const settled = `FROM bets b JOIN matches m ON m.id = b.match_id JOIN users u ON u.id = b.user_id WHERE b.status <> 'pending' AND ${where}`;
        const rows = this.db
            .prepare<unknown[], BettorRow>(
                `SELECT RANK() OVER (ORDER BY SUM(b.payout - b.amount) DESC, SUM(b.status = 'won') DESC) AS rank,
                        b.user_id, u.username, SUM(b.payout - b.amount) AS net, COUNT(*) AS bets, SUM(b.status = 'won') AS won
                 ${settled}
                 GROUP BY b.user_id ORDER BY rank, b.user_id LIMIT ? OFFSET ?`,
            )
            .all(...args, page.limit, page.offset);
        const total = this.db.prepare<unknown[], { n: number }>(`SELECT COUNT(DISTINCT b.user_id) AS n ${settled}`).get(...args)!.n;
        return {
            items: rows.map((r) => ({ rank: r.rank, user: { id: r.user_id, username: r.username }, net: r.net, bets: r.bets, won: r.won })),
            total,
        };
    }
}
