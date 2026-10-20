import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { requestId } from '../src/middlewares/requestId.js';
import { post, validUser } from './helpers.js';

const FRONT = 'http://localhost:5173';

describe('headers de réponse', () => {
    it('pose les headers de sécurité sur toutes les réponses, y compris les erreurs', async () => {
        for (const res of [await request(app).get('/api/health'), await request(app).get('/api/nexiste-pas')]) {
            expect(res.headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
            expect(res.headers['x-content-type-options']).toBe('nosniff');
            expect(res.headers['x-frame-options']).toBe('DENY');
            expect(res.headers['content-security-policy']).toBe("default-src 'none'");
            expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
            expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
        }
    });

    it('n\'annonce ni la technologie ni sa version', async () => {
        const res = await request(app).get('/api/health');

        expect(res.headers['x-powered-by']).toBeUndefined();
        expect(res.headers.server).toBeUndefined();
    });
});

describe('CORS', () => {
    it('autorise l\'origine du front avec credentials, jamais `*`', async () => {
        const res = await request(app)
            .options('/api/auth/login')
            .set('Origin', FRONT)
            .set('Access-Control-Request-Method', 'POST')
            .set('Access-Control-Request-Headers', 'content-type,x-csrf-token,authorization');

        expect(res.status).toBe(204);
        expect(res.headers['access-control-allow-origin']).toBe(FRONT);
        expect(res.headers['access-control-allow-credentials']).toBe('true');
        expect(res.headers['access-control-allow-headers']).toBe('Content-Type,Authorization,X-CSRF-Token');
    });

    it('n\'autorise pas une autre origine', async () => {
        const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');

        expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
});

describe('entrées', () => {
    it('refuse un Content-Type autre que JSON (415)', async () => {
        const res = await post('/api/auth/login')
            .set('Content-Type', 'application/x-www-form-urlencoded')
            .send('email=a@b.c&password=x');

        expect(res.status).toBe(415);
        expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('refuse un corps de plus de 100 ko (413)', async () => {
        const res = await post('/api/auth/register')
            .send({ ...validUser, username: 'x'.repeat(110_000) });

        expect(res.status).toBe(413);
        expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });
});

describe('erreurs 500', () => {
    const testApp = express();
    testApp.use(requestId);
    testApp.get('/boom', () => {
        throw new Error('connexion à postgres://admin:hunter2@db échouée');
    });
    testApp.use(errorHandler);

    it('renvoient un message générique avec un identifiant de requête, le détail va dans les logs', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const res = await request(testApp).get('/boom');

        expect(res.status).toBe(500);
        expect(res.body).toEqual({
            error: { code: 'INTERNAL_ERROR', message: 'Erreur interne du serveur', requestId: res.headers['x-request-id'] },
        });
        expect(JSON.stringify(res.body)).not.toMatch(/hunter2|postgres|Error/);
        expect(spy).toHaveBeenCalledWith(expect.stringContaining(res.headers['x-request-id']));
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('connexion à postgres'));
        spy.mockRestore();
    });
});
