import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { requireAdmin } from '../src/middlewares/requireAdmin.js';
import { requireAuth } from '../src/middlewares/requireAuth.js';
import { registerUser, setAdmin } from './helpers.js';

// Aucune route admin n'existe encore : on monte une route factice
const testApp = express();
testApp.get('/admin-only', requireAuth, requireAdmin, (req, res) => {
    res.json({ ok: true });
});
testApp.use(errorHandler);

describe('requireAdmin', () => {
    it('refuse un utilisateur non admin (403 FORBIDDEN)', async () => {
        const { token } = await registerUser();
        const res = await request(testApp).get('/admin-only').set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('laisse passer un admin', async () => {
        const { token, user } = await registerUser();
        setAdmin(user.id, true);
        const res = await request(testApp).get('/admin-only').set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
    });

    it('refuse sans token (401) : requireAuth passe avant', async () => {
        const res = await request(testApp).get('/admin-only');

        expect(res.status).toBe(401);
    });

    it('prend en compte immédiatement un admin rétrogradé, même avec un token émis avant', async () => {
        const { token, user } = await registerUser();
        setAdmin(user.id, true);
        expect((await request(testApp).get('/admin-only').set('Authorization', `Bearer ${token}`)).status).toBe(200);

        setAdmin(user.id, false);
        const res = await request(testApp).get('/admin-only').set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
    });
});
