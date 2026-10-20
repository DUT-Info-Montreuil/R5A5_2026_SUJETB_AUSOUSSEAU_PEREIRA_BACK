import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { db } from '../src/db.js';
import * as authService from '../src/services/authService.js';
import { cookieFrom, internalId, loginUser, registerUser, setAdmin, validUser } from './helpers.js';

function refresh(cookie?: string) {
    const req = request(app).post('/api/auth/refresh');
    return cookie ? req.set('Cookie', cookie) : req;
}

function me(accessToken: string) {
    return request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
}

describe('cookie de refresh', () => {
    it('est HttpOnly, limité à /api/auth, 30 jours, et n\'apparaît jamais dans le corps', async () => {
        const res = await request(app).post('/api/auth/register').send(validUser);
        const setCookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('refresh_token='))!;

        expect(setCookie).toMatch(/; HttpOnly/);
        expect(setCookie).toMatch(/; Path=\/api\/auth/);
        expect(setCookie).toMatch(/; Max-Age=2592000/);
        expect(setCookie).toMatch(/; SameSite=Lax/); // réglage de test (dev) ; None + Secure en production
        const refreshToken = setCookie.split(';')[0].split('=')[1];
        expect(JSON.stringify(res.body)).not.toContain(refreshToken);
        expect(res.body).not.toHaveProperty('refreshToken');
    });

    it('stocke le jti du refresh en base, jamais le jeton', async () => {
        const { refreshCookie, user } = await registerUser();
        const refreshToken = refreshCookie.split('=')[1];
        const claims = jwt.decode(refreshToken) as Record<string, unknown>;

        const rows = db.prepare('SELECT * FROM refresh_tokens').all();
        expect(rows).toEqual([expect.objectContaining({ jti: claims.jti, user_id: internalId(user.id), revoked_at: null })]);
        expect(JSON.stringify(rows)).not.toContain(refreshToken);
        expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'jti', 'nbf', 'sub', 'type', 'ver']);
        expect(claims.type).toBe('refresh');
        expect(claims.exp).toBe((claims.iat as number) + 30 * 24 * 3600);
    });
});

describe('POST /api/auth/refresh', () => {
    it('renvoie un nouvel access token et fait tourner le refresh token', async () => {
        const { refreshCookie } = await registerUser();

        const res = await refresh(refreshCookie);
        expect(res.status).toBe(200);
        expect((await me(res.body.accessToken)).status).toBe(200);

        const rotated = cookieFrom(res, 'refresh_token')!;
        expect(rotated).not.toBe(refreshCookie);
        expect((await refresh(rotated)).status).toBe(200);
    });

    it('refuse sans cookie (401)', async () => {
        expect((await refresh()).status).toBe(401);
    });

    it('refuse un access token, en cookie comme en header Authorization', async () => {
        const { accessToken } = await registerUser();

        const asCookie = await refresh(`refresh_token=${accessToken}`);
        expect(asCookie.status).toBe(401);
        expect(asCookie.body.error.code).toBe('INVALID_TOKEN');

        const asHeader = await request(app).post('/api/auth/refresh').set('Authorization', `Bearer ${accessToken}`);
        expect(asHeader.status).toBe(401);
    });

    it('refuse un refresh révoqué (401)', async () => {
        const { refreshCookie } = await registerUser();
        db.exec('UPDATE refresh_tokens SET revoked_at = \'2026-01-01T00:00:00.000Z\'');

        const res = await refresh(refreshCookie);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('TOKEN_REVOKED');
    });

    it('refuse un refresh signé mais inconnu en base (401)', async () => {
        const { refreshCookie } = await registerUser();
        db.exec('DELETE FROM refresh_tokens');

        expect((await refresh(refreshCookie)).status).toBe(401);
    });

    it('détecte la réutilisation d\'un refresh déjà tourné et révoque toutes les sessions', async () => {
        const first = await registerUser();
        const otherDevice = await loginUser();
        const rotated = cookieFrom(await refresh(first.refreshCookie), 'refresh_token')!;

        // Un voleur rejoue l'ancien refresh
        const replay = await refresh(first.refreshCookie);
        expect(replay.status).toBe(401);
        expect(replay.body.error.code).toBe('TOKEN_REVOKED');

        // Toutes les sessions tombent : refresh tourné, autre appareil, access tokens déjà émis
        expect((await refresh(rotated)).status).toBe(401);
        expect((await refresh(otherDevice.refreshCookie)).status).toBe(401);
        expect((await me(otherDevice.accessToken)).status).toBe(401);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('refresh_reuse_detected'));
        // Une nouvelle connexion fonctionne
        expect((await me((await loginUser()).accessToken)).status).toBe(200);
    });
});

describe('POST /api/auth/logout', () => {
    it('révoque le refresh token et supprime le cookie', async () => {
        const { refreshCookie } = await registerUser();

        const res = await request(app).post('/api/auth/logout').set('Cookie', refreshCookie);
        expect(res.status).toBe(204);
        const cleared = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('refresh_token='))!;
        expect(cleared).toMatch(/^refresh_token=;/);
        expect(cleared).toMatch(/Path=\/api\/auth/);
        expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

        expect((await refresh(refreshCookie)).status).toBe(401);
    });

    it('répond 204 même sans cookie ou avec un jeton invalide', async () => {
        expect((await request(app).post('/api/auth/logout')).status).toBe(204);
        expect((await request(app).post('/api/auth/logout').set('Cookie', 'refresh_token=abc')).status).toBe(204);
    });
});

describe('invalidation par token_version', () => {
    it('un changement de mot de passe invalide access et refresh tokens émis avant', async () => {
        const { accessToken, refreshCookie, user } = await registerUser();

        await authService.changePassword(internalId(user.id), 'nouvelle-phrase-de-passe-7');

        expect((await me(accessToken)).status).toBe(401);
        expect((await refresh(refreshCookie)).status).toBe(401);
        expect((await me((await loginUser(validUser.email, 'nouvelle-phrase-de-passe-7')).accessToken)).status).toBe(200);
    });

    it('le changement de mot de passe applique la politique d\'inscription', async () => {
        const { user } = await registerUser();

        await expect(authService.changePassword(internalId(user.id), 'password1234')).rejects.toThrow();
    });

    it('un changement de rôle invalide access et refresh tokens émis avant', async () => {
        const { accessToken, refreshCookie, user } = await registerUser();

        setAdmin(user.id, true);

        const res = await me(accessToken);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('TOKEN_REVOKED');
        expect((await refresh(refreshCookie)).status).toBe(401);
        // Le refresh révoqué rejoué compte comme une réutilisation : token_version a encore augmenté
        expect(jwt.decode((await loginUser()).accessToken)).toMatchObject({ role: 'admin', ver: 2 });
    });
});
