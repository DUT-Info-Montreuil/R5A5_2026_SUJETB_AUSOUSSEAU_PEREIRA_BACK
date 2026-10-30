import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, db } from './context.js';
import { bearer, closedTournament, createTeam, createTournament, matchesOf, quickUser, scheduleMatches, startedTournament, type TestUser } from './helpers.js';

const bet = (matchId: number, user: TestUser, teamId: number, amount: number) =>
    request(app).post(`/api/matches/${matchId}/bets`).set(...bearer(user)).send({ teamId, amount });

const balanceOf = async (user: TestUser) => (await request(app).get('/api/me/wallet').set(...bearer(user))).body.balance as number;

const quarter = (tournamentId: number, position = 1) => matchesOf(tournamentId).find((m) => m.round === 1 && m.position === position)!;

describe('POST /api/matches/:id/bets : qui parie', () => {
    it('refuse un visiteur (401), l\'admin et un joueur du tournoi (403), sans débiter', async () => {
        const t = await closedTournament();
        scheduleMatches(t.id);
        const q1 = quarter(t.id);
        expect((await request(app).post(`/api/matches/${q1.id}/bets`).send({ teamId: q1.team_a_id, amount: 10 })).status).toBe(401);

        const admin = await bet(q1.id, t.admin, q1.team_a_id!, 10);
        expect(admin.status).toBe(403);
        expect(admin.body.error.code).toBe('ADMIN_CANNOT_BET');

        // Joueur d'une équipe qui ne joue pas ce match : refusé quand même, il est dans le tournoi
        const otherPlayer = t.teams.find((team) => team.id !== q1.team_a_id && team.id !== q1.team_b_id)!.members[0]!;
        const player = await bet(q1.id, otherPlayer, q1.team_a_id!, 10);
        expect(player.status).toBe(403);
        expect(player.body.error.code).toBe('PLAYER_CANNOT_BET');
        expect(await balanceOf(otherPlayer)).toBe(100);

        // Un joueur d'un autre tournoi est un spectateur ici
        const elsewhere = createTeam(createTournament().id).captain;
        expect((await bet(q1.id, elsewhere, q1.team_a_id!, 10)).status).toBe(201);
    });
});

describe('POST /api/matches/:id/bets : quand et combien', () => {
    it('mise, débite, et refuse un second pari, une mise trop haute ou trop basse, une équipe hors du match', async () => {
        const t = await closedTournament();
        scheduleMatches(t.id);
        const q1 = quarter(t.id);
        const fan = quickUser();

        const res = await bet(q1.id, fan, q1.team_a_id!, 30);
        expect(res.status).toBe(201);
        expect(res.body).toEqual({ bet: { matchId: q1.id, teamId: q1.team_a_id, amount: 30, status: 'pending', payout: null }, balance: 70 });
        expect((await bet(q1.id, fan, q1.team_b_id!, 10)).body.error.code).toBe('ALREADY_BET');

        const q2 = quarter(t.id, 2);
        expect((await bet(q2.id, fan, q2.team_a_id!, 71)).body.error.code).toBe('INSUFFICIENT_FUNDS');
        expect((await bet(q2.id, fan, q2.team_a_id!, 9)).status).toBe(400);
        const outsider = await bet(q2.id, fan, q1.team_a_id!, 10);
        expect(outsider.status).toBe(422);
        expect(outsider.body.error.code).toBe('TEAM_NOT_IN_MATCH');
        expect((await bet(9999, fan, q1.team_a_id!, 10)).status).toBe(404);
        expect(await balanceOf(fan)).toBe(70);
    });

    it('fermé sans horaire, sur un match aux équipes inconnues, après l\'horaire prévu et après le résultat (409)', async () => {
        const fan = quickUser();
        const t = await startedTournament();
        const unscheduled = await bet(quarter(t.id).id, fan, quarter(t.id).team_a_id!, 10);
        expect(unscheduled.status).toBe(409);
        expect(unscheduled.body.error).toEqual({ code: 'BETS_CLOSED', message: 'Les paris ouvrent quand l\'horaire du match est fixé' });

        scheduleMatches(t.id);
        const semi = matchesOf(t.id).find((m) => m.round === 2)!;
        expect((await bet(semi.id, fan, t.teams[0]!.id, 10)).status).toBe(409);

        const q1 = quarter(t.id);
        await request(app).patch(`/api/matches/${q1.id}`).set(...bearer(t.admin)).send({ scheduledAt: '2020-01-01T00:00:00Z' });
        expect((await bet(q1.id, fan, q1.team_a_id!, 10)).body.error.code).toBe('BETS_CLOSED');

        const q2 = quarter(t.id, 2);
        await request(app).post(`/api/matches/${q2.id}/result`).set(...bearer(t.admin)).send({ scoreA: 1, scoreB: 0 });
        expect((await bet(q2.id, fan, q2.team_a_id!, 10)).body.error.code).toBe('BETS_CLOSED');
    });
});

