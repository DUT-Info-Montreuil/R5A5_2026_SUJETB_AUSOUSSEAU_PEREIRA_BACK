import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './context.js';
import { bearer, closedTournament, matchesOf, quickUser, startedTournament } from './helpers.js';

function quarter(tournamentId: number, position = 1) {
    return matchesOf(tournamentId).find((m) => m.round === 1 && m.position === position)!;
}

describe('POST /api/matches/:id/result (B-13, B-14)', () => {
    it('refuse un visiteur (401), un joueur du match et un joueur quelconque (403)', async () => {
        const t = await startedTournament();
        const match = quarter(t.id);
        const playerOfMatch = t.teams.find((team) => team.id === match.team_a_id)!.captain;
        const body = { scoreA: 2, scoreB: 0 };

        expect((await request(app).post(`/api/matches/${match.id}/result`).send(body)).status).toBe(401);
        expect((await request(app).post(`/api/matches/${match.id}/result`).set(...bearer(playerOfMatch)).send(body)).status).toBe(403);
        expect((await request(app).post(`/api/matches/${match.id}/result`).set(...bearer(quickUser())).send(body)).status).toBe(403);
        expect(quarter(t.id).status).toBe('ready');
    });

    it('refuse un résultat avant le lancement (409) et une égalité (422)', async () => {
        const t = await closedTournament();
        const match = quarter(t.id);
        const early = await request(app).post(`/api/matches/${match.id}/result`).set(...bearer(t.admin)).send({ scoreA: 1, scoreB: 0 });
        expect(early.status).toBe(409);
        expect(early.body.error.code).toBe('TOURNAMENT_NOT_IN_PROGRESS');

        await request(app).post(`/api/tournaments/${t.id}/start`).set(...bearer(t.admin));
        const tie = await request(app).post(`/api/matches/${match.id}/result`).set(...bearer(t.admin)).send({ scoreA: 1, scoreB: 1 });
        expect(tie.status).toBe(422);
        expect(tie.body.error.code).toBe('MATCH_DRAW_NOT_ALLOWED');
    });

    it('refuse un match dont les deux équipes ne sont pas connues (409)', async () => {
        const t = await startedTournament();
        const semi = matchesOf(t.id).find((m) => m.round === 2)!;
        const res = await request(app).post(`/api/matches/${semi.id}/result`).set(...bearer(t.admin)).send({ scoreA: 1, scoreB: 0 });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('MATCH_NOT_READY');
    });

    it('fait avancer le gagnant ; la demie devient jouable quand ses deux équipes sont connues', async () => {
        const t = await startedTournament();
        const q1 = quarter(t.id, 1);
        const q2 = quarter(t.id, 2);

        const res = await request(app).post(`/api/matches/${q1.id}/result`).set(...bearer(t.admin)).send({ scoreA: 0, scoreB: 2 });
        expect(res.status).toBe(200);
        expect(res.body.match).toMatchObject({ status: 'finished', winnerId: q1.team_b_id, scoreA: 0, scoreB: 2 });

        let semi = matchesOf(t.id).find((m) => m.round === 2 && m.position === 1)!;
        expect(semi).toMatchObject({ team_a_id: q1.team_b_id, team_b_id: null, status: 'pending' });

        await request(app).post(`/api/matches/${q2.id}/result`).set(...bearer(t.admin)).send({ scoreA: 3, scoreB: 1 });
        semi = matchesOf(t.id).find((m) => m.round === 2 && m.position === 1)!;
        expect(semi).toMatchObject({ team_a_id: q1.team_b_id, team_b_id: q2.team_a_id, status: 'ready' });

        const again = await request(app).post(`/api/matches/${q1.id}/result`).set(...bearer(t.admin)).send({ scoreA: 2, scoreB: 0 });
        expect(again.status).toBe(409);
        expect(again.body.error.code).toBe('MATCH_ALREADY_PLAYED');
    });

    it('la finale termine le tournoi', async () => {
        const t = await startedTournament();
        for (let round = 1; round <= 3; round++) {
            for (const m of matchesOf(t.id).filter((x) => x.round === round)) {
                const res = await request(app).post(`/api/matches/${m.id}/result`).set(...bearer(t.admin)).send({ scoreA: 1, scoreB: 0 });
                expect(res.status).toBe(200);
            }
        }
        const detail = (await request(app).get(`/api/tournaments/${t.id}`)).body.tournament;
        expect(detail.status).toBe('finished');
        expect(detail.teams.filter((team: { isEliminated: boolean }) => !team.isEliminated)).toHaveLength(1);
    });
});

describe('POST /api/matches/:id/forfeit (B-15)', () => {
    it('refuse un joueur, même celui de l\'équipe adverse (403)', async () => {
        const t = await startedTournament();
        const match = quarter(t.id);
        const opponent = t.teams.find((team) => team.id === match.team_b_id)!.captain;
        const res = await request(app).post(`/api/matches/${match.id}/forfeit`).set(...bearer(opponent)).send({ teamId: match.team_a_id });
        expect(res.status).toBe(403);
    });

    it('refuse une équipe qui ne joue pas ce match (422)', async () => {
        const t = await startedTournament();
        const res = await request(app).post(`/api/matches/${quarter(t.id, 1).id}/forfeit`).set(...bearer(t.admin)).send({ teamId: quarter(t.id, 2).team_a_id });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('TEAM_NOT_IN_MATCH');
    });

    it('qualifie l\'adversaire', async () => {
        const t = await startedTournament();
        const match = quarter(t.id);
        const res = await request(app).post(`/api/matches/${match.id}/forfeit`).set(...bearer(t.admin)).send({ teamId: match.team_a_id });

        expect(res.status).toBe(200);
        expect(res.body.match).toMatchObject({ winnerId: match.team_b_id, isForfeit: true, status: 'finished' });
        const semi = matchesOf(t.id).find((m) => m.round === 2 && m.position === 1)!;
        expect(semi.team_a_id).toBe(match.team_b_id);
    });
});
