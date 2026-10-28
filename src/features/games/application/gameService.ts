import type { Logger, Page, Paginated } from '../../../shared/application/ports.js';
import { assertRolesUnique, type Game } from '../domain/game.js';
import type { GameRepository } from './ports.js';

export class GameService {
    private readonly games: GameRepository;
    private readonly logger: Logger;

    constructor(deps: { games: GameRepository; logger: Logger }) {
        this.games = deps.games;
        this.logger = deps.logger;
    }

    list(page: Page): Paginated<Game> {
        return this.games.findPage(page);
    }

    create(input: { name: string; roles: string[] }): Game {
        assertRolesUnique(input.roles);
        const game = this.games.create(input.name, input.roles);
        this.logger.info('game_created', { game: game.id });
        return game;
    }
}
