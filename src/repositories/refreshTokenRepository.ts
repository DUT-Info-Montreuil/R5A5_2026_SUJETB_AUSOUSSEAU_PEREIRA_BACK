import { db } from '../db.js';

// On ne stocke que le jti du refresh token, jamais le jeton lui-même
export interface RefreshTokenRow {
    jti: string;
    user_id: number;
    family_id: string;
    expires_at: string;
    revoked_at: string | null;
    replaced_by: string | null;
    created_at: string;
}

export function create(row: { jti: string; userId: number; familyId: string; expiresAt: Date }): void {
    db.prepare<[string, number, string, string]>(
        'INSERT INTO refresh_tokens (jti, user_id, family_id, expires_at) VALUES (?, ?, ?, ?)',
    ).run(row.jti, row.userId, row.familyId, row.expiresAt.toISOString());
}

export function findByJti(jti: string): RefreshTokenRow | undefined {
    return db.prepare<[string], RefreshTokenRow>('SELECT * FROM refresh_tokens WHERE jti = ?').get(jti);
}

/**
 * Révoque un jti encore actif. Renvoie false s'il l'était déjà : la condition
 * `revoked_at IS NULL` rend l'opération atomique face à deux refresh simultanés.
 */
export function revoke(jti: string, replacedBy: string | null = null): boolean {
    const result = db
        .prepare<[string, string | null, string]>(
            'UPDATE refresh_tokens SET revoked_at = ?, replaced_by = ? WHERE jti = ? AND revoked_at IS NULL',
        )
        .run(new Date().toISOString(), replacedBy, jti);
    return result.changes === 1;
}

export function revokeAllForUser(userId: number): void {
    db.prepare<[string, number]>('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
        .run(new Date().toISOString(), userId);
}

export function deleteExpired(): void {
    db.prepare<[string]>('DELETE FROM refresh_tokens WHERE expires_at < ?').run(new Date().toISOString());
}
