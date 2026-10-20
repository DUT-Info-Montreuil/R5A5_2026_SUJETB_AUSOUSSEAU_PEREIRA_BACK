import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// Limites lues au chargement : on remet les valeurs de production avant d'importer l'application
vi.hoisted(() => {
    process.env.RATE_LIMIT_LOGIN_PER_MIN = '5';
    process.env.RATE_LIMIT_REGISTER_PER_MIN = '5';
    process.env.RATE_LIMIT_REFRESH_PER_MIN = '10';
});

const { app } = await import('../src/app.js');
const { post } = await import('./helpers.js');

describe('limitation de débit par IP', () => {
    it('login : 5 par minute, puis 429 avec Retry-After, quel que soit le compte visé', async () => {
        const statuses = [];
        for (let i = 0; i < 6; i++) {
            const res = await post('/api/auth/login').send({ email: `u${i}@example.com`, password: 'x' });
            statuses.push(res.status);
            if (i === 5) {
                expect(res.body.error.code).toBe('RATE_LIMITED');
                expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
            }
        }
        expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('rate_limited'));
    });

    it('refresh : 10 par minute, puis 429', async () => {
        const statuses = [];
        for (let i = 0; i < 11; i++) statuses.push((await post('/api/auth/refresh')).status);

        expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
        expect(statuses[10]).toBe(429);
    });

    it('register : 5 par minute, puis 429', async () => {
        const statuses = [];
        for (let i = 0; i < 6; i++) statuses.push((await post('/api/auth/register').send({})).status);

        expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
    });

    it('limite globale : expose les en-têtes RateLimit sur toutes les routes', async () => {
        const res = await request(app).get('/api/health');

        expect(res.headers['ratelimit-policy']).toMatch(/"global"/);
    });
});
