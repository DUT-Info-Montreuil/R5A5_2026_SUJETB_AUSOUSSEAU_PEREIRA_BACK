import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './context.js';
import { bearer, createGame, quickUser } from './helpers.js';

const lol = { name: 'League of Legends', roles: ['Top', 'Jungle', 'Mid', 'ADC', 'Support'] };

describe('GET /api/games', () => {
    it('est public et renvoie les jeux avec leurs rôles', async () => {
        createGame(['A', 'B']);
        const res = await request(app).get('/api/games');

        expect(res.status).toBe(200);
        expect(res.body.games).toHaveLength(1);
        expect(res.body.games[0].roles.map((r: { name: string }) => r.name)).toEqual(['A', 'B']);
    });
});

describe('POST /api/games', () => {
    it('refuse un visiteur (401)', async () => {
        const res = await request(app).post('/api/games').send(lol);
        expect(res.status).toBe(401);
    });

    it('refuse un joueur non admin (403)', async () => {
        const res = await request(app).post('/api/games').set(...bearer(quickUser())).send(lol);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('laisse un admin créer un jeu avec ses rôles', async () => {
        const res = await request(app).post('/api/games').set(...bearer(quickUser(true))).send(lol);
        expect(res.status).toBe(201);
        expect(res.body.game.roles).toHaveLength(5);
    });

    it('refuse un nom déjà pris (409) et des rôles en double (422)', async () => {
        const admin = quickUser(true);
        await request(app).post('/api/games').set(...bearer(admin)).send(lol);

        const dup = await request(app).post('/api/games').set(...bearer(admin)).send(lol);
        expect(dup.status).toBe(409);
        expect(dup.body.error.code).toBe('GAME_NAME_TAKEN');

        const bad = await request(app).post('/api/games').set(...bearer(admin)).send({ name: 'X', roles: ['Mid', 'mid'] });
        expect(bad.status).toBe(422);
        expect(bad.body.error.code).toBe('DUPLICATE_ROLES');
    });
});
