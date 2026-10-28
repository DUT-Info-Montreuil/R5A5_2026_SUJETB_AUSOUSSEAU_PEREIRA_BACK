import type { Page, Paginated } from '../../../shared/application/ports.js';
import { ConflictError } from '../../../shared/domain/errors.js';
import { isUniqueViolation, type Database } from '../../../shared/infrastructure/database.js';
import type { GameRepository } from '../application/ports.js';
import type { Game, GameRole } from '../domain/game.js';

interface GameRow {
    id: number;
    name: string;
}

interface RoleRow {
    id: number;
    game_id: number;
    name: string;
}

export class SqliteGameRepository implements GameRepository {
    private readonly db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    findPage(page: Page): Paginated<Game> {
        const rows = this.db
            .prepare<[number, number], GameRow>('SELECT * FROM games ORDER BY name LIMIT ? OFFSET ?')
            .all(page.limit, page.offset);
        const total = this.db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM games').get()!.n;
        return { items: rows.map((row) => this.withRoles(row)), total };
    }

    findById(id: number): Game | undefined {
        const row = this.db.prepare<[number], GameRow>('SELECT * FROM games WHERE id = ?').get(id);
        return row && this.withRoles(row);
    }

    findRole(roleId: number): (GameRole & { gameId: number }) | undefined {
        const row = this.db.prepare<[number], RoleRow>('SELECT * FROM game_roles WHERE id = ?').get(roleId);
        return row && { id: row.id, name: row.name, gameId: row.game_id };
    }

    create(name: string, roles: string[]): Game {
        try {
            const id = this.db.transaction(() => {
                const game = this.db.prepare<[string], GameRow>('INSERT INTO games (name) VALUES (?) RETURNING *').get(name)!;
                const insertRole = this.db.prepare<[number, string]>('INSERT INTO game_roles (game_id, name) VALUES (?, ?)');
                for (const role of roles) insertRole.run(game.id, role);
                return game.id;
            })();
            return this.findById(id)!;
        } catch (err) {
            if (isUniqueViolation(err)) throw new ConflictError('GAME_NAME_TAKEN', 'Ce jeu existe déjà');
            throw err;
        }
    }

    private withRoles(row: GameRow): Game {
        const roles = this.db
            .prepare<[number], RoleRow>('SELECT * FROM game_roles WHERE game_id = ? ORDER BY id')
            .all(row.id);
        return { id: row.id, name: row.name, roles: roles.map((r) => ({ id: r.id, name: r.name })) };
    }
}
