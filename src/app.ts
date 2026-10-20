import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import { config } from './config.js'; // plante au démarrage si la configuration est incomplète
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { httpsOnly } from './middlewares/httpsOnly.js';
import { requestId } from './middlewares/requestId.js';
import { requireJson } from './middlewares/requireJson.js';
import { securityHeaders } from './middlewares/securityHeaders.js';
import { authRoutes } from './routes/authRoutes.js';

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
app.use(requireJson);
app.use(express.json({ limit: config.bodyLimit }));

app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);

// Toujours en dernier
app.use(notFoundHandler);
app.use(errorHandler);
