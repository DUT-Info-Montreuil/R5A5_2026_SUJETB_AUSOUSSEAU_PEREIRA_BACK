import type { Database } from '../../../shared/infrastructure/database.js';
import type { PredictionRepository } from '../application/ports.js';
import type { Bracket, Pick } from '../domain/prediction.js';

interface PredictionRow {
    user_id: number;
    username: string;
    match_id: number;
    team_id: number;
    created_at: string;
}

export class SqlitePredictionRepository implements PredictionRepository {
    private readonly db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    findPicks(tournamentId: number, userId: number): Pick[] {
        return this.db
            .prepare<[number, number], { match_id: number; team_id: number }>(
                `SELECT p.match_id, p.team_id FROM predictions p JOIN matches m ON m.id = p.match_id
                 WHERE m.tournament_id = ? AND p.user_id = ? ORDER BY m.round, m.position`,
            )
            .all(tournamentId, userId)
            .map((row) => ({ matchId: row.match_id, teamId: row.team_id }));
    }

    findBrackets(tournamentId: number): Bracket[] {
        const rows = this.db
            .prepare<[number], PredictionRow>(
                `SELECT p.user_id, u.username, p.match_id, p.team_id, p.created_at
                 FROM predictions p JOIN matches m ON m.id = p.match_id JOIN users u ON u.id = p.user_id
                 WHERE m.tournament_id = ? ORDER BY p.created_at, p.user_id`,
            )
            .all(tournamentId);
        const byUser = new Map<number, Bracket>();
        for (const row of rows) {
            let bracket = byUser.get(row.user_id);
            if (!bracket) {
                bracket = { user: { id: row.user_id, username: row.username }, picks: [], submittedAt: row.created_at };
                byUser.set(row.user_id, bracket);
            }
            bracket.picks.push({ matchId: row.match_id, teamId: row.team_id });
        }
        return [...byUser.values()];
    }

    replace(tournamentId: number, userId: number, picks: Pick[]): void {
        this.db
            .prepare('DELETE FROM predictions WHERE user_id = ? AND match_id IN (SELECT id FROM matches WHERE tournament_id = ?)')
            .run(userId, tournamentId);
        const insert = this.db.prepare('INSERT INTO predictions (user_id, match_id, team_id) VALUES (?, ?, ?)');
        for (const pick of picks) insert.run(userId, pick.matchId, pick.teamId);
    }
}
