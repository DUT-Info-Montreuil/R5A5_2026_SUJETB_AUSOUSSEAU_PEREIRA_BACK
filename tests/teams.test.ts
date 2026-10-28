import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './context.js';
import { db } from './context.js';
import { bearer, closedTournament, createGame, createTeam, createTournament, quickUser, type TestUser } from './helpers.js';

function captainOf(teamId: number): number {
    return (db.prepare('SELECT user_id FROM team_members WHERE team_id = ? AND is_captain = 1').get(teamId) as { user_id: number }).user_id;
}

describe('POST /api/tournaments/:id/teams (B-05, B-07)', () => {
    it('refuse un visiteur (401)', async () => {
        const t = createTournament();
        expect((await request(app).post(`/api/tournaments/${t.id}/teams`).send({ name: 'Les Bleus' })).status).toBe(401);
    });

    it('le créateur devient capitaine', async () => {
        const t = createTournament();
        const player = quickUser();
        const res = await request(app).post(`/api/tournaments/${t.id}/teams`).set(...bearer(player)).send({ name: 'Les Bleus' });

        expect(res.status).toBe(201);
        expect(res.body.team.members).toEqual([expect.objectContaining({ userId: player.id, isCaptain: true })]);
    });

    it('refuse un joueur qui a déjà une équipe dans ce tournoi (409), mais pas dans un autre tournoi', async () => {
        const t = createTournament();
        const { captain } = createTeam(t.id);

        const res = await request(app).post(`/api/tournaments/${t.id}/teams`).set(...bearer(captain)).send({ name: 'Deuxieme' });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('ALREADY_IN_TEAM');

        const other = createTournament();
        const ok = await request(app).post(`/api/tournaments/${other.id}/teams`).set(...bearer(captain)).send({ name: 'Deuxieme' });
        expect(ok.status).toBe(201);
    });

    it('refuse une 9e équipe, un nom déjà pris, et un tournoi aux inscriptions closes (409)', async () => {
        const t = createTournament();
        const first = createTeam(t.id);
        const firstName = (db.prepare('SELECT name FROM teams WHERE id = ?').get(first.id) as { name: string }).name;
        const dup = await request(app).post(`/api/tournaments/${t.id}/teams`).set(...bearer(quickUser())).send({ name: firstName });
        expect(dup.body.error.code).toBe('TEAM_NAME_TAKEN');

        for (let i = 0; i < 7; i++) createTeam(t.id);
        const full = await request(app).post(`/api/tournaments/${t.id}/teams`).set(...bearer(quickUser())).send({ name: 'Neuvieme' });
        expect(full.status).toBe(409);
        expect(full.body.error.code).toBe('TOURNAMENT_FULL');

        const closed = await closedTournament(1);
        const late = await request(app).post(`/api/tournaments/${closed.id}/teams`).set(...bearer(quickUser())).send({ name: 'Tard' });
        expect(late.status).toBe(409);
        expect(late.body.error.code).toBe('REGISTRATION_CLOSED');
    });
});

describe('GET équipes (B-06)', () => {
    it('recherche publique par nom, sans email', async () => {
        const t = createTournament();
        const team = createTeam(t.id, 2);
        db.prepare('UPDATE teams SET name = ? WHERE id = ?').run('Les Invincibles', team.id);
        createTeam(t.id);

        const res = await request(app).get(`/api/tournaments/${t.id}/teams?search=invinc`);
        expect(res.status).toBe(200);
        expect(res.body.teams.map((tm: { id: number }) => tm.id)).toEqual([team.id]);
        expect(JSON.stringify(res.body)).not.toMatch(/@|email/i);

        const detail = await request(app).get(`/api/teams/${team.id}`);
        expect(detail.body.team.members).toHaveLength(2);
    });
});

/**
 * B-09 / B-10 : chaque action du capitaine est refusée à un visiteur, à un joueur extérieur
 * et à un simple membre, puis acceptée pour le capitaine.
 */
