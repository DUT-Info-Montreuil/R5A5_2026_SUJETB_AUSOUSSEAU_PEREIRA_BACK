import { describe, expect, it } from 'vitest';
import { db, rollbackLastMigration, runMigrations } from '../src/db.js';

function columns(table: string): string[] {
    return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function tableExists(name: string): boolean {
    return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
}

describe('migration 002_auth', () => {
    it('ajoute les colonnes et tables d\'authentification sans toucher aux colonnes existantes', () => {
        expect(columns('users')).toEqual(
            expect.arrayContaining(['id', 'username', 'email', 'password_hash', 'is_admin', 'created_at', 'public_id', 'token_version']),
        );
        expect(tableExists('refresh_tokens')).toBe(true);
        expect(tableExists('login_failures')).toBe(true);
    });

    it('se rejoue (rollback puis up) en conservant les utilisateurs existants', () => {
        // Utilisateur créé « avant » l'authentification, avec une empreinte bcrypt
        db.prepare("INSERT INTO users (public_id, username, email, password_hash) VALUES ('x', 'ancien', 'ancien@example.com', '$2b$12$abc')").run();

        expect(rollbackLastMigration()).toBe('002_auth');
        expect(columns('users')).not.toContain('public_id');
        expect(columns('users')).not.toContain('token_version');
        expect(tableExists('refresh_tokens')).toBe(false);
        expect(tableExists('login_failures')).toBe(false);
        // Insertion avec l'ancien schéma, sans public_id
        db.prepare("INSERT INTO users (username, email, password_hash) VALUES ('ancien2', 'ancien2@example.com', '$2b$12$def')").run();

        expect(runMigrations()).toEqual(['002_auth']);
        const rows = db.prepare('SELECT username, public_id, token_version, is_admin FROM users ORDER BY id').all() as {
            username: string;
            public_id: string;
            token_version: number;
            is_admin: number;
        }[];
        expect(rows.map((r) => r.username)).toEqual(['ancien', 'ancien2']);
        for (const row of rows) {
            expect(row.public_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
            expect(row.token_version).toBe(0);
            expect(row.is_admin).toBe(0);
        }
    });

    it('refuse un nouvel utilisateur sans public_id', () => {
        expect(() =>
            db.prepare("INSERT INTO users (username, email, password_hash) VALUES ('sansid', 'sansid@example.com', 'h')").run(),
        ).toThrow(/public_id/);
    });

    it('refuse deux emails ne différant que par la casse', () => {
        db.prepare("INSERT INTO users (public_id, username, email, password_hash) VALUES ('a', 'bob1', 'Bob@example.com', 'h')").run();
        expect(() =>
            db.prepare("INSERT INTO users (public_id, username, email, password_hash) VALUES ('b', 'bob2', 'bob@example.com', 'h')").run(),
        ).toThrow(/UNIQUE/);
    });
});
