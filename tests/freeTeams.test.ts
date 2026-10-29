import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, db } from './context.js';
import { bearer, closedTournament, createGame, createTeam, createTournament, quickUser, type TestUser } from './helpers.js';

async function freeTeam(captain: TestUser, gameId: number, name = 'Libres') {
    const res = await request(app).post('/api/teams').set(...bearer(captain)).send({ name, gameId });
    expect(res.status).toBe(201);
    return res.body.team as { id: number };
}

/** Le joueur rejoint l'équipe hors tournoi par une demande acceptée. */
async function joinFree(teamId: number, captain: TestUser, player: TestUser) {
    const asked = await request(app).post(`/api/teams/${teamId}/join-requests`).set(...bearer(player));
    expect(asked.status).toBe(201);
    expect(asked.body.joinRequest.tournamentId).toBeNull();
    expect((await request(app).post(`/api/join-requests/${asked.body.joinRequest.id}/accept`).set(...bearer(captain))).status).toBe(200);
}

function register(teamId: number, user: TestUser, tournamentId: number) {
    return request(app).post(`/api/teams/${teamId}/register`).set(...bearer(user)).send({ tournamentId });
}

describe('Équipes hors tournoi', () => {
    it('le créateur devient capitaine d\'une équipe sans tournoi, avec son jeu', async () => {
        const game = createGame();
        const captain = quickUser();
        const res = await request(app).post('/api/teams').set(...bearer(captain)).send({ name: 'Libres', gameId: game.id });

        expect(res.status).toBe(201);
        expect(res.body.team).toMatchObject({ tournamentId: null, game: { id: game.id }, members: [{ userId: captain.id, isCaptain: true }] });
    });

    it('refuse un jeu inconnu (404)', async () => {
        const res = await request(app).post('/api/teams').set(...bearer(quickUser())).send({ name: 'Libres', gameId: 9999 });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('GAME_NOT_FOUND');
    });

    it('se liste publiquement (?free=true), et apparaît dans mes équipes avec tournament à null', async () => {
        const t = createTournament();
        createTeam(t.id);
        const captain = quickUser();
        const team = await freeTeam(captain, createGame().id, 'Sans Tournoi');

        const free = await request(app).get('/api/teams?free=true&search=sans');
        expect(free.status).toBe(200);
        expect(free.body.teams.map((x: { id: number }) => x.id)).toEqual([team.id]);
        expect(free.body.pagination.total).toBe(1);
        expect((await request(app).get('/api/teams')).body.pagination.total).toBe(2);

        const mine = await request(app).get('/api/me/teams').set(...bearer(captain));
        expect(mine.body.teams).toEqual([expect.objectContaining({ id: team.id, tournamentId: null, tournament: null })]);
    });

    it('se gère comme une équipe d\'un tournoi ouvert : demandes, rôles, chat', async () => {
        const game = createGame();
        const captain = quickUser();
        const player = quickUser();
        const team = await freeTeam(captain, game.id);

        expect((await request(app).post(`/api/teams/${team.id}/join-requests`).set(...bearer(captain))).body.error.code).toBe('ALREADY_IN_TEAM');
        await joinFree(team.id, captain, player);

        const role = await request(app).patch(`/api/teams/${team.id}/members/${player.id}`).set(...bearer(captain)).send({ roleId: game.roleIds[0] });
        expect(role.status).toBe(200);
        const otherRole = createGame().roleIds[0];
        expect((await request(app).patch(`/api/teams/${team.id}/members/${player.id}`).set(...bearer(captain)).send({ roleId: otherRole })).status).toBe(422);

        expect((await request(app).post(`/api/teams/${team.id}/messages`).set(...bearer(player)).send({ content: 'Salut' })).status).toBe(201);
        const unread = await request(app).get('/api/me/unread').set(...bearer(captain));
        expect(unread.body.teams).toEqual([expect.objectContaining({ teamId: team.id, unread: 1 })]);
    });
});

