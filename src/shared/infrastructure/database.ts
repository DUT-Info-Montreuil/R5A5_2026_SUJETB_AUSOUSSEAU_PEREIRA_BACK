import BetterSqlite3 from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { UnitOfWork } from '../application/ports.js';

export type Database = BetterSqlite3.Database;

export function openDatabase(dbPath: string): Database {
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new BetterSqlite3(dbPath);
    // Indispensable : SQLite n'applique pas les clés étrangères par défaut
    db.pragma('foreign_keys = ON');
    // Lectures possibles pendant une écriture
    db.pragma('journal_mode = WAL');
    return db;
}

export function initSchema(db: Database): void {
    const schema = fs.readFileSync(path.join(process.cwd(), 'sql', 'schema.sqlite.sql'), 'utf-8');
    db.exec(schema); // CREATE ... IF NOT EXISTS : relançable sans risque
    for (const [table, column, definition] of ADDED_COLUMNS) {
        const columns = db.prepare<[], { name: string }>(`SELECT name FROM pragma_table_info('${table}')`).all();
        if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
    migrateFreeTeams(db, schema);
    // Membres laissés par la suppression d'équipes hors tournoi avant le correctif (commit 1f716d1)
    db.exec('DELETE FROM team_members WHERE team_id NOT IN (SELECT id FROM teams)');
}

/**
 * Équipes hors tournoi : SQLite ne sait pas lever un NOT NULL, on reconstruit teams et team_members
 * (procédure de la doc SQLite : clés étrangères coupées, renommage sans réécrire les références des autres tables).
 */
function migrateFreeTeams(db: Database, schema: string): void {
    const column = db.prepare<[], { notnull: number }>("SELECT \"notnull\" FROM pragma_table_info('teams') WHERE name = 'tournament_id'").get();
    if (column?.notnull !== 1) return;
    db.pragma('foreign_keys = OFF');
    db.pragma('legacy_alter_table = ON');
    try {
        db.transaction(() => {
            db.exec(`
                DROP INDEX uq_one_captain_per_team;
                ALTER TABLE team_members RENAME TO old_team_members;
                ALTER TABLE teams RENAME TO old_teams;`);
            db.exec(schema);
            db.exec(`
                INSERT INTO teams (id, tournament_id, game_id, name, is_eliminated, visibility, created_at)
                    SELECT o.id, o.tournament_id, tr.game_id, o.name, o.is_eliminated, o.visibility, o.created_at
                    FROM old_teams o JOIN tournaments tr ON tr.id = o.tournament_id;
                INSERT INTO team_members (team_id, user_id, tournament_id, role_id, is_captain, joined_at)
                    SELECT team_id, user_id, tournament_id, role_id, is_captain, joined_at FROM old_team_members;
                DROP TABLE old_team_members;
                DROP TABLE old_teams;`);
            if ((db.pragma('foreign_key_check') as unknown[]).length > 0) throw new Error('Migration des équipes : clés étrangères incohérentes');
        })();
    } finally {
        db.pragma('legacy_alter_table = OFF');
        db.pragma('foreign_keys = ON');
    }
}

// Colonnes ajoutées après coup : CREATE TABLE IF NOT EXISTS ne modifie pas une table déjà créée
const ADDED_COLUMNS = [
    ['tournaments', 'registration_closes_at', 'TEXT'],
    ['teams', 'visibility', "TEXT NOT NULL DEFAULT 'open' CHECK (visibility IN ('open', 'private'))"],
    ['matches', 'scheduled_at', 'TEXT'],
] as const;

// Même format que les DEFAULT du schéma (ISO 8601 UTC avec millisecondes)
export const SQL_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export function isUniqueViolation(err: unknown): boolean {
    return err instanceof Error && 'code' in err && err.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

export class SqliteUnitOfWork implements UnitOfWork {
    private readonly db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    run<T>(work: () => T): T {
        return this.db.transaction(work)();
    }
}
