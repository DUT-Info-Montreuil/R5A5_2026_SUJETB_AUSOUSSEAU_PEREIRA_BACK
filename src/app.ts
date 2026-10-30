import cors from 'cors';
import express, { type Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import type { Container } from './container.js';
import { chatRoutes } from './features/chat/infrastructure/http.js';
import { gameRoutes } from './features/games/infrastructure/http.js';
import { predictionRoutes } from './features/predictions/infrastructure/http.js';
import { teamRoutes } from './features/teams/infrastructure/http.js';
import { tournamentRoutes } from './features/tournaments/infrastructure/http.js';
import { userRoutes } from './features/users/infrastructure/http.js';
import type { Config } from './shared/infrastructure/config.js';
import { createAuthenticate, requireAdmin } from './shared/infrastructure/http/auth.js';
import { createErrorHandler, notFoundHandler } from './shared/infrastructure/http/errorHandler.js';
import { buildOpenApiDocument } from './shared/infrastructure/http/openapi.js';
import { createRequestLogger } from './shared/infrastructure/http/requestLogger.js';
import { buildRouter, type AnyRoute } from './shared/infrastructure/http/routing.js';
import { createRateLimiter, requireJsonBody, securityHeaders } from './shared/infrastructure/http/security.js';

const MINUTE = 60_000;

/** Toutes les routes de l'API : une seule table, qui sert à la fois au routage et à la documentation. */
export function apiRoutes(c: Container): AnyRoute[] {
    return [
        ...userRoutes(c.authService),
        ...gameRoutes(c.gameService),
        ...tournamentRoutes(c.tournamentService, c.matchService, c.teamService),
        ...teamRoutes(c.teamService, c.joinRequestService),
        ...chatRoutes(c.chatService),
        ...predictionRoutes(c.predictionService),
    ];
}

export function createApp(container: Container, config: Config): Express {
    const app = express();
    const routes = apiRoutes(container);
    const openApiDocument = buildOpenApiDocument(routes);

    app.disable('x-powered-by'); // n'annonce pas la technologie du serveur
    // Toujours en premier : les requêtes refusées plus loin sont journalisées aussi
    app.use(createRequestLogger(container.logger));
    app.use(securityHeaders);
    app.use(cors({ origin: config.corsOrigins }));
    app.use(createRateLimiter(config.rateLimitGlobal, MINUTE));
    app.use(requireJsonBody);
    app.use(express.json({ limit: '100kb' }));

    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok' });
    });
    app.get('/openapi.json', (req, res) => {
        res.json(openApiDocument);
    });
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

    app.use(
        buildRouter(routes, {
            authenticate: createAuthenticate((token) => container.authService.authenticate(token)),
            requireAdmin,
            strictRateLimit: createRateLimiter(config.rateLimitAuth, 15 * MINUTE),
        }),
    );

    // Toujours en dernier
    app.use(notFoundHandler);
    app.use(createErrorHandler(container.logger));
    return app;
}
