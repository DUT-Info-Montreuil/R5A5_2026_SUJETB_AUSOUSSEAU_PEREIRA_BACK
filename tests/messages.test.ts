import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './context.js';
import { bearer, createTeam, createTournament, matchesOf, quickUser, startedTournament } from './helpers.js';

describe('Chat d\'équipe (B-16)', () => {
    it('lecture et écriture refusées à un visiteur (401) et à un joueur extérieur (403)', async () => {
        const t = createTournament();
        const team = createTeam(t.id);
        const otherCaptain = createTeam(t.id).captain;

        expect((await request(app).get(`/api/teams/${team.id}/messages`)).status).toBe(401);
        expect((await request(app).post(`/api/teams/${team.id}/messages`).send({ content: 'salut' })).status).toBe(401);
        for (const user of [quickUser(), otherCaptain]) {
            expect((await request(app).get(`/api/teams/${team.id}/messages`).set(...bearer(user))).status).toBe(403);
            expect((await request(app).post(`/api/teams/${team.id}/messages`).set(...bearer(user)).send({ content: 'salut' })).status).toBe(403);
        }
    });

    it('les membres écrivent et lisent ; l\'admin lit mais n\'écrit pas', async () => {
        const t = createTournament();
        const team = createTeam(t.id, 2);
        const admin = quickUser(true);

        const posted = await request(app).post(`/api/teams/${team.id}/messages`).set(...bearer(team.members[0]!)).send({ content: 'On joue à 20h' });
        expect(posted.status).toBe(201);
        expect(posted.body.message).toMatchObject({ content: 'On joue à 20h', author: { id: team.members[0]!.id } });

        const read = await request(app).get(`/api/teams/${team.id}/messages`).set(...bearer(team.captain));
        expect(read.body.messages).toHaveLength(1);
        expect((await request(app).get(`/api/teams/${team.id}/messages`).set(...bearer(admin))).status).toBe(200);
        expect((await request(app).post(`/api/teams/${team.id}/messages`).set(...bearer(admin)).send({ content: 'admin' })).status).toBe(403);
    });

    it('B-17 : un joueur exclu perd immédiatement l\'accès', async () => {
        const t = createTournament();
        const team = createTeam(t.id, 2);
        const kicked = team.members[0]!;
        expect((await request(app).get(`/api/teams/${team.id}/messages`).set(...bearer(kicked))).status).toBe(200);

        await request(app).delete(`/api/teams/${team.id}/members/${kicked.id}`).set(...bearer(team.captain));
        expect((await request(app).get(`/api/teams/${team.id}/messages`).set(...bearer(kicked))).status).toBe(403);
        expect((await request(app).post(`/api/teams/${team.id}/messages`).set(...bearer(kicked)).send({ content: 'hé' })).status).toBe(403);
    });

    it('B-18 : chat d\'une équipe éliminée fermé aux membres, toujours lisible par l\'admin', async () => {
        const t = await startedTournament();
        const match = matchesOf(t.id).find((m) => m.round === 1)!;
        const loser = t.teams.find((team) => team.id === match.team_b_id)!;
        await request(app).post(`/api/teams/${loser.id}/messages`).set(...bearer(loser.captain)).send({ content: 'GG' });
        await request(app).post(`/api/matches/${match.id}/result`).set(...bearer(t.admin)).send({ scoreA: 2, scoreB: 0 });

        const read = await request(app).get(`/api/teams/${loser.id}/messages`).set(...bearer(loser.captain));
        expect(read.status).toBe(409);
        expect(read.body.error.code).toBe('TEAM_CHAT_CLOSED');
        expect((await request(app).post(`/api/teams/${loser.id}/messages`).set(...bearer(loser.captain)).send({ content: 'x' })).status).toBe(409);

        const asAdmin = await request(app).get(`/api/teams/${loser.id}/messages`).set(...bearer(t.admin));
        expect(asAdmin.status).toBe(200);
        expect(asAdmin.body.messages).toHaveLength(1);
    });
});
