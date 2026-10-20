import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { db } from '../src/db.js';
import { cookieFrom, post, registerUser, validUser } from './helpers.js';

const SECRET = process.env.JWT_SECRET!;

describe('aucune donnée sensible dans les réponses', () => {
    it('register, login, refresh, me : ni empreinte, ni mot de passe, ni refresh token, ni secret', async () => {
        const responses = [];
        const reg = await post('/api/auth/register').send(validUser);
        responses.push(reg);
        const login = await post('/api/auth/login').send({ email: validUser.email, password: validUser.password });
        responses.push(login);
        const refreshCookie = cookieFrom(login, 'refresh_token')!;
        const refreshed = await post('/api/auth/refresh', [refreshCookie]);
        responses.push(refreshed);
        responses.push(await request(app).get('/api/auth/me').set('Authorization', `Bearer ${refreshed.body.accessToken}`));

        const hash = (db.prepare('SELECT password_hash FROM users').get() as { password_hash: string }).password_hash;
        const refreshTokens = [cookieFrom(reg, 'refresh_token')!, refreshCookie, cookieFrom(refreshed, 'refresh_token')!]
            .map((c) => c.split('=')[1]);

        for (const res of responses) {
            const body = JSON.stringify(res.body);
            expect(body).not.toMatch(/password|argon2|hash/i);
            expect(body).not.toContain(hash);
            expect(body).not.toContain(validUser.password);
            expect(body).not.toContain(SECRET);
            for (const token of refreshTokens) expect(body).not.toContain(token);
            expect(body).not.toMatch(/"id":\d/); // jamais l'entier interne
        }
    });

    it('le journal de sécurité ne contient ni mot de passe ni email', async () => {
        await registerUser();
        await post('/api/auth/login').send({ email: validUser.email, password: 'mauvais-mot-de-passe' });

        const logged = (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join('\n');
        expect(logged).toContain('login_failed');
        expect(logged).not.toContain('mauvais-mot-de-passe');
        expect(logged).not.toContain(validUser.email);
    });
});

describe('mass assignment', () => {
    it('register refuse `role` (pas de promotion par le corps)', async () => {
        const res = await post('/api/auth/register').send({ ...validUser, role: 'admin' });

        expect(res.status).toBe(400);
        expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
    });

    it('register refuse tout champ hors liste (token_version, public_id...)', async () => {
        for (const extra of [{ token_version: 99 }, { public_id: 'x' }, { password_hash: 'x' }, { id: 1 }]) {
            expect((await post('/api/auth/register').send({ ...validUser, ...extra })).status).toBe(400);
        }
    });

    it('login refuse un champ inconnu', async () => {
        await registerUser();
        const res = await post('/api/auth/login').send({ email: validUser.email, password: validUser.password, role: 'admin' });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
});
