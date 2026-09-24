// Ligne telle que stockée en base : ne jamais la renvoyer directement au client
export interface UserRow {
    id: number;
    username: string;
    email: string;
    password_hash: string;
    is_admin: 0 | 1;
    created_at: string;
}

export interface PublicUser {
    id: number;
    username: string;
    email: string;
    isAdmin: boolean;
    createdAt: string;
}

export function toPublicUser(row: UserRow): PublicUser {
    return {
        id: row.id,
        username: row.username,
        email: row.email,
        isAdmin: row.is_admin === 1,
        createdAt: row.created_at,
    };
}
