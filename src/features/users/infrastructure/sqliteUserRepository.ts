import { ConflictError } from '../../../shared/domain/errors.js';
import { isUniqueViolation, type Database } from '../../../shared/infrastructure/database.js';
import type { UserRepository } from '../application/ports.js';
import type { NewUser, User } from '../domain/user.js';

interface UserRow {
    id: number;
    username: string;
    email: string;
    password_hash: string;
    is_admin: 0 | 1;
    created_at: string;
}

function toUser(row: UserRow): User {
    return {
        id: row.id,
        username: row.username,
        email: row.email,
        passwordHash: row.password_hash,
        isAdmin: row.is_admin === 1,
        createdAt: row.created_at,
    };
}

export class SqliteUserRepository implements UserRepository {
    private readonly db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    findById(id: number): User | undefined {
        const row = this.db.prepare<[number], UserRow>('SELECT * FROM users WHERE id = ?').get(id);
        return row && toUser(row);
    }

    findByEmail(email: string): User | undefined {
        const row = this.db.prepare<[string], UserRow>('SELECT * FROM users WHERE email = ?').get(email);
        return row && toUser(row);
    }

    findByEmailOrUsername(email: string, username: string): User[] {
        return this.db
            .prepare<[string, string], UserRow>('SELECT * FROM users WHERE email = ? OR username = ?')
            .all(email, username)
            .map(toUser);
    }

    create(user: NewUser): User {
        try {
            const row = this.db
                .prepare<[string, string, string, number], UserRow>(
                    'INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, ?) RETURNING *',
                )
                .get(user.username, user.email, user.passwordHash, user.isAdmin ? 1 : 0)!;
            return toUser(row);
        } catch (err) {
            // Deux inscriptions simultanées peuvent passer la vérification du service
            if (isUniqueViolation(err)) {
                throw new ConflictError('USER_ALREADY_EXISTS', 'Cet email ou ce nom d\'utilisateur est déjà utilisé');
            }
            throw err;
        }
    }
}
