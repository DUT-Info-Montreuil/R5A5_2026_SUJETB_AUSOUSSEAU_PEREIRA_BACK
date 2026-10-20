export type Role = 'user' | 'admin';

// Ligne telle que stockée en base : ne jamais la renvoyer directement au client
export interface UserRow {
    id: number;
    public_id: string;
    username: string;
    email: string;
    password_hash: string;
    is_admin: 0 | 1;
    token_version: number;
    created_at: string;
}

// Projection explicite : seul ce qui est listé ici sort de l'API.
// `id` est l'identifiant public (UUID), jamais l'entier interne
export interface PublicUser {
    id: string;
    username: string;
    email: string;
    role: Role;
    isAdmin: boolean;
    createdAt: string;
}

// Le rôle reste stocké dans la colonne existante is_admin
export function roleOf(row: Pick<UserRow, 'is_admin'>): Role {
    return row.is_admin === 1 ? 'admin' : 'user';
}

export function toPublicUser(row: UserRow): PublicUser {
    return {
        id: row.public_id,
        username: row.username,
        email: row.email,
        role: roleOf(row),
        isAdmin: row.is_admin === 1,
        createdAt: row.created_at,
    };
}

// Utilisateur authentifié, tel que posé dans req.user par le garde global
export interface AuthUser {
    id: number; // interne, pour les requêtes et les vérifications de propriété
    publicId: string;
    role: Role; // claim `role` de l'access token
}