describe('POST /api/teams/:id/register', () => {
    it('refuse un membre qui n\'est pas capitaine (403) et un non-membre (403)', async () => {
        const t = createTournament();
        const captain = quickUser();
        const member = quickUser();
        const team = await freeTeam(captain, t.gameId);
        await joinFree(team.id, captain, member);

        expect((await register(team.id, member, t.id)).body.error.code).toBe('NOT_CAPTAIN');
        expect((await register(team.id, quickUser(), t.id)).body.error.code).toBe('NOT_TEAM_MEMBER');
    });

    it('inscrit l\'équipe : même identifiant, membres et messages gardés, demandes des membres ailleurs annulées', async () => {
        const t = createTournament();
        const other = createTeam(t.id);
        const captain = quickUser();
        const member = quickUser();
        const team = await freeTeam(captain, t.gameId);
        await joinFree(team.id, captain, member);
        await request(app).post(`/api/teams/${team.id}/messages`).set(...bearer(member)).send({ content: 'Prêts' });
        const elsewhere = await request(app).post(`/api/teams/${other.id}/join-requests`).set(...bearer(member));

        const res = await register(team.id, captain, t.id);

        expect(res.status).toBe(200);
        expect(res.body.team).toMatchObject({ id: team.id, tournamentId: t.id });
        expect(res.body.team.members).toHaveLength(2);
        expect((await request(app).get(`/api/teams/${team.id}/messages`).set(...bearer(member))).body.messages).toHaveLength(1);
        expect((await request(app).get(`/api/tournaments/${t.id}`)).body.tournament.teamCount).toBe(2);
        expect(db.prepare('SELECT status FROM join_requests WHERE id = ?').get(elsewhere.body.joinRequest.id)).toEqual({ status: 'cancelled' });
        // Désormais dans le tournoi : une équipe par joueur
        const again = await request(app).post(`/api/tournaments/${t.id}/teams`).set(...bearer(member)).send({ name: 'Autre' });
        expect(again.body.error.code).toBe('ALREADY_IN_TEAM');
        expect((await register(team.id, captain, createTournament(t.gameId).id)).body.error.code).toBe('TEAM_ALREADY_REGISTERED');
    });

    it('refuse un autre jeu, un nom pris, un membre déjà inscrit, un tournoi complet ou clos (409)', async () => {
        const t = createTournament();
        const taken = createTeam(t.id);
        const captain = quickUser();
        const team = await freeTeam(captain, t.gameId, 'Libres');

        expect((await register(team.id, captain, createTournament().id)).body.error.code).toBe('GAME_MISMATCH');

        const takenName = (db.prepare('SELECT name FROM teams WHERE id = ?').get(taken.id) as { name: string }).name;
        const dupCaptain = quickUser();
        const dup = await freeTeam(dupCaptain, t.gameId, takenName);
        expect((await register(dup.id, dupCaptain, t.id)).body.error.code).toBe('TEAM_NAME_TAKEN');

        const busy = await freeTeam(taken.captain, t.gameId, 'Occupes');
        expect((await register(busy.id, taken.captain, t.id)).body.error.code).toBe('MEMBER_ALREADY_IN_TOURNAMENT');

        for (let i = 0; i < 7; i++) createTeam(t.id);
        const full = await register(team.id, captain, t.id);
        expect(full.status).toBe(409);
        expect(full.body.error.code).toBe('TOURNAMENT_FULL');
    });

    it('refuse un tournoi aux inscriptions closes (409) et un tournoi inconnu (404)', async () => {
        const closed = await closedTournament(1);
        const captain = quickUser();
        const team = await freeTeam(captain, closed.gameId);

        expect((await register(team.id, captain, closed.id)).body.error.code).toBe('REGISTRATION_CLOSED');
        expect((await register(team.id, captain, 9999)).body.error.code).toBe('TOURNAMENT_NOT_FOUND');
    });
});
