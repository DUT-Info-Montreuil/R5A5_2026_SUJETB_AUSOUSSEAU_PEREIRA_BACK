import { db } from '../db.js';

export interface LoginFailureRow {
    identifier_hash: string;
    failure_count: number;
    next_allowed_at: string;
    last_failure_at: string;
}

export function find(identifierHash: string): LoginFailureRow | undefined {
    return db.prepare<[string], LoginFailureRow>('SELECT * FROM login_failures WHERE identifier_hash = ?').get(identifierHash);
}

export function save(row: LoginFailureRow): void {
    db.prepare<[string, number, string, string]>(
        `INSERT INTO login_failures (identifier_hash, failure_count, next_allowed_at, last_failure_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (identifier_hash) DO UPDATE SET
           failure_count = excluded.failure_count,
           next_allowed_at = excluded.next_allowed_at,
           last_failure_at = excluded.last_failure_at`,
    ).run(row.identifier_hash, row.failure_count, row.next_allowed_at, row.last_failure_at);
}

export function remove(identifierHash: string): void {
    db.prepare<[string]>('DELETE FROM login_failures WHERE identifier_hash = ?').run(identifierHash);
}
