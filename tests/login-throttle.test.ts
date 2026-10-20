import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db.js';
import { post, registerUser, validUser } from './helpers.js';

const T0 = new Date('2026-10-20T10:00:00.000Z');

function attempt(password: string, email = validUser.email) {
    return post('/api/auth/login').send({ email, password });
}

beforeEach(() => {
    // Seule l'horloge (Date) est simulée : les sockets et argon2 restent réels
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
});

afterEach(() => {
    vi.useRealTimers();
});

function advance(seconds: number): void {
    vi.setSystemTime(new Date(Date.now() + seconds * 1000));
}

describe('délai par compte après un échec de login', () => {
    it('double à chaque échec : 1 s, 2 s, 4 s, 8 s (429 + Retry-After pendant le délai)', async () => {
        await registerUser();

        for (const expected of [1, 2, 4, 8]) {
            expect((await attempt('mauvais')).status).toBe(401);
            const delayed = await attempt('mauvais');
            expect(delayed.status).toBe(429);
            expect(delayed.body.error.code).toBe('LOGIN_DELAYED');
            expect(delayed.headers['retry-after']).toBe(String(expected));
            advance(expected);
        }
    });

    it('bloque aussi le bon mot de passe pendant le délai, sans compter la tentative', async () => {
        await registerUser();
        await attempt('mauvais');

        expect((await attempt(validUser.password)).status).toBe(429);
        advance(1);
        expect((await attempt(validUser.password)).status).toBe(200);
    });

    it('remet le compteur à zéro après un succès', async () => {
        await registerUser();
        await attempt('mauvais');
        advance(1);
        await attempt('mauvais');
        advance(2);
        expect((await attempt(validUser.password)).status).toBe(200);

        expect(db.prepare('SELECT COUNT(*) AS n FROM login_failures').get()).toEqual({ n: 0 });
        await attempt('mauvais');
        expect((await attempt('mauvais')).headers['retry-after']).toBe('1');
    });

    it('traite une adresse inconnue exactement comme une adresse inscrite', async () => {
        await registerUser();
        const known = [await attempt('mauvais'), await attempt('mauvais')];
        const unknown = [await attempt('mauvais', 'inconnu@example.com'), await attempt('mauvais', 'inconnu@example.com')];

        expect(unknown.map((r) => r.status)).toEqual(known.map((r) => r.status));
        expect(unknown.map((r) => r.body)).toEqual(known.map((r) => r.body));
        expect(unknown[1].headers['retry-after']).toBe(known[1].headers['retry-after']);
    });

    it('indexe le compteur sur l\'email normalisé, stocké haché', async () => {
        await attempt('mauvais', '  Alice@Example.COM ');

        expect((await attempt('mauvais', 'alice@example.com')).status).toBe(429);
        expect(JSON.stringify(db.prepare('SELECT * FROM login_failures').all())).not.toMatch(/alice/i);
    });

    it('ne bloque jamais pour une durée fixe : le délai est plafonné à 15 min puis la connexion reprend', async () => {
        await registerUser();
        for (let i = 0; i < 20; i++) {
            await attempt('mauvais');
            advance(15 * 60);
        }
        await attempt('mauvais');

        expect((await attempt(validUser.password)).headers['retry-after']).toBe('900');
        advance(900);
        expect((await attempt(validUser.password)).status).toBe(200);
    });
});
