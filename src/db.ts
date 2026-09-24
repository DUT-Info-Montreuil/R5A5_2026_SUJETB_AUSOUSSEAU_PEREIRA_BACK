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

export function initSchema(): void {
  const schemaPath = path.join(process.cwd(), 'sql', 'schema.sqlite.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema); // CREATE ... IF NOT EXISTS : relançable sans risque
}
