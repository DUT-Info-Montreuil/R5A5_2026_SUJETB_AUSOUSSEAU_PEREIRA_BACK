import type { Page, Paginated } from '../../../shared/application/ports.js';
import type { Game, GameRole } from '../domain/game.js';

export interface GameRepository {
    findPage(page: Page): Paginated<Game>;
    findById(id: number): Game | undefined;
    findRole(roleId: number): (GameRole & { gameId: number }) | undefined;
    /** Lève ConflictError (GAME_NAME_TAKEN) si le nom est déjà pris. */
    create(name: string, roles: string[]): Game;
}