describe('DELETE /api/matches/:id/bets/me', () => {
    it('rend la mise tant que c\'est ouvert ; 404 sans pari, 409 une fois fermé', async () => {
        const t = await startedTournament();
        scheduleMatches(t.id);
        const q1 = quarter(t.id);
        const fan = quickUser();
        expect((await request(app).delete(`/api/matches/${q1.id}/bets/me`).set(...bearer(fan))).body.error.code).toBe('BET_NOT_FOUND');

        await bet(q1.id, fan, q1.team_a_id!, 50);
        const cancelled = await request(app).delete(`/api/matches/${q1.id}/bets/me`).set(...bearer(fan));
        expect(cancelled.body).toEqual({ balance: 100 });

        await bet(q1.id, fan, q1.team_a_id!, 50);
        await request(app).post(`/api/matches/${q1.id}/result`).set(...bearer(t.admin)).send({ scoreA: 0, scoreB: 1 });
        expect((await request(app).delete(`/api/matches/${q1.id}/bets/me`).set(...bearer(fan))).status).toBe(409);
    });
});

describe('Règlement et classements', () => {
    it('le résultat paie les gagnants, cotes et classements suivent', async () => {
        const t = await startedTournament();
        scheduleMatches(t.id);
        const q1 = quarter(t.id);
        const [winner, small, loser] = [quickUser(), quickUser(), quickUser()];
        await bet(q1.id, winner, q1.team_a_id!, 30);
        await bet(q1.id, small, q1.team_a_id!, 10);
        await bet(q1.id, loser, q1.team_b_id!, 40);

        const pools = await request(app).get(`/api/tournaments/${t.id}/bets`);
        expect(pools.body.matches[0]).toEqual({
            matchId: q1.id,
            open: true,
            closesAt: expect.any(String),
            pot: 80,
            pools: [{ teamId: q1.team_a_id, total: 40, bettors: 2 }, { teamId: q1.team_b_id, total: 40, bettors: 1 }],
        });

        await request(app).post(`/api/matches/${q1.id}/result`).set(...bearer(t.admin)).send({ scoreA: 2, scoreB: 0 });
        expect(await balanceOf(winner)).toBe(130); // 70 + 60
        expect(await balanceOf(small)).toBe(110); // 90 + 20
        expect(await balanceOf(loser)).toBe(60);

        const mine = await request(app).get(`/api/tournaments/${t.id}/bets/me`).set(...bearer(winner));
        expect(mine.body.bets).toEqual([{ matchId: q1.id, teamId: q1.team_a_id, amount: 30, status: 'won', payout: 60 }]);

        const board = await request(app).get(`/api/tournaments/${t.id}/bets/leaderboard`);
        expect(board.body.leaderboard.map((b: { user: { id: number }; rank: number; net: number }) => [b.user.id, b.rank, b.net])).toEqual([
            [winner.id, 1, 30],
            [small.id, 2, 10],
            [loser.id, 3, -40],
        ]);
        expect(board.body.pagination.total).toBe(3);

        const week = await request(app).get('/api/bets/leaderboard');
        expect(week.body.leaderboard).toHaveLength(3);
        expect(Date.parse(week.body.from)).toBeLessThanOrEqual(Date.now());
        expect((await request(app).get('/api/bets/leaderboard?week=previous')).body.leaderboard).toEqual([]);
        expect((await request(app).get(`/api/tournaments/9999/bets/leaderboard`)).status).toBe(404);
    });

    it('un forfait au lancement règle les paris du quart ; personne sur le vainqueur : remboursé', async () => {
        const t = await closedTournament();
        scheduleMatches(t.id);
        const q1 = quarter(t.id);
        const fan = quickUser();
        await bet(q1.id, fan, q1.team_b_id!, 40);
        // L'équipe B perd un joueur avant le lancement : elle perd son quart par forfait (gel contourné pour le test)
        const leaver = t.teams.find((team) => team.id === q1.team_b_id)!.members[0]!;
        db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(q1.team_b_id, leaver.id);
        const other = quickUser();
        await bet(q1.id, other, q1.team_b_id!, 10);

        await request(app).post(`/api/tournaments/${t.id}/start`).set(...bearer(t.admin));
        const mine = await request(app).get(`/api/tournaments/${t.id}/bets/me`).set(...bearer(fan));
        expect(mine.body.bets[0]).toMatchObject({ status: 'refunded', payout: 40 });
        expect(await balanceOf(fan)).toBe(100);
    });

    it('le revenu horaire remonte le solde jusqu\'à 100, pas au-delà', async () => {
        const t = await closedTournament();
        scheduleMatches(t.id);
        const q1 = quarter(t.id);
        const fan = quickUser();
        const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
        db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(hoursAgo(5 + 5 / 60), fan.id);
        expect((await request(app).get('/api/me/wallet').set(...bearer(fan))).body).toEqual({ balance: 100, nextIncomeAt: null });

        // Mise de 60 il y a 3 h 30 : 4 heures pleines tombent ensuite, 40 + 4 × 10
        await bet(q1.id, fan, q1.team_a_id!, 60);
        db.prepare('UPDATE bets SET created_at = ? WHERE user_id = ?').run(hoursAgo(3.5), fan.id);
        const wallet = await request(app).get('/api/me/wallet').set(...bearer(fan));
        expect(wallet.body.balance).toBe(80);
        expect(Date.parse(wallet.body.nextIncomeAt) - Date.now()).toBeLessThanOrEqual(55 * 60_000);
    });
});
