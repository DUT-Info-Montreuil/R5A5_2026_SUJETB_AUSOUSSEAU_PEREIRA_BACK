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
