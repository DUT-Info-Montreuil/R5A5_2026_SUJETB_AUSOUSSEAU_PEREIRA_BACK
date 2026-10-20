import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { authenticate } from '../src/middlewares/authenticate.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { requireRole } from '../src/middlewares/requireRole.js';
import { registerAdmin, registerUser, setAdmin } from './helpers.js';

// Aucune route admin n'existe encore : on monte une route factice derrière le garde global
const testApp = express();
testApp.use(authenticate);
testApp.get('/admin-only', requireRole('admin'), (req, res) => {
    res.json({ ok: true });
});
testApp.use(errorHandler);

describe('requireRole(\'admin\')', () => {
    it('refuse un utilisateur non admin (403 FORBIDDEN)', async () => {
        const { accessToken } = await registerUser();
        const res = await request(testApp).get('/admin-only').set('Authorization', `Bearer ${accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('laisse passer un admin', async () => {
        const { accessToken } = await registerAdmin();
        const res = await request(testApp).get('/admin-only').set('Authorization', `Bearer ${accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
    });

    it('refuse sans token (401) : le garde d\'authentification passe avant', async () => {
        const res = await request(testApp).get('/admin-only');

        expect(res.status).toBe(401);
    });

    it('invalide immédiatement le token d\'un admin rétrogradé (401 TOKEN_REVOKED)', async () => {
        const { accessToken, user } = await registerAdmin();
        expect((await request(testApp).get('/admin-only').set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);

        setAdmin(user.id, false);
        const res = await request(testApp).get('/admin-only').set('Authorization', `Bearer ${accessToken}`);

        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('TOKEN_REVOKED');
    });
});
