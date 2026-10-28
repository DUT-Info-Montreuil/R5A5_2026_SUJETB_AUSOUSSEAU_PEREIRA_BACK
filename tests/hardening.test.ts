import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { apiRoutes, createApp } from '../src/app.js';
import { app, config, container } from './context.js';
import { bearer, closedTournament, createTeam, createTournament, quickUser, registerUser, validUser } from './helpers.js';

function concretePath(path: string): string {
    return path.replace(/:userId/g, '1').replace(/:id/g, '1');
}

describe('Refus par défaut', () => {
    it('chaque route non publique refuse une requête sans jeton (401)', async () => {
        const protectedRoutes = apiRoutes(container).filter((r) => r.access !== 'public');
        expect(protectedRoutes.length).toBeGreaterThan(15);
        for (const r of protectedRoutes) {
            const res = await request(app)[r.method](concretePath(r.path)).send({});
            expect(res.status, `${r.method.toUpperCase()} ${r.path}`).toBe(401);
        }
    });

    it('chaque route admin refuse un joueur connecté (403)', async () => {
        const player = quickUser();
        for (const r of apiRoutes(container).filter((route) => route.access === 'admin')) {
            const res = await request(app)[r.method](concretePath(r.path)).set(...bearer(player)).send({});
            expect(res.status, `${r.method.toUpperCase()} ${r.path}`).toBe(403);
        }
    });
});

describe('Documentation d\'API', () => {
    it('sert une description OpenAPI générée qui couvre toutes les routes', async () => {
        const res = await request(app).get('/openapi.json');
        expect(res.status).toBe(200);
        expect(res.body.openapi).toBe('3.1.0');
        for (const r of apiRoutes(container)) {
            const operation = res.body.paths[r.path.replace(/:(\w+)/g, '{$1}')]?.[r.method];
            expect(operation, `${r.method} ${r.path}`).toBeDefined();
            if (r.access !== 'public') expect(operation.responses['401']).toBeDefined();
        }
    });

    it('sert Swagger UI sur /docs', async () => {
        const res = await request(app).get('/docs/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('swagger');
    });
});

describe('Durcissement', () => {
    it('pose les headers de sécurité et n\'annonce pas la technologie', async () => {
        const res = await request(app).get('/api/health');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('DENY');
        expect(res.headers['content-security-policy']).toBe("default-src 'none'");
        expect(res.headers['strict-transport-security']).toContain('max-age=');
        expect(res.headers['x-powered-by']).toBeUndefined();
        expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('refuse un corps qui n\'est pas du JSON (415)', async () => {
        const res = await request(app).post('/api/auth/login').set('Content-Type', 'text/plain').send('email=a&password=b');
        expect(res.status).toBe(415);
        expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('limite le débit sur les routes de connexion (429, au format d\'erreur de l\'API)', async () => {
        const limited = createApp(container, { ...config, rateLimitAuth: 2 });
        const body = { email: 'x@example.com', password: 'y' };
        await request(limited).post('/api/auth/login').send(body);
        await request(limited).post('/api/auth/login').send(body);
        const res = await request(limited).post('/api/auth/login').send(body);
        expect(res.status).toBe(429);
        expect(res.body.error.code).toBe('RATE_LIMITED');
    });

    it('freine les essais sur un compte : délai qui double, header Retry-After', async () => {
        await registerUser();
        const wrong = { email: validUser.email, password: 'mauvais-mdp' };
        expect((await request(app).post('/api/auth/login').send(wrong)).status).toBe(401);

        const blocked = await request(app).post('/api/auth/login').send({ email: validUser.email, password: validUser.password });
        expect(blocked.status).toBe(429);
        expect(blocked.body.error.code).toBe('TOO_MANY_ATTEMPTS');
        expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    });

    it('refuse un mot de passe présent dans les fuites connues (422)', async () => {
        const res = await request(app).post('/api/auth/register').send({ ...validUser, password: 'password123' });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('PASSWORD_TOO_COMMON');
    });

    it('ne renvoie jamais le détail d\'une erreur 500', async () => {
        const broken = createApp({ ...container, gameService: { list: () => { throw new Error('SELECT secret FROM table'); } } } as never, config);
        const res = await request(broken).get('/api/games');
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Erreur interne du serveur' } });
    });
});

describe('Pagination', () => {
    it('pagine la liste des tournois avec une valeur par défaut', async () => {
        for (let i = 0; i < 3; i++) createTournament();
        const res = await request(app).get('/api/tournaments?limit=2&offset=1');
        expect(res.body.tournaments).toHaveLength(2);
        expect(res.body.pagination).toEqual({ limit: 2, offset: 1, total: 3 });

        const byDefault = await request(app).get('/api/tournaments');
        expect(byDefault.body.pagination.limit).toBe(20);
        expect((await request(app).get('/api/tournaments?limit=1000')).status).toBe(400);
    });

    it('pagine le chat, du plus récent au plus ancien', async () => {
        const t = createTournament();
        const team = createTeam(t.id);
        for (const content of ['un', 'deux', 'trois']) {
            await request(app).post(`/api/teams/${team.id}/messages`).set(...bearer(team.captain)).send({ content });
        }
        const res = await request(app).get(`/api/teams/${team.id}/messages?limit=2`).set(...bearer(team.captain));
        expect(res.body.messages.map((m: { content: string }) => m.content)).toEqual(['trois', 'deux']);
        expect(res.body.pagination.total).toBe(3);
    });
});

describe('B-08 au lancement', () => {
    it('une équipe de 5 dont un joueur n\'a pas de rôle est forfait au premier match', async () => {
        const t = await closedTournament();
        const team = t.teams[0]!;
        container.repositories.teams.setMemberRole(team.id, team.members[0]!.id, null);

        const res = await request(app).post(`/api/tournaments/${t.id}/start`).set(...bearer(t.admin));
        const detail = res.body.tournament;
        expect(detail.teams.find((x: { id: number }) => x.id === team.id).isEliminated).toBe(true);
        expect(detail.matches.filter((m: { round: number; status: string }) => m.round === 1 && m.status === 'finished')).toHaveLength(1);
    });
});
