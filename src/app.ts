import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';

export const app: Express = express();

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok' });
});