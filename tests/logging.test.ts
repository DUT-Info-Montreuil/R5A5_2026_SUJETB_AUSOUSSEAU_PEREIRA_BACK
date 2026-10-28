import { Writable } from 'node:stream';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createContainer } from '../src/container.js';
import { PinoLogger } from '../src/shared/infrastructure/logger.js';
import { config, db } from './context.js';
import { bearer, quickUser } from './helpers.js';

/** Application dont les logs sont capturés ; `overrides` remplace des services pour simuler une panne. */
function capture(overrides: object = {}) {
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({
        write(chunk, encoding, done) {
            for (const line of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(line));
            done();
        },
    });
    const logger = new PinoLogger('info', stream);
    const container = { ...createContainer(db, config, logger), ...overrides };
    return { lines, app: createApp(container as ReturnType<typeof createContainer>, config) };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('Journalisation', () => {
    it('une ligne JSON par requête, avec les champs nommés du cours', async () => {
        const { lines, app } = capture();
        const user = quickUser();
        await request(app).get('/api/tournaments/999?x=1').set(...bearer(user));
        await flush();

        const line = lines.find((l) => l.message === 'request_rejected')!;
        expect(line).toMatchObject({
            level: 'WARNING',
            method: 'GET',
            path: '/api/tournaments/999',
            route: '/api/tournaments/:id',
            query: 'x=1',
            status: 404,
            exception: 'NotFoundError',
            error: 'Tournoi introuvable',
        });
        expect(line.timestamp).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
        expect(line.duration_ms).toEqual(expect.any(Number));
        expect(line.size_bytes).toBeGreaterThan(0);
        expect(line.request_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(line).not.toHaveProperty('pid');
    });

    it('les événements métier portent le request_id de la requête', async () => {
        const { lines, app } = capture();
        const admin = quickUser(true);
        await request(app).post('/api/games').set(...bearer(admin)).send({ name: 'Valorant', roles: ['Duelist'] });
        await flush();

        const event = lines.find((l) => l.message === 'game_created')!;
        const requestLine = lines.find((l) => l.message === 'request_completed')!;
        expect(event.level).toBe('INFO');
        expect(event.request_id).toBe(requestLine.request_id);
        expect(requestLine.user).toBe(admin.id);
    });

    it('ne journalise ni mot de passe, ni jeton, ni email', async () => {
        const { lines, app } = capture();
        await request(app)
            .post('/api/auth/login')
            .set('Authorization', 'Bearer jeton-secret')
            .send({ email: 'marie@exemple.fr', password: 'Tr0ub4dour!' });
        await flush();

        const all = JSON.stringify(lines);
        expect(all).not.toContain('Tr0ub4dour');
        expect(all).not.toContain('jeton-secret');
        expect(all).not.toContain('marie@exemple.fr');
        expect(lines.find((l) => l.message === 'login_failed')?.level).toBe('WARNING');
    });

    it('une erreur 500 : statut ERROR et pile d\'appels dans une ligne à part, reliée par request_id', async () => {
        const { lines, app } = capture({ gameService: { list: () => { throw new TypeError('boom'); } } });
        await request(app).get('/api/games');
        await flush();

        const failure = lines.find((l) => l.message === 'unhandled_exception')!;
        const requestLine = lines.find((l) => l.message === 'request_failed')!;
        expect(failure).toMatchObject({ level: 'ERROR', exception: 'TypeError', error: 'boom' });
        expect(failure.stack).toContain('TypeError: boom');
        expect(requestLine).toMatchObject({ level: 'ERROR', status: 500, exception: 'TypeError' });
        expect(failure.request_id).toBe(requestLine.request_id);
    });
});
