// Composition root : le seul endroit qui connaît les implémentations concrètes et les assemble
import { randomInt } from 'node:crypto';
import { ChatService } from './features/chat/application/chatService.js';
import { SqliteMessageRepository } from './features/chat/infrastructure/sqliteMessageRepository.js';
import { GameService } from './features/games/application/gameService.js';
import { SqliteGameRepository } from './features/games/infrastructure/sqliteGameRepository.js';
import { JoinRequestService } from './features/teams/application/joinRequestService.js';
import { TeamService } from './features/teams/application/teamService.js';
import { SqliteJoinRequestRepository, SqliteTeamRepository } from './features/teams/infrastructure/sqliteTeamRepositories.js';
import { MatchService } from './features/tournaments/application/matchService.js';
import { TournamentReader } from './features/tournaments/application/tournamentReader.js';
import { TournamentService } from './features/tournaments/application/tournamentService.js';
import { SqliteMatchRepository, SqliteTournamentRepository } from './features/tournaments/infrastructure/sqliteTournamentRepositories.js';
import { AuthService } from './features/users/application/authService.js';
import { BcryptPasswordHasher, JwtTokenService, MemoryLoginThrottle } from './features/users/infrastructure/security.js';
import { SqliteUserRepository } from './features/users/infrastructure/sqliteUserRepository.js';
import { SocketIoNotifier } from './realtime/socketIoNotifier.js';
import type { Logger } from './shared/application/ports.js';
import type { Config } from './shared/infrastructure/config.js';
import { SqliteUnitOfWork, type Database } from './shared/infrastructure/database.js';

export function createContainer(db: Database, config: Config, logger: Logger) {
    const uow = new SqliteUnitOfWork(db);
    const notifier = new SocketIoNotifier();

    const repositories = {
        users: new SqliteUserRepository(db),
        games: new SqliteGameRepository(db),
        tournaments: new SqliteTournamentRepository(db),
        matches: new SqliteMatchRepository(db),
        teams: new SqliteTeamRepository(db),
        joinRequests: new SqliteJoinRequestRepository(db),
        messages: new SqliteMessageRepository(db),
    };
    const tokens = new JwtTokenService(config.jwtSecret, config.jwtExpiresIn);

    const reader = new TournamentReader({ ...repositories, notifier });
    const authService = new AuthService({
        users: repositories.users,
        hasher: new BcryptPasswordHasher(),
        tokens,
        throttle: new MemoryLoginThrottle(),
        logger,
    });
    const matchService = new MatchService({ ...repositories, reader, notifier, uow, logger });
    const tournamentService = new TournamentService({ ...repositories, matchService, reader, notifier, uow, logger, randomInt });
    const teamService = new TeamService({ ...repositories, reader, notifier, uow, logger });
    const joinRequestService = new JoinRequestService({ ...repositories, teamService, reader, notifier, uow, logger });

    return {
        logger,
        notifier,
        tokens,
        repositories,
        authService,
        gameService: new GameService({ games: repositories.games, logger }),
        tournamentService,
        matchService,
        teamService,
        joinRequestService,
        chatService: new ChatService({ messages: repositories.messages, reader, notifier }),
    };
}

export type Container = ReturnType<typeof createContainer>;
