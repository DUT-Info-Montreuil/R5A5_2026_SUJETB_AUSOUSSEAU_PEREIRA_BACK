import { generateKeyPairSync, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { registerUser } from './helpers.js';

const SECRET = process.env.JWT_SECRET!;

function b64url(value: object): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function me(token: string) {
    return request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
}

describe('vérification de l\'access token', () => {
    it('refuse un jeton `alg: none` (sans signature)', async () => {
        const { accessToken } = await registerUser();
        const payload = accessToken.split('.')[1];
        const unsigned = `${b64url({ alg: 'none', typ: 'JWT' })}.${payload}.`;

        const res = await me(unsigned);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('INVALID_TOKEN');
    });

    it('refuse un jeton signé avec le bon secret mais un autre algorithme (HS512)', async () => {
        const { accessToken } = await registerUser();
        const other = jwt.sign(jwt.decode(accessToken) as object, SECRET, { algorithm: 'HS512' });

        expect((await me(other)).status).toBe(401);
    });

    it('refuse un jeton RS256 (confusion d\'algorithme)', async () => {
        const { accessToken } = await registerUser();
        const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const rsa = jwt.sign(jwt.decode(accessToken) as object, privateKey, { algorithm: 'RS256' });

        expect((await me(rsa)).status).toBe(401);
    });

    it('refuse une signature modifiée', async () => {
        const { accessToken } = await registerUser();
        const [header, payload, signature] = accessToken.split('.');
        const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);

        expect((await me(`${header}.${payload}.${flipped}`)).status).toBe(401);
    });

    it('refuse un payload modifié (élévation de rôle) avec la signature d\'origine', async () => {
        const { accessToken } = await registerUser();
        const [header, payload, signature] = accessToken.split('.');
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());

        expect((await me(`${header}.${b64url({ ...claims, role: 'admin' })}.${signature}`)).status).toBe(401);
    });

    it('refuse un access token expiré (401 TOKEN_EXPIRED)', async () => {
        const { accessToken } = await registerUser();
        const now = Math.floor(Date.now() / 1000);
        const claims = { ...(jwt.decode(accessToken) as object), iat: now - 1000, nbf: now - 1000, exp: now - 1 };

        const res = await me(jwt.sign(claims, SECRET, { algorithm: 'HS256' }));
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    });

    it('refuse un jeton pas encore valide (nbf dans le futur)', async () => {
        const { accessToken } = await registerUser();
        const now = Math.floor(Date.now() / 1000);
        const claims = { ...(jwt.decode(accessToken) as object), nbf: now + 600 };

        expect((await me(jwt.sign(claims, SECRET, { algorithm: 'HS256' }))).status).toBe(401);
    });

    it('refuse un refresh token présenté comme access token', async () => {
        const { refreshCookie } = await registerUser();
        const refreshToken = refreshCookie.split('=')[1];

        const res = await me(refreshToken);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('INVALID_TOKEN');
    });

    it('refuse un jeton correctement signé dont le payload n\'a pas la forme attendue', async () => {
        const { user } = await registerUser();
        const now = Math.floor(Date.now() / 1000);
        const odd = jwt.sign(
            { sub: user.id, jti: randomUUID(), type: 'access', role: 'superadmin', ver: 0, iat: now, nbf: now, exp: now + 60 },
            SECRET,
            { algorithm: 'HS256' },
        );

        expect((await me(odd)).status).toBe(401);
    });

    it('ne lit jamais le jeton dans la query string', async () => {
        const { accessToken } = await registerUser();
        const res = await request(app).get(`/api/auth/me?access_token=${accessToken}&token=${accessToken}`);

        expect(res.status).toBe(401);
    });
});