describe('Actions réservées au capitaine (B-09, B-10)', () => {
    const actions: { name: string; run: (teamId: number, target: number, as?: TestUser) => request.Test; okStatus: number }[] = [
        { name: 'renommer', run: (id, _t, as) => withAuth(request(app).patch(`/api/teams/${id}`), as).send({ name: 'Nouveau nom' }), okStatus: 200 },
        { name: 'transférer le capitanat', run: (id, target, as) => withAuth(request(app).post(`/api/teams/${id}/transfer-captaincy`), as).send({ userId: target }), okStatus: 200 },
        { name: 'retirer le rôle', run: (id, target, as) => withAuth(request(app).patch(`/api/teams/${id}/members/${target}`), as).send({ roleId: null }), okStatus: 200 },
        { name: 'exclure', run: (id, target, as) => withAuth(request(app).delete(`/api/teams/${id}/members/${target}`), as), okStatus: 200 },
        { name: 'supprimer l\'équipe', run: (id, _t, as) => withAuth(request(app).delete(`/api/teams/${id}`), as), okStatus: 204 },
        { name: 'voir les demandes', run: (id, _t, as) => withAuth(request(app).get(`/api/teams/${id}/join-requests`), as), okStatus: 200 },
    ];

    for (const action of actions) {
        it(`${action.name} : 401 visiteur, 403 extérieur, 403 membre, OK capitaine`, async () => {
            const t = createTournament();
            const team = createTeam(t.id, 3);
            const [member, target] = team.members as [TestUser, TestUser];

            expect((await action.run(team.id, target.id)).status).toBe(401);

            const outsider = await action.run(team.id, target.id, quickUser());
            expect(outsider.status).toBe(403);
            expect(outsider.body.error.code).toBe('NOT_TEAM_MEMBER');

            const asMember = await action.run(team.id, target.id, member);
            expect(asMember.status).toBe(403);
            expect(asMember.body.error.code).toBe('NOT_CAPTAIN');

            // Le capitaine d'une autre équipe du même tournoi n'a pas plus de droits
            const otherCaptain = createTeam(t.id).captain;
            expect((await action.run(team.id, target.id, otherCaptain)).status).toBe(403);

            expect((await action.run(team.id, target.id, team.captain)).status).toBe(action.okStatus);
        });
    }

    it('B-11 : toutes ces actions sont refusées (409) une fois les inscriptions closes', async () => {
        const t = await closedTournament(3);
        const team = t.teams[0]!;
        const target = team.members[0]!;

        for (const action of actions.filter((a) => a.name !== 'voir les demandes')) {
            const res = await action.run(team.id, target.id, team.captain);
            expect(res.status, action.name).toBe(409);
            expect(res.body.error.code).toBe('REGISTRATION_CLOSED');
        }
    });

    it('le transfert passe le capitanat, l\'ancien capitaine perd ses droits', async () => {
        const t = createTournament();
        const team = createTeam(t.id, 2);
        const heir = team.members[0]!;
        await request(app).post(`/api/teams/${team.id}/transfer-captaincy`).set(...bearer(team.captain)).send({ userId: heir.id });

        expect(captainOf(team.id)).toBe(heir.id);
        const res = await request(app).patch(`/api/teams/${team.id}`).set(...bearer(team.captain)).send({ name: 'Coup d etat' });
        expect(res.status).toBe(403);
    });

    it('n\'accepte qu\'un rôle du jeu du tournoi (B-08)', async () => {
        const game = createGame(['Mid', 'Support']);
        const t = createTournament(game.id);
        const team = createTeam(t.id, 2);
        const target = team.members[0]!.id;

        const ok = await request(app).patch(`/api/teams/${team.id}/members/${target}`).set(...bearer(team.captain)).send({ roleId: game.roleIds[0] });
        expect(ok.status).toBe(200);
        expect(ok.body.team.members.find((m: { userId: number }) => m.userId === target).role.name).toBe('Mid');

        const otherGameRole = createGame(['Sniper']).roleIds[0];
        const bad = await request(app).patch(`/api/teams/${team.id}/members/${target}`).set(...bearer(team.captain)).send({ roleId: otherGameRole });
        expect(bad.status).toBe(422);
        expect(bad.body.error.code).toBe('INVALID_ROLE');
    });

    it('le capitaine ne peut pas s\'exclure lui-même', async () => {
        const t = createTournament();
        const team = createTeam(t.id);
        const res = await request(app).delete(`/api/teams/${team.id}/members/${team.captain.id}`).set(...bearer(team.captain));
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('CANNOT_KICK_SELF');
    });
});

describe('DELETE /api/teams/:id/members/me (B-06)', () => {
    it('refuse un joueur qui n\'est pas membre (403)', async () => {
        const t = createTournament();
        const team = createTeam(t.id);
        const res = await request(app).delete(`/api/teams/${team.id}/members/me`).set(...bearer(quickUser()));
        expect(res.status).toBe(403);
    });

    it('un membre quitte l\'équipe', async () => {
        const t = createTournament();
        const team = createTeam(t.id, 2);
        const res = await request(app).delete(`/api/teams/${team.id}/members/me`).set(...bearer(team.members[0]!));
        expect(res.status).toBe(204);
        expect((await request(app).get(`/api/teams/${team.id}`)).body.team.members).toHaveLength(1);
    });

    it('si le capitaine part, le membre arrivé le plus tôt reprend ; seul, l\'équipe disparaît', async () => {
        const t = createTournament();
        const team = createTeam(t.id, 3);
        const [first, second] = team.members as [TestUser, TestUser];
        db.prepare('UPDATE team_members SET joined_at = ? WHERE user_id = ?').run('2020-01-01T00:00:00.000Z', second.id);

        await request(app).delete(`/api/teams/${team.id}/members/me`).set(...bearer(team.captain));
        expect(captainOf(team.id)).toBe(second.id);

        await request(app).delete(`/api/teams/${team.id}/members/me`).set(...bearer(second));
        expect(captainOf(team.id)).toBe(first.id);
        await request(app).delete(`/api/teams/${team.id}/members/me`).set(...bearer(first));
        expect((await request(app).get(`/api/teams/${team.id}`)).status).toBe(404);
    });

    it('refuse de quitter une fois les inscriptions closes (409)', async () => {
        const t = await closedTournament(2);
        const res = await request(app).delete(`/api/teams/${t.teams[0]!.id}/members/me`).set(...bearer(t.teams[0]!.members[0]!));
        expect(res.status).toBe(409);
    });
});

function withAuth(req: request.Test, user?: TestUser): request.Test {
    return user ? req.set(...bearer(user)) : req;
}
