import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { db } from '../src/db.js';
import { registerUser, validUser } from './helpers.js';

describe('POST /api/auth/register', () => {
    it('crée un compte et renvoie un access token et l\'utilisateur public', async () => {
        const res = await request(app).post('/api/auth/register').send(validUser);

        expect(res.status).toBe(201);
        expect(typeof res.body.accessToken).toBe('string');
        expect(res.body.expiresIn).toBe(900);
        expect(res.body.user).toEqual({
            id: expect.stringMatching(/^[0-9a-f-]{36}$/),
            username: 'alice',
            email: 'alice@example.com',
            role: 'user',
            isAdmin: false,
            createdAt: expect.any(String),
        });
        expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    });

    it('limite l\'access token aux claims prévus, sans donnée personnelle', async () => {
        const { accessToken, user } = await registerUser();
        const payload = jwt.decode(accessToken) as Record<string, unknown>;

        expect(payload.sub).toBe(user.id);
        expect(payload.type).toBe('access');
        expect(payload.role).toBe('user');
        expect(payload.exp).toBe((payload.iat as number) + 900);
        expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'jti', 'nbf', 'role', 'sub', 'type', 'ver']);
        expect(JSON.stringify(payload)).not.toMatch(/alice|example\.com|argon2/);
    });

    it('refuse un email déjà pris (409), même avec une casse différente', async () => {
        await registerUser();
        const res = await request(app)
            .post('/api/auth/register')
            .send({ ...validUser, username: 'bob', email: 'ALICE@example.com' });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('EMAIL_TAKEN');
    });

    it('refuse un username déjà pris (409)', async () => {
        await registerUser();
        const res = await request(app)
            .post('/api/auth/register')
            .send({ ...validUser, email: 'autre@example.com' });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('USERNAME_TAKEN');
    });

    it('renvoie 400 VALIDATION_ERROR avec le détail des champs', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ username: 'ab', email: 'pas-un-email', password: 'court' });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        const fields = res.body.error.details.map((d: { field: string }) => d.field).sort();
        expect(fields).toEqual(['email', 'password', 'username']);
    });

    it('rejette is_admin / isAdmin envoyés dans le body (400, aucun compte créé)', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ ...validUser, is_admin: 1, isAdmin: true });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
    });

    it('renvoie 400 INVALID_JSON sur un body mal formé', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .set('Content-Type', 'application/json')
            .send('{ pas du json');

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_JSON');
    });
});

describe('POST /api/auth/login', () => {
    it('connecte avec les bons identifiants', async () => {
        await registerUser();
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: validUser.email, password: validUser.password });

        expect(res.status).toBe(200);
        expect(typeof res.body.accessToken).toBe('string');
        expect(res.body.user.email).toBe(validUser.email);
        expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    });

    it('refuse un mauvais mot de passe (401 INVALID_CREDENTIALS)', async () => {
        await registerUser();
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: validUser.email, password: 'mauvais-mdp' });

        expect(res.status).toBe(401);
        expect(res.body.error).toEqual({ code: 'INVALID_CREDENTIALS', message: 'Identifiants invalides' });
    });

    it('renvoie exactement la même erreur pour un email inconnu et un mauvais mot de passe', async () => {
        await registerUser();
        const wrongPassword = await request(app)
            .post('/api/auth/login')
            .send({ email: validUser.email, password: 'mauvais-mdp' });
        const unknownEmail = await request(app)
            .post('/api/auth/login')
            .send({ email: 'inconnu@example.com', password: 'mauvais-mdp' });

        expect(unknownEmail.status).toBe(wrongPassword.status);
        expect(unknownEmail.body).toEqual(wrongPassword.body);
    });

    it('renvoie 400 VALIDATION_ERROR si des champs manquent', async () => {
        const res = await request(app).post('/api/auth/login').send({});

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
});

describe('GET /api/auth/me', () => {
    it('renvoie l\'utilisateur connecté', async () => {
        const { accessToken, user } = await registerUser();
        const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.user.id).toBe(user.id);
        expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    });

    it('refuse sans token (401 UNAUTHORIZED)', async () => {
        const res = await request(app).get('/api/auth/me');

        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('refuse un header sans le préfixe Bearer (401)', async () => {
        const { accessToken } = await registerUser();
        const res = await request(app).get('/api/auth/me').set('Authorization', accessToken);

        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('refuse un token mal formé (401 INVALID_TOKEN)', async () => {
        const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer nimportequoi');

        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('INVALID_TOKEN');
    });

    it('refuse un token signé avec un autre secret (401 INVALID_TOKEN)', async () => {
        const { accessToken } = await registerUser();
        const forged = jwt.sign(jwt.decode(accessToken) as object, 'mauvais-secret-mauvais-secret-mauvais-secret');
        const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`);

        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('INVALID_TOKEN');
    });

    it('refuse un token expiré (401 TOKEN_EXPIRED)', async () => {
        const { user } = await registerUser();
        const now = Math.floor(Date.now() / 1000);
        const expired = jwt.sign(
            { sub: user.id, jti: crypto.randomUUID(), type: 'access', role: 'user', ver: 0, iat: now - 960, nbf: now - 960, exp: now - 60 },
            process.env.JWT_SECRET!,
        );
        const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`);

        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    });

    it('refuse le token d\'un compte supprimé (401 INVALID_TOKEN)', async () => {
        const { accessToken, user } = await registerUser();
        db.prepare('DELETE FROM users WHERE public_id = ?').run(user.id);
        const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);

        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('INVALID_TOKEN');
    });
});

describe('Routes inconnues', () => {
    it('renvoie 401 sans token : refus par défaut, l\'existence d\'une route n\'est pas révélée', async () => {
        const res = await request(app).get('/api/nexiste-pas');

        expect(res.status).toBe(401);
    });

    it('renvoie 404 NOT_FOUND au format standard avec un token valide', async () => {
        const { accessToken } = await registerUser();
        const res = await request(app).get('/api/nexiste-pas').set('Authorization', `Bearer ${accessToken}`);

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
    });
});
