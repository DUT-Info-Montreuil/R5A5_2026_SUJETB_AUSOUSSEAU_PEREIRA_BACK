import { describe, expect, it, vi } from 'vitest';

// Réglage de production « deux domaines » : on l'applique avant d'importer l'application
vi.hoisted(() => {
    process.env.COOKIE_SECURE = 'true';
    process.env.COOKIE_SAMESITE = 'none';
});

const { post, validUser } = await import('./helpers.js');
const request = (await import('supertest')).default;
const { app } = await import('../src/app.js');

function setCookies(res: { headers: Record<string, unknown> }): string[] {
    return res.headers['set-cookie'] as string[];
}

describe('cookies en configuration deux domaines', () => {
    it('refresh : HttpOnly; Secure; SameSite=None; Path=/api/auth; Max-Age=2592000', async () => {
        const res = await post('/api/auth/register').send(validUser);
        const refresh = setCookies(res).find((c) => c.startsWith('refresh_token='))!;

        for (const attr of ['HttpOnly', 'Secure', 'SameSite=None', 'Path=/api/auth', 'Max-Age=2592000']) {
            expect(refresh).toContain(`; ${attr}`);
        }
        expect(refresh.length).toBeLessThan(4096);
    });

    it('csrf : Secure; SameSite=None, sans HttpOnly', async () => {
        const res = await request(app).get('/api/auth/csrf');
        const csrf = setCookies(res).find((c) => c.startsWith('csrf='))!;

        expect(csrf).toContain('; Secure');
        expect(csrf).toContain('; SameSite=None');
        expect(csrf).not.toContain('HttpOnly');
    });
});
