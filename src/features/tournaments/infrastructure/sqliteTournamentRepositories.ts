import type { Page, Paginated } from '../../../shared/application/ports.js';
import { SQL_NOW, type Database } from '../../../shared/infrastructure/database.js';
import type { MatchRepository, TournamentRepository } from '../application/ports.js';
import type { Match, MatchPlan, MatchStatus, Slot } from '../domain/bracket.js';
import type { Tournament, TournamentStatus } from '../domain/tournament.js';

interface TournamentRow {
    id: number;
    name: string;
    game_id: number;
    game_name: string;
    team_count: number;
    status: TournamentStatus;
    created_by: number;
    created_at: string;
    closed_at: string | null;
    started_at: string | null;
    finished_at: string | null;
}

interface MatchRow {
    id: number;
    tournament_id: number;
    round: number;
    position: number;
    team_a_id: number | null;
    team_b_id: number | null;
    score_a: number | null;
    score_b: number | null;
    winner_id: number | null;
    is_forfeit: 0 | 1;
    status: MatchStatus;
    validated_at: string | null;
}

function toTournament(row: TournamentRow): Tournament {
    return {
        id: row.id,
        name: row.name,
        status: row.status,
        game: { id: row.game_id, name: row.game_name },
        teamCount: row.team_count,
        createdBy: row.created_by,
        createdAt: row.created_at,
        closedAt: row.closed_at,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
    };
}

function toMatch(row: MatchRow): Match {
    return {
        id: row.id,
        tournamentId: row.tournament_id,
        round: row.round,
        position: row.position,
        teamAId: row.team_a_id,
        teamBId: row.team_b_id,
        scoreA: row.score_a,
        scoreB: row.score_b,
        winnerId: row.winner_id,
        isForfeit: row.is_forfeit === 1,
        status: row.status,
        validatedAt: row.validated_at,
    };
}

const SELECT_TOURNAMENT = `
    SELECT t.*, g.name AS game_name,
           (SELECT COUNT(*) FROM teams WHERE tournament_id = t.id) AS team_count
    FROM tournaments t
    JOIN games g ON g.id = t.game_id`;

const SEARCH_FILTER = `
    WHERE (@search IS NULL OR instr(lower(t.name), lower(@search)) > 0)
      AND (@status IS NULL OR t.status = @status)`;

type NextStatus = Exclude<TournamentStatus, 'registration_open'>;

const TIMESTAMP_COLUMN: Record<NextStatus, string> = {
    registration_closed: 'closed_at',
    in_progress: 'started_at',
    finished: 'finished_at',
};

export class SqliteTournamentRepository implements TournamentRepository {
    private readonly db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    search(filters: { search?: string; status?: TournamentStatus }, page: Page): Paginated<Tournament> {
        const params = { search: filters.search ?? null, status: filters.status ?? null };
        const rows = this.db
            .prepare<typeof params & Page, TournamentRow>(
                `${SELECT_TOURNAMENT} ${SEARCH_FILTER} ORDER BY t.created_at DESC, t.id DESC LIMIT @limit OFFSET @offset`,
            )
            .all({ ...params, ...page });
        const total = this.db
            .prepare<typeof params, { n: number }>(`SELECT COUNT(*) AS n FROM tournaments t ${SEARCH_FILTER}`)
            .get(params)!.n;
        return { items: rows.map(toTournament), total };
    }

    findById(id: number): Tournament | undefined {
        const row = this.db.prepare<[number], TournamentRow>(`${SELECT_TOURNAMENT} WHERE t.id = ?`).get(id);
        return row && toTournament(row);
    }

    create(name: string, gameId: number, createdBy: number): Tournament {
        const { id } = this.db
            .prepare<[string, number, number], { id: number }>(
                'INSERT INTO tournaments (name, game_id, created_by) VALUES (?, ?, ?) RETURNING id',
            )
            .get(name, gameId, createdBy)!;
        return this.findById(id)!;
    }

    setStatus(id: number, status: NextStatus): void {
        this.db
            .prepare<[string, number]>(`UPDATE tournaments SET status = ?, ${TIMESTAMP_COLUMN[status]} = ${SQL_NOW} WHERE id = ?`)
            .run(status, id);
    }
}

export class SqliteMatchRepository implements MatchRepository {
    private readonly db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    findById(id: number): Match | undefined {
        const row = this.db.prepare<[number], MatchRow>('SELECT * FROM matches WHERE id = ?').get(id);
        return row && toMatch(row);
    }

    findByTournament(tournamentId: number): Match[] {
        return this.db
            .prepare<[number], MatchRow>('SELECT * FROM matches WHERE tournament_id = ? ORDER BY round, position')
            .all(tournamentId)
            .map(toMatch);
    }

    findAt(tournamentId: number, round: number, position: number): Match | undefined {
        const row = this.db
            .prepare<[number, number, number], MatchRow>('SELECT * FROM matches WHERE tournament_id = ? AND round = ? AND position = ?')
            .get(tournamentId, round, position);
        return row && toMatch(row);
    }

    create(tournamentId: number, plan: MatchPlan): void {
        const status: MatchStatus = plan.teamAId && plan.teamBId ? 'ready' : 'pending';
        this.db
            .prepare<[number, number, number, number | null, number | null, string]>(
                'INSERT INTO matches (tournament_id, round, position, team_a_id, team_b_id, status) VALUES (?, ?, ?, ?, ?, ?)',
            )
            .run(tournamentId, plan.round, plan.position, plan.teamAId, plan.teamBId, status);
    }

    finish(id: number, result: { winnerId: number; scoreA: number | null; scoreB: number | null; isForfeit: boolean }): void {
        this.db
            .prepare<[number, number | null, number | null, number, number]>(`
                UPDATE matches
                SET winner_id = ?, score_a = ?, score_b = ?, is_forfeit = ?, status = 'finished', validated_at = ${SQL_NOW}
                WHERE id = ?`)
            .run(result.winnerId, result.scoreA, result.scoreB, result.isForfeit ? 1 : 0, id);
    }

    placeTeam(id: number, slot: Slot, teamId: number): void {
        const column = slot === 'a' ? 'team_a_id' : 'team_b_id';
        this.db.prepare<[number, number]>(`UPDATE matches SET ${column} = ? WHERE id = ?`).run(teamId, id);
        this.db
            .prepare<[number]>("UPDATE matches SET status = 'ready' WHERE id = ? AND team_a_id IS NOT NULL AND team_b_id IS NOT NULL")
            .run(id);
    }
}
