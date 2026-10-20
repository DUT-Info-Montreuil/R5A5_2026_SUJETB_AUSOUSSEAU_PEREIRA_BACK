import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// Configuration lue au chargement : on l'ajuste avant l'import de l'application
vi.hoisted(() => {
    process.env.FORCE_HTTPS = 'true';
    process.env.TRUST_PROXY = '1';
});

const { app } = await import('../src/app.js');

describe('HTTPS obligatoire', () => {
    it('redirige une lecture HTTP vers HTTPS (308), sans corps HTML', async () => {
        const res = await request(app).get('/api/health?x=1').set('Host', 'api.example');

        expect(res.status).toBe(308);
        expect(res.headers.location).toBe('https://api.example/api/health?x=1');
        expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('refuse une écriture en HTTP (403)', async () => {
        const res = await request(app).post('/api/auth/login').send({});

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('HTTPS_REQUIRED');
    });

    it('laisse passer une requête arrivée en HTTPS au proxy de confiance', async () => {
        const res = await request(app).get('/api/health').set('X-Forwarded-Proto', 'https');

        expect(res.status).toBe(200);
    });
});
