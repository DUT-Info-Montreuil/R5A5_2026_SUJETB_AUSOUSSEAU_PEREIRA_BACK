import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './context.js';
import { db } from './context.js';
import {
    bearer,
    closedTournament,
    createGame,
    createTeam,
    createTournament,
    matchesOf,
    quickUser,
} from './helpers.js';

describe('POST /api/tournaments (B-01)', () => {
    it('refuse un visiteur (401) et un joueur (403)', async () => {
        const { id: gameId } = createGame();
        const body = { name: 'Coupe', gameId };

        expect((await request(app).post('/api/tournaments').send(body)).status).toBe(401);
        const res = await request(app).post('/api/tournaments').set(...bearer(quickUser())).send(body);
        expect(res.status).toBe(403);
    });

    it('crée un tournoi avec inscriptions ouvertes', async () => {
        const { id: gameId } = createGame();
        const res = await request(app)
            .post('/api/tournaments')
            .set(...bearer(quickUser(true)))
            .send({ name: 'Coupe', gameId });

        expect(res.status).toBe(201);
        expect(res.body.tournament).toMatchObject({ name: 'Coupe', status: 'registration_open', teams: [], matches: [] });
    });

    it('renvoie 404 pour un jeu inconnu', async () => {
        const res = await request(app)
            .post('/api/tournaments')
            .set(...bearer(quickUser(true)))
            .send({ name: 'Coupe', gameId: 999 });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('GAME_NOT_FOUND');
    });
});

describe('Consultation publique (B-02)', () => {
    it('recherche par nom et par statut sans être connecté', async () => {
        const a = createTournament();
        createTournament();
        db.prepare('UPDATE tournaments SET name = ? WHERE id = ?').run('Grande Finale Régionale', a.id);

        const byName = await request(app).get('/api/tournaments?search=finale');
        expect(byName.status).toBe(200);
        expect(byName.body.tournaments.map((t: { id: number }) => t.id)).toEqual([a.id]);

        const byStatus = await request(app).get('/api/tournaments?status=in_progress');
        expect(byStatus.body.tournaments).toEqual([]);

        expect((await request(app).get('/api/tournaments?status=nimportequoi')).status).toBe(400);
    });

    it('le détail public ne contient aucun email', async () => {
        const t = createTournament();
        createTeam(t.id, 3);
        const res = await request(app).get(`/api/tournaments/${t.id}`);

        expect(res.status).toBe(200);
        expect(res.body.tournament.teams[0].members).toHaveLength(3);
        expect(JSON.stringify(res.body)).not.toMatch(/@|email|password/i);
    });

    it('404 pour un tournoi inconnu, matches vide pendant les inscriptions', async () => {
        expect((await request(app).get('/api/tournaments/999')).status).toBe(404);
        const t = createTournament();
        const res = await request(app).get(`/api/tournaments/${t.id}/matches`);
        expect(res.body.matches).toEqual([]);
    });
});

describe('POST /api/tournaments/:id/close (B-03, B-12)', () => {
    it('refuse un joueur, même capitaine d\'une équipe du tournoi (403)', async () => {
        const t = createTournament();
        const team = createTeam(t.id);
        const res = await request(app).post(`/api/tournaments/${t.id}/close`).set(...bearer(team.captain));
        expect(res.status).toBe(403);
    });

    it('refuse de clore sans exactement 8 équipes (409)', async () => {
        const t = createTournament();
        for (let i = 0; i < 7; i++) createTeam(t.id);
        const res = await request(app).post(`/api/tournaments/${t.id}/close`).set(...bearer(t.admin));
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('NOT_ENOUGH_TEAMS');
    });

    it('génère l\'arbre : 4 quarts prêts avec les 8 équipes, demies et finale en attente', async () => {
        const t = await closedTournament(1);
        const matches = matchesOf(t.id);

        expect(matches).toHaveLength(7);
        const quarters = matches.filter((m) => m.round === 1);
        expect(quarters.every((m) => m.status === 'ready')).toBe(true);
        const seeded = quarters.flatMap((m) => [m.team_a_id, m.team_b_id]).sort();
        expect(seeded).toEqual(t.teams.map((team) => team.id).sort());
        expect(matches.filter((m) => m.round > 1).every((m) => m.status === 'pending' && m.team_a_id === null)).toBe(true);

        const again = await request(app).post(`/api/tournaments/${t.id}/close`).set(...bearer(t.admin));
        expect(again.status).toBe(409);
    });

    it('rejette les demandes d\'adhésion encore en attente', async () => {
        const t = createTournament();
        const teams = Array.from({ length: 8 }, () => createTeam(t.id));
        const applicant = quickUser();
        await request(app).post(`/api/teams/${teams[0]!.id}/join-requests`).set(...bearer(applicant));

        await request(app).post(`/api/tournaments/${t.id}/close`).set(...bearer(t.admin));
        const row = db.prepare('SELECT status FROM join_requests').get() as { status: string };
        expect(row.status).toBe('rejected');
    });
});

describe('POST /api/tournaments/:id/start (B-04)', () => {
    it('refuse un joueur (403) et un tournoi pas encore clos (409)', async () => {
        const t = createTournament();
        expect((await request(app).post(`/api/tournaments/${t.id}/start`).set(...bearer(quickUser()))).status).toBe(403);
        const res = await request(app).post(`/api/tournaments/${t.id}/start`).set(...bearer(t.admin));
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('INVALID_TOURNAMENT_STATUS');
    });

    it('déclare forfait au premier match les équipes incomplètes', async () => {
        const t = createTournament();
        for (let i = 0; i < 7; i++) createTeam(t.id, 5);
        const incomplete = createTeam(t.id, 4);
        await request(app).post(`/api/tournaments/${t.id}/close`).set(...bearer(t.admin));

        const res = await request(app).post(`/api/tournaments/${t.id}/start`).set(...bearer(t.admin));
        expect(res.status).toBe(200);
        expect(res.body.tournament.status).toBe('in_progress');

        const forfeited = matchesOf(t.id).find((m) => m.team_a_id === incomplete.id || m.team_b_id === incomplete.id)!;
        expect(forfeited.status).toBe('finished');
        expect(forfeited.winner_id).not.toBe(incomplete.id);
        const team = res.body.tournament.teams.find((tm: { id: number }) => tm.id === incomplete.id);
        expect(team.isEliminated).toBe(true);
        // Les autres quarts restent à jouer
        expect(matchesOf(t.id).filter((m) => m.round === 1 && m.status === 'ready')).toHaveLength(3);
    });
});
