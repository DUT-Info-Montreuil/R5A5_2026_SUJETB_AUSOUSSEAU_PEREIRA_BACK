import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './context.js';
import { registerUser, setAdmin } from './helpers.js';

// Garde de rôle, testée sur une route admin réelle
const newGame = { name: 'Rocket League', roles: ['Attaquant', 'Gardien'] };

describe('Garde administrateur', () => {
    it('refuse un utilisateur non admin (403 FORBIDDEN)', async () => {
        const { token } = await registerUser();
        const res = await request(app).post('/api/games').set('Authorization', `Bearer ${token}`).send(newGame);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('laisse passer un admin', async () => {
        const { token, user } = await registerUser();
        setAdmin(user.id, true);
        const res = await request(app).post('/api/games').set('Authorization', `Bearer ${token}`).send(newGame);

        expect(res.status).toBe(201);
    });

    it('refuse sans token (401) : l\'authentification passe avant le rôle', async () => {
        const res = await request(app).post('/api/games').send(newGame);

        expect(res.status).toBe(401);
    });

    it('prend en compte immédiatement un admin rétrogradé, même avec un token émis avant', async () => {
        const { token, user } = await registerUser();
        setAdmin(user.id, true);
        setAdmin(user.id, false);
        const res = await request(app).post('/api/games').set('Authorization', `Bearer ${token}`).send(newGame);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
    });
});
