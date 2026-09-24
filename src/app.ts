import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import './config.js'; // plante au démarrage si la configuration est incomplète
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { authRoutes } from './routes/authRoutes.js';

export const app: Express = express();

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);

// Toujours en dernier
app.use(notFoundHandler);
app.use(errorHandler);
