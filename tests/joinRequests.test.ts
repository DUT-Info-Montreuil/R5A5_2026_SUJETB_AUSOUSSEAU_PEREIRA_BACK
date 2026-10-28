import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './context.js';
import { db } from './context.js';
import { bearer, createTeam, createTournament, quickUser, type TestUser } from './helpers.js';

async function apply(teamId: number, user: TestUser) {
    return request(app).post(`/api/teams/${teamId}/join-requests`).set(...bearer(user));
}

describe('POST /api/teams/:id/join-requests (B-06, B-07)', () => {
    it('refuse un visiteur (401)', async () => {
        const t = createTournament();
        const team = createTeam(t.id);
        expect((await request(app).post(`/api/teams/${team.id}/join-requests`)).status).toBe(401);
    });

    it('crée une demande en attente, une seule à la fois', async () => {
        const t = createTournament();
        const team = createTeam(t.id);
        const player = quickUser();

        const res = await apply(team.id, player);
        expect(res.status).toBe(201);
        expect(res.body.joinRequest).toMatchObject({ status: 'pending', user: { id: player.id } });

        const again = await apply(team.id, player);
        expect(again.status).toBe(409);
        expect(again.body.error.code).toBe('REQUEST_ALREADY_PENDING');
    });

    it('refuse un joueur déjà dans une équipe du tournoi et une équipe complète (409)', async () => {
        const t = createTournament();
        const team = createTeam(t.id);
        const other = createTeam(t.id);
        expect((await apply(team.id, other.captain)).body.error.code).toBe('ALREADY_IN_TEAM');

        const full = createTeam(t.id, 5);
        expect((await apply(full.id, quickUser())).body.error.code).toBe('TEAM_FULL');
    });
});

describe('Accepter / refuser (B-08, B-10)', () => {
    it('seul le capitaine décide : 403 pour le demandeur, un membre ou un extérieur', async () => {
        const t = createTournament();
        const team = createTeam(t.id, 2);
        const player = quickUser();
        const { id } = (await apply(team.id, player)).body.joinRequest;

        for (const user of [player, team.members[0]!, quickUser(), createTeam(t.id).captain]) {
            expect((await request(app).post(`/api/join-requests/${id}/accept`).set(...bearer(user))).status).toBe(403);
            expect((await request(app).post(`/api/join-requests/${id}/reject`).set(...bearer(user))).status).toBe(403);
        }
        expect((await request(app).post(`/api/join-requests/${id}/accept`)).status).toBe(401);
    });

    it('accepter ajoute le membre et annule ses autres demandes du tournoi', async () => {
        const t = createTournament();
        const team = createTeam(t.id);
        const other = createTeam(t.id);
        const player = quickUser();
        const { id } = (await apply(team.id, player)).body.joinRequest;
        await apply(other.id, player);

        const res = await request(app).post(`/api/join-requests/${id}/accept`).set(...bearer(team.captain));
        expect(res.status).toBe(200);
        expect(res.body.joinRequest.status).toBe('accepted');
        expect((await request(app).get(`/api/teams/${team.id}`)).body.team.members).toHaveLength(2);

        const pending = await request(app).get(`/api/teams/${other.id}/join-requests`).set(...bearer(other.captain));
        expect(pending.body.joinRequests).toEqual([]);

        const twice = await request(app).post(`/api/join-requests/${id}/accept`).set(...bearer(team.captain));
        expect(twice.status).toBe(409);
    });

    it('refuse d\'accepter dans une équipe déjà à 5 (409)', async () => {
        const t = createTournament();
        const team = createTeam(t.id, 4);
        const { id: first } = (await apply(team.id, quickUser())).body.joinRequest;
        const { id: second } = (await apply(team.id, quickUser())).body.joinRequest;

        expect((await request(app).post(`/api/join-requests/${first}/accept`).set(...bearer(team.captain))).status).toBe(200);
        const res = await request(app).post(`/api/join-requests/${second}/accept`).set(...bearer(team.captain));
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('TEAM_FULL');
    });
});

describe('DELETE /api/join-requests/:id', () => {
    it('seul l\'auteur annule, pas même le capitaine (403)', async () => {
        const t = createTournament();
        const team = createTeam(t.id);
        const player = quickUser();
        const { id } = (await apply(team.id, player)).body.joinRequest;

        expect((await request(app).delete(`/api/join-requests/${id}`).set(...bearer(team.captain))).status).toBe(403);
        expect((await request(app).delete(`/api/join-requests/${id}`).set(...bearer(quickUser()))).status).toBe(403);
        expect((await request(app).delete(`/api/join-requests/${id}`).set(...bearer(player))).status).toBe(204);

        const row = db.prepare('SELECT status FROM join_requests WHERE id = ?').get(id) as { status: string };
        expect(row.status).toBe('cancelled');
    });
});
