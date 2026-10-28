// Routes de l'espace joueur demandées par le front (BACK-ATTENDU.md du dépôt front)
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { initSchema, openDatabase } from '../src/shared/infrastructure/database.js';
import { app } from './context.js';
import { bearer, closedTournament, createTeam, createTournament, matchesOf, quickUser, startedTournament } from './helpers.js';

async function post(teamId: number, as: { token: string }, content: string): Promise<number> {
    const res = await request(app).post(`/api/teams/${teamId}/messages`).set('Authorization', `Bearer ${as.token}`).send({ content });
    return res.body.message.id;
}

describe('Messages lus / non lus', () => {
    it('compte les messages des autres depuis le repère, qui ne recule jamais', async () => {
        const t = createTournament();
        const team = createTeam(t.id, 2);
        const member = team.members[0]!;
        const first = await post(team.id, team.captain, 'un');
        const second = await post(team.id, team.captain, 'deux');
        await post(team.id, member, 'le mien ne compte pas');

        const unread = () => request(app).get('/api/me/unread').set(...bearer(member));
        expect((await unread()).body.teams).toEqual([{ teamId: team.id, unread: 2, lastReadMessageId: null }]);

        expect((await request(app).post(`/api/teams/${team.id}/messages/read`).set(...bearer(member)).send({ messageId: second })).status).toBe(204);
        expect((await unread()).body.teams).toEqual([{ teamId: team.id, unread: 0, lastReadMessageId: second }]);

        await request(app).post(`/api/teams/${team.id}/messages/read`).set(...bearer(member)).send({ messageId: first });
        expect((await unread()).body.teams[0].lastReadMessageId).toBe(second);
    });

    it('refuse un non-membre (403) et un message d\'une autre équipe (404)', async () => {
        const t = createTournament();
        const team = createTeam(t.id);
        const other = createTeam(t.id);
        const foreign = await post(other.id, other.captain, 'ailleurs');
        const mine = await post(team.id, team.captain, 'ici');

        expect((await request(app).post(`/api/teams/${team.id}/messages/read`).set(...bearer(other.captain)).send({ messageId: mine })).status).toBe(403);
        const wrongTeam = await request(app).post(`/api/teams/${team.id}/messages/read`).set(...bearer(team.captain)).send({ messageId: foreign });
        expect(wrongTeam.status).toBe(404);
        expect(wrongTeam.body.error.code).toBe('MESSAGE_NOT_FOUND');
    });

    it('les équipes éliminées n\'apparaissent plus', async () => {
        const t = await startedTournament();
        const quarter = matchesOf(t.id).find((m) => m.round === 1)!;
        await request(app).post(`/api/matches/${quarter.id}/result`).set(...bearer(t.admin)).send({ scoreA: 2, scoreB: 0 });
        const loser = t.teams.find((team) => team.id === quarter.team_b_id)!;
        expect((await request(app).get('/api/me/unread').set(...bearer(loser.captain))).body.teams).toEqual([]);
    });
});

describe('Mes demandes et mes équipes', () => {
    it('liste mes demandes en attente avec l\'équipe et le tournoi, pas celles des autres', async () => {
        const t = createTournament();
        const team = createTeam(t.id);
        const applicant = quickUser();
        await request(app).post(`/api/teams/${team.id}/join-requests`).set(...bearer(applicant));
        await request(app).post(`/api/teams/${createTeam(t.id).id}/join-requests`).set(...bearer(quickUser()));

        const res = await request(app).get('/api/me/join-requests?status=pending').set(...bearer(applicant));
        expect(res.status).toBe(200);
        expect(res.body.joinRequests).toHaveLength(1);
        expect(res.body.joinRequests[0]).toMatchObject({ teamId: team.id, tournamentId: t.id, team: { id: team.id }, status: 'pending' });
        expect(res.body.pagination.total).toBe(1);

        const none = await request(app).get('/api/me/join-requests?status=accepted').set(...bearer(applicant));
        expect(none.body.joinRequests).toEqual([]);
    });

    it('liste mes équipes avec leur tournoi, sans celles des autres', async () => {
        const t1 = createTournament();
        const t2 = createTournament();
        const mine = createTeam(t1.id, 2);
        const player = mine.members[0]!;
        const second = createTeam(t2.id);
        await request(app).post(`/api/teams/${second.id}/join-requests`).set(...bearer(player));
        createTeam(t1.id);

        const res = await request(app).get('/api/me/teams').set(...bearer(player));
        expect(res.status).toBe(200);
        expect(res.body.teams).toHaveLength(1);
        expect(res.body.teams[0]).toMatchObject({ id: mine.id, tournament: { id: t1.id, status: 'registration_open' } });
    });
});

