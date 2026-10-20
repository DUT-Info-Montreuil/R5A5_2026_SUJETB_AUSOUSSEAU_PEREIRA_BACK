// src/db.ts
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'arch-rivals.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

// Indispensable : SQLite n'applique PAS les clés étrangères par défaut
db.pragma('foreign_keys = ON');
// Meilleures perfs, lectures possibles pendant une écriture
db.pragma('journal_mode = WAL');

const MIGRATIONS_DIR = path.join(process.cwd(), 'sql', 'migrations');

export function initSchema(): void {
  const schemaPath = path.join(process.cwd(), 'sql', 'schema.sqlite.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema); // CREATE ... IF NOT EXISTS : relançable sans risque
  runMigrations();
}

// schema.sqlite.sql reste la base de départ (001) ; les évolutions suivantes sont des
// migrations numérotées NNN_nom.up.sql / NNN_nom.down.sql, appliquées une seule fois
function ensureMigrationsTable(): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT NOT NULL PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ) STRICT`);
}

function availableMigrations(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.up.sql'))
    .map((f) => f.slice(0, -'.up.sql'.length))
    .sort();
}

function appliedMigrations(): string[] {
  return db
    .prepare<[], { version: string }>('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map((r) => r.version);
}

export function runMigrations(): string[] {
  ensureMigrationsTable();
  const applied = new Set(appliedMigrations());
  const pending = availableMigrations().filter((v) => !applied.has(v));

  for (const version of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, `${version}.up.sql`), 'utf-8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
    })();
  }
  return pending;
}

/** Annule la dernière migration appliquée. Le schéma de départ (001) n'est jamais annulé. */
export function rollbackLastMigration(): string | undefined {
  ensureMigrationsTable();
  const version = appliedMigrations().at(-1);
  if (!version) return undefined;

  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, `${version}.down.sql`), 'utf-8');
  db.transaction(() => {
    db.exec(sql);
    db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(version);
  })();
  return version;
}
