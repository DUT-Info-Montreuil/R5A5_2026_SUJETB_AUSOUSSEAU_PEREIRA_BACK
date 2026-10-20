import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import type { UserRow } from '../types/user.js';

export interface NewUser {
    username: string;
    email: string;
    passwordHash: string;
    isAdmin: boolean;
}

// Requêtes préparées à l'appel et non au chargement du module :
// le schéma n'existe pas encore quand app.ts est importé (initSchema est appelé après)

export function findById(id: number): UserRow | undefined {
    return db.prepare<[number], UserRow>('SELECT * FROM users WHERE id = ?').get(id);
}

export function findByEmail(email: string): UserRow | undefined {
    return db.prepare<[string], UserRow>('SELECT * FROM users WHERE email = ?').get(email);
}

export function findByEmailOrUsername(email: string, username: string): UserRow[] {
    return db
        .prepare<[string, string], UserRow>('SELECT * FROM users WHERE email = ? OR username = ?')
        .all(email, username);
}

export function create(user: NewUser): UserRow {
    return db
        .prepare<[string, string, string, string, number], UserRow>(
            'INSERT INTO users (public_id, username, email, password_hash, is_admin) VALUES (?, ?, ?, ?, ?) RETURNING *',
        )
        .get(randomUUID(), user.username, user.email, user.passwordHash, user.isAdmin ? 1 : 0)!;
}

export function updatePasswordHash(id: number, passwordHash: string): void {
    db.prepare<[string, number]>('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
}

export function findByPublicId(publicId: string): UserRow | undefined {
    return db.prepare<[string], UserRow>('SELECT * FROM users WHERE public_id = ?').get(publicId);
}

/** Invalide tous les jetons déjà émis pour cet utilisateur. */
export function incrementTokenVersion(id: number): void {
    db.prepare<[number]>('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(id);
}

/** Changement de rôle : incrémente token_version dans la même requête (jetons émis invalidés). */
export function setAdmin(id: number, isAdmin: boolean): void {
    db.prepare<[number, number]>('UPDATE users SET is_admin = ?, token_version = token_version + 1 WHERE id = ?')
        .run(isAdmin ? 1 : 0, id);
}

/** Changement de mot de passe : incrémente token_version dans la même requête. */
export function changePasswordHash(id: number, passwordHash: string): void {
    db.prepare<[string, number]>('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
        .run(passwordHash, id);
}