describe('Équipe ouverte ou privée', () => {
    it('le capitaine ferme l\'équipe : plus de demandes ; un membre ne peut pas la fermer', async () => {
        const t = createTournament();
        const team = createTeam(t.id, 2);

        expect((await request(app).patch(`/api/teams/${team.id}`).set(...bearer(team.members[0]!)).send({ visibility: 'private' })).status).toBe(403);
        const closed = await request(app).patch(`/api/teams/${team.id}`).set(...bearer(team.captain)).send({ visibility: 'private' });
        expect(closed.body.team.visibility).toBe('private');

        const refused = await request(app).post(`/api/teams/${team.id}/join-requests`).set(...bearer(quickUser()));
        expect(refused.status).toBe(409);
        expect(refused.body.error.code).toBe('TEAM_PRIVATE');
    });

    it('un corps vide ou une valeur inconnue est refusé (400)', async () => {
        const t = createTournament();
        const team = createTeam(t.id);
        expect((await request(app).patch(`/api/teams/${team.id}`).set(...bearer(team.captain)).send({})).status).toBe(400);
        expect((await request(app).patch(`/api/teams/${team.id}`).set(...bearer(team.captain)).send({ visibility: 'secret' })).status).toBe(400);
    });
});

describe('Dates prévues', () => {
    it('l\'admin fixe la clôture prévue à la création puis la change ; plus après la clôture', async () => {
        const game = createTournament().gameId;
        const admin = quickUser(true);
        const created = await request(app)
            .post('/api/tournaments')
            .set(...bearer(admin))
            .send({ name: 'Coupe datée', gameId: game, registrationClosesAt: '2026-12-01T18:00:00+01:00' });
        expect(created.body.tournament.registrationClosesAt).toBe('2026-12-01T17:00:00.000Z');

        const id = created.body.tournament.id;
        const changed = await request(app).patch(`/api/tournaments/${id}`).set(...bearer(admin)).send({ registrationClosesAt: null });
        expect(changed.body.tournament.registrationClosesAt).toBeNull();
        expect((await request(app).patch(`/api/tournaments/${id}`).set(...bearer(admin)).send({ registrationClosesAt: 'demain' })).status).toBe(400);

        const t = await closedTournament();
        expect((await request(app).patch(`/api/tournaments/${t.id}`).set(...bearer(t.admin)).send({ registrationClosesAt: null })).status).toBe(409);
    });

    it('l\'admin fixe l\'horaire d\'un match, pas d\'un match déjà joué', async () => {
        const t = await startedTournament();
        const quarter = matchesOf(t.id).find((m) => m.round === 1)!;
        const scheduled = await request(app).patch(`/api/matches/${quarter.id}`).set(...bearer(t.admin)).send({ scheduledAt: '2026-12-02T20:00:00Z' });
        expect(scheduled.body.match.scheduledAt).toBe('2026-12-02T20:00:00.000Z');

        await request(app).post(`/api/matches/${quarter.id}/result`).set(...bearer(t.admin)).send({ scoreA: 1, scoreB: 0 });
        const late = await request(app).patch(`/api/matches/${quarter.id}`).set(...bearer(t.admin)).send({ scheduledAt: null });
        expect(late.status).toBe(409);
    });
});

describe('Statistiques du profil', () => {
    it('bilan du champion et d\'un éliminé en quart, historique avec le résultat', async () => {
        const t = await startedTournament();
        for (const round of [1, 2, 3]) {
            for (const m of matchesOf(t.id).filter((x) => x.round === round)) {
                await request(app).post(`/api/matches/${m.id}/result`).set(...bearer(t.admin)).send({ scoreA: 2, scoreB: 1 });
            }
        }
        const final = matchesOf(t.id).find((m) => m.round === 3)!;
        const champion = t.teams.find((team) => team.id === final.winner_id)!;
        const quarterLoser = t.teams.find((team) => team.id === matchesOf(t.id)[0]!.team_b_id)!;

        const stats = await request(app).get(`/api/users/${champion.members[0]!.id}/stats`);
        expect(stats.status).toBe(200);
        expect(stats.body).toMatchObject({ tournaments: 1, matchesPlayed: 3, matchesWon: 3, titles: 1 });
        expect(stats.body.history[0]).toMatchObject({ tournament: { id: t.id }, result: 'champion' });

        const loser = await request(app).get(`/api/users/${quarterLoser.captain.id}/stats`);
        expect(loser.body).toMatchObject({ tournaments: 1, matchesPlayed: 1, matchesWon: 0, titles: 0 });
        expect(loser.body.history[0].result).toBe('quarter');
    });

    it('joueur inconnu : 404', async () => {
        expect((await request(app).get('/api/users/999999/stats')).status).toBe(404);
    });
});

describe('Migration du schéma', () => {
    it('ajoute les nouvelles colonnes à une base créée avant elles', () => {
        const old = openDatabase(':memory:');
        old.exec('CREATE TABLE teams (id INTEGER PRIMARY KEY, tournament_id INTEGER, name TEXT, is_eliminated INTEGER, created_at TEXT) STRICT');
        old.exec("INSERT INTO teams VALUES (1, 1, 'Ancienne', 0, '')");
        initSchema(old);
        expect(old.prepare('SELECT visibility FROM teams').get()).toEqual({ visibility: 'open' });
    });
});
