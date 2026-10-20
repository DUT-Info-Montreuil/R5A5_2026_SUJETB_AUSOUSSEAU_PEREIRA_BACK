import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { authenticate } from '../src/middlewares/authenticate.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { accountQuota } from '../src/middlewares/rateLimits.js';
import { registerUser } from './helpers.js';

// Aucune opération consommatrice n'existe encore (création de tournoi à venir) : route factice
const testApp = express();
testApp.use(authenticate);
testApp.post('/expensive', accountQuota('expensive', 2, 60_000), (req, res) => {
    res.status(201).json({ ok: true });
});
testApp.use(errorHandler);

describe('quota par compte', () => {
    it('compte par utilisateur, pas par IP', async () => {
        const alice = await registerUser();
        const bob = await registerUser({ username: 'bob', email: 'bob@example.com' });
        const call = (token: string) => request(testApp).post('/expensive').set('Authorization', `Bearer ${token}`);

        expect((await call(alice.accessToken)).status).toBe(201);
        expect((await call(alice.accessToken)).status).toBe(201);
        const third = await call(alice.accessToken);
        expect(third.status).toBe(429);
        expect(third.headers['retry-after']).toBeDefined();
        expect((await call(bob.accessToken)).status).toBe(201);
    });
});
