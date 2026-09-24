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
        .prepare<[string, string, string, number], UserRow>(
            'INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, ?) RETURNING *',
        )
        .get(user.username, user.email, user.passwordHash, user.isAdmin ? 1 : 0)!;
}
