import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { generateCsrfToken } from '../src/security/csrf.js';
import { cookieFrom, registerUser, validUser } from './helpers.js';

const login = { email: validUser.email, password: validUser.password };

async function fetchCsrf(existingCookie?: string) {
    const req = request(app).get('/api/auth/csrf');
    const res = await (existingCookie ? req.set('Cookie', existingCookie) : req);
    return { res, token: res.body.csrfToken as string, cookie: cookieFrom(res, 'csrf')! };
}

describe('GET /api/auth/csrf', () => {
    it('renvoie un jeton aléatoire dans le corps et le même dans un cookie lisible (non HttpOnly)', async () => {
        const { res, token, cookie } = await fetchCsrf();

        expect(res.status).toBe(200);
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(cookie).toBe(`csrf=${token}`);
        const setCookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('csrf='))!;
        expect(setCookie).not.toMatch(/HttpOnly/);
        expect(setCookie).toMatch(/; Path=\//);
        expect(setCookie).toMatch(/; SameSite=Lax/); // réglage de test (dev) ; None + Secure en production
        expect((await fetchCsrf()).token).not.toBe(token);
    });

    it('réutilise le jeton déjà posé (plusieurs onglets)', async () => {
        const first = await fetchCsrf();
        const again = await fetchCsrf(first.cookie);

        expect(again.token).toBe(first.token);
    });
});

describe('protection CSRF (double-submit)', () => {
    it('login sans jeton anti-CSRF : 403 (login CSRF)', async () => {
        await registerUser();
        const res = await request(app).post('/api/auth/login').send(login);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('CSRF_INVALID');
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('csrf_rejected'));
    });

    it('register sans jeton anti-CSRF : 403', async () => {
        const res = await request(app).post('/api/auth/register').send(validUser);

        expect(res.status).toBe(403);
    });

    it('cookie présent mais header X-CSRF-Token absent : 403', async () => {
        const { cookie } = await fetchCsrf();
        const res = await request(app).post('/api/auth/logout').set('Cookie', cookie);

        expect(res.status).toBe(403);
    });

    it('header présent mais cookie absent : 403', async () => {
        const { token } = await fetchCsrf();
        const res = await request(app).post('/api/auth/logout').set('X-CSRF-Token', token);

        expect(res.status).toBe(403);
    });

    it('valeur différente du cookie : 403', async () => {
        const { cookie } = await fetchCsrf();
        const res = await request(app)
            .post('/api/auth/logout')
            .set('Cookie', cookie)
            .set('X-CSRF-Token', generateCsrfToken());

        expect(res.status).toBe(403);
    });

    it('bonne valeur : la requête passe (parcours complet du front)', async () => {
        await registerUser();
        const { token, cookie } = await fetchCsrf();

        const res = await request(app)
            .post('/api/auth/login')
            .set('Cookie', cookie)
            .set('X-CSRF-Token', token)
            .send(login);

        expect(res.status).toBe(200);
    });

    it('ne vérifie pas les méthodes sûres', async () => {
        const { accessToken } = await registerUser();

        expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);
        expect((await request(app).head('/api/health')).status).toBe(200);
    });
});

describe('vérification d\'Origin (au-delà du cours)', () => {
    it('refuse une requête non sûre venant d\'une origine non autorisée, même avec un jeton CSRF valide', async () => {
        const { token, cookie } = await fetchCsrf();
        const res = await request(app)
            .post('/api/auth/logout')
            .set('Origin', 'https://evil.example')
            .set('Cookie', cookie)
            .set('X-CSRF-Token', token);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    });

    it('accepte l\'origine du front', async () => {
        const { token, cookie } = await fetchCsrf();
        const res = await request(app)
            .post('/api/auth/logout')
            .set('Origin', 'http://localhost:5173')
            .set('Cookie', cookie)
            .set('X-CSRF-Token', token);

        expect(res.status).toBe(204);
    });

    it('refuse l\'origine opaque `null` (iframe sandbox, redirections)', async () => {
        const { token, cookie } = await fetchCsrf();
        const res = await request(app)
            .post('/api/auth/logout')
            .set('Origin', 'null')
            .set('Cookie', cookie)
            .set('X-CSRF-Token', token);

        expect(res.status).toBe(403);
    });
});
