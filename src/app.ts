import express, { type Express, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { config } from './config.js'; // plante au démarrage si la configuration est incomplète
import { authenticate } from './middlewares/authenticate.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { httpsOnly } from './middlewares/httpsOnly.js';
import { originCheck } from './middlewares/originCheck.js';
import { globalRateLimit } from './middlewares/rateLimits.js';
import { requestId } from './middlewares/requestId.js';
import { requireJson } from './middlewares/requireJson.js';
import { securityHeaders } from './middlewares/securityHeaders.js';
import { authRoutes } from './routes/authRoutes.js';
import { csrfProtection } from './security/csrf.js';

export const app: Express = express();

// Ne pas annoncer la technologie ; l'IP et le protocole réels viennent du proxy de confiance
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

app.use(requestId);
app.use(securityHeaders);
app.use(httpsOnly);
// Liste blanche explicite (jamais `*` avec les credentials). CORS contrôle qui lit la
// réponse : ce n'est PAS une protection contre le CSRF
app.use(cors({
    origin: [...config.corsOrigins],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    exposedHeaders: ['Retry-After', 'X-Request-Id'],
    maxAge: 600,
}));
app.use(globalRateLimit);
app.use(cookieParser());
app.use(requireJson);
app.use(express.json({ limit: config.bodyLimit }));
app.use(originCheck);
// Refus par défaut : un seul garde pour toutes les routes, liste blanche dans security/publicRoutes.ts
app.use(authenticate);
// Après l'authentification : sans jeton, une route protégée répond 401 avant tout contrôle CSRF
app.use(csrfProtection);

app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok' });
});

// Routeurs montés : listés ici pour que tests/routes.test.ts puisse énumérer toutes les routes
export const mountedRouters = [
    { prefix: '/api/auth', router: authRoutes },
] as const;

for (const { prefix, router } of mountedRouters) {
    app.use(prefix, router);
}

// Toujours en dernier
app.use(notFoundHandler);
app.use(errorHandler);
