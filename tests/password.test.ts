import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { db } from '../src/db.js';
import { hashPassword, needsRehash, verifyPassword } from '../src/security/password.js';
import { post, validUser } from './helpers.js';

function register(password: string) {
    return post('/api/auth/register').send({ ...validUser, password });
}

describe('hashPassword / verifyPassword', () => {
    it('produit une empreinte argon2id salée, différente à chaque appel', async () => {
        const a = await hashPassword('un mot de passe solide');
        const b = await hashPassword('un mot de passe solide');

        expect(a).toMatch(/^\$argon2id\$/);
        expect(a).not.toBe(b);
        expect(await verifyPassword(a, 'un mot de passe solide')).toBe(true);
        expect(await verifyPassword(a, 'un autre mot de passe')).toBe(false);
    });

    it('renvoie false (sans lever) sur une empreinte corrompue', async () => {
        expect(await verifyPassword('pas-une-empreinte', 'x')).toBe(false);
        expect(await verifyPassword('$argon2id$v=19$cassé', 'x')).toBe(false);
    });

    it('demande un rehachage pour une ancienne empreinte bcrypt', async () => {
        expect(needsRehash(bcrypt.hashSync('x', 4))).toBe(true);
        expect(needsRehash(await hashPassword('x'))).toBe(false);
    });
});

describe('politique de mot de passe à l\'inscription', () => {
    it('refuse moins de 12 caractères', async () => {
        const res = await register('onze-caract');

        expect(res.status).toBe(400);
        expect(res.body.error.details).toEqual([{ field: 'password', message: expect.stringMatching(/12/) }]);
    });

    it('refuse un mot de passe connu des fuites publiques, quelle que soit la casse', async () => {
        for (const password of ['password1234', 'PassWord1234', 'motdepasse123']) {
            const res = await register(password);
            expect(res.status).toBe(400);
            expect(res.body.error.details[0].message).toMatch(/fuites/);
        }
    });

    it('n\'impose aucun jeu de caractères et accepte espaces, accents et emoji', async () => {
        const res = await register('je suis une phrase de passe très longue 🐎');

        expect(res.status).toBe(201);
    });

    it('accepte 256 caractères, refuse au-delà (protection anti-DoS)', async () => {
        expect((await register('a1'.repeat(128))).status).toBe(201);
        db.exec('DELETE FROM users');
        expect((await register('a1'.repeat(128) + 'b')).status).toBe(400);
    });
});

describe('migration des anciennes empreintes au login', () => {
    it('rehache en argon2id une empreinte bcrypt après un login réussi', async () => {
        db.prepare('INSERT INTO users (public_id, username, email, password_hash) VALUES (?, ?, ?, ?)').run(
            'b1e7a8b4-0c55-4b8e-9b77-0b2b7f6d1c11',
            'ancien',
            'ancien@example.com',
            bcrypt.hashSync('ancien-mot-de-passe', 4),
        );

        const res = await post('/api/auth/login')
            .send({ email: 'ancien@example.com', password: 'ancien-mot-de-passe' });

        expect(res.status).toBe(200);
        const row = db.prepare("SELECT password_hash FROM users WHERE username = 'ancien'").get() as { password_hash: string };
        expect(row.password_hash).toMatch(/^\$argon2id\$/);
        expect(await verifyPassword(row.password_hash, 'ancien-mot-de-passe')).toBe(true);
    });

    it('ne touche pas à l\'empreinte bcrypt après un échec', async () => {
        const legacy = bcrypt.hashSync('ancien-mot-de-passe', 4);
        db.prepare('INSERT INTO users (public_id, username, email, password_hash) VALUES (?, ?, ?, ?)').run(
            'b1e7a8b4-0c55-4b8e-9b77-0b2b7f6d1c12',
            'ancien',
            'ancien@example.com',
            legacy,
        );

        await post('/api/auth/login').send({ email: 'ancien@example.com', password: 'mauvais' });

        const row = db.prepare("SELECT password_hash FROM users WHERE username = 'ancien'").get() as { password_hash: string };
        expect(row.password_hash).toBe(legacy);
    });
});
