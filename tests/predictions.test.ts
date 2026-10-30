import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './context.js';
import { bearer, closedTournament, createTournament, matchesOf, quickUser } from './helpers.js';

/** Arbre cohérent où l'équipe A gagne chaque match. */
function picksForTeamA(tournamentId: number) {
    const matches = matchesOf(tournamentId);
    const winner = new Map<number, number>();
    return matches.map((m) => {
        const teamId =
            m.round === 1 ? m.team_a_id! : winner.get(matches.find((f) => f.round === m.round - 1 && f.position === 2 * m.position - 1)!.id)!;
        winner.set(m.id, teamId);
        return { matchId: m.id, teamId };
    });
}

const predict = (tournamentId: number, picks: unknown) => request(app).post(`/api/tournaments/${tournamentId}/predictions`).send({ picks });

describe('POST /api/tournaments/:id/predictions', () => {
    it('refuse un visiteur (401) et un joueur du tournoi (403), sans rien enregistrer', async () => {
        const t = await closedTournament();
        const picks = picksForTeamA(t.id);
        expect((await predict(t.id, picks)).status).toBe(401);

        const player = await predict(t.id, picks).set(...bearer(t.teams[0]!.members[0]!));
        expect(player.status).toBe(403);
        expect(player.body.error.code).toBe('PLAYER_CANNOT_PREDICT');

        const summary = await request(app).get(`/api/tournaments/${t.id}/predictions`);
        expect(summary.body.participants).toBe(0);
    });

    it('refuse avant la clôture et après le lancement (409), un arbre incohérent (422), un tournoi inconnu (404)', async () => {
        const spectator = quickUser();
        const open = createTournament();
        expect((await predict(open.id, []).set(...bearer(spectator))).body.error.code).toBe('PREDICTIONS_CLOSED');

        const t = await closedTournament();
        const picks = picksForTeamA(t.id);
        const incoherent = picks.map((p, i) => (i === 4 ? { ...p, teamId: picks[1]!.teamId } : p));
        const bad = await predict(t.id, incoherent).set(...bearer(spectator));
        expect(bad.status).toBe(422);
        expect(bad.body.error.code).toBe('INVALID_PREDICTION');
        expect((await predict(9999, picks).set(...bearer(spectator))).status).toBe(404);

        await request(app).post(`/api/tournaments/${t.id}/start`).set(...bearer(t.admin));
        const late = await predict(t.id, picks).set(...bearer(spectator));
        expect(late.status).toBe(409);
        expect(late.body.error.code).toBe('PREDICTIONS_CLOSED');
    });

    it('enregistre, remplace, et compte les points au fil des résultats', async () => {
        const t = await closedTournament();
        const spectator = quickUser();
        const rival = quickUser();
        const picks = picksForTeamA(t.id);

        expect((await predict(t.id, picks).set(...bearer(spectator))).body).toMatchObject({ points: 0, correct: 0 });
        // Le rival change d'avis : il fait gagner l'équipe B du premier quart, puis renvoie le même arbre corrigé
        const q1 = matchesOf(t.id)[0]!;
        const rivalPicks = picks.map((p) => (p.teamId === q1.team_a_id ? { ...p, teamId: q1.team_b_id! } : p));
        await predict(t.id, picks).set(...bearer(rival));
        expect((await predict(t.id, rivalPicks).set(...bearer(rival))).status).toBe(200);

        const summary = await request(app).get(`/api/tournaments/${t.id}/predictions`);
        expect(summary.body.participants).toBe(2);
        expect(summary.body.matches[0].picks).toEqual(
            expect.arrayContaining([{ teamId: q1.team_a_id, count: 1 }, { teamId: q1.team_b_id, count: 1 }]),
        );

        await request(app).post(`/api/tournaments/${t.id}/start`).set(...bearer(t.admin));
        await request(app).post(`/api/matches/${q1.id}/result`).set(...bearer(t.admin)).send({ scoreA: 2, scoreB: 0 });

        const mine = await request(app).get(`/api/tournaments/${t.id}/predictions/me`).set(...bearer(spectator));
        expect(mine.body).toMatchObject({ points: 1, correct: 1 });
        expect(mine.body.picks).toHaveLength(7);

        const board = await request(app).get(`/api/tournaments/${t.id}/predictions/leaderboard?limit=1`);
        expect(board.body.pagination).toEqual({ limit: 1, offset: 0, total: 2 });
        expect(board.body.leaderboard).toEqual([{ rank: 1, user: { id: spectator.id, username: expect.any(String) }, points: 1, correct: 1 }]);
    });
});
