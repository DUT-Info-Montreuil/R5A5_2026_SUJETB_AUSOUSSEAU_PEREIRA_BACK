import request from 'supertest';
import { app, container, db } from './context.js';

export const validUser = {
    username: 'alice',
    email: 'alice@example.com',
    password: 'motdepasse123',
};

export async function registerUser(overrides: Partial<typeof validUser> = {}) {
    const res = await request(app).post('/api/auth/register').send({ ...validUser, ...overrides });
    if (res.status !== 201) throw new Error(`register a échoué : ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { token: string; user: { id: number } };
}

export function setAdmin(userId: number, isAdmin: boolean): void {
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
}

// --- Fixtures rapides : passage direct par les repositories, sans bcrypt ni HTTP ---

export interface TestUser {
    id: number;
    token: string;
}

let seq = 0;

export function quickUser(isAdmin = false): TestUser {
    seq++;
    const user = container.repositories.users.create({
        username: `user${seq}`,
        email: `user${seq}@test.local`,
        passwordHash: 'pas-un-vrai-hash',
        isAdmin,
    });
    return { id: user.id, token: container.tokens.sign(user.id) };
}

export function bearer(user: TestUser): [string, string] {
    return ['Authorization', `Bearer ${user.token}`];
}

export function createGame(roles = ['Top', 'Jungle', 'Mid', 'ADC', 'Support']) {
    const game = container.repositories.games.create(`Jeu ${++seq}`, roles);
    return { id: game.id, roleIds: game.roles.map((r) => r.id) };
}

export function createTournament(gameId = createGame().id) {
    const admin = quickUser(true);
    const tournament = container.repositories.tournaments.create(`Tournoi ${++seq}`, gameId, admin.id);
    return { id: tournament.id, gameId, admin };
}

export interface TestTeam {
    id: number;
    captain: TestUser;
    members: TestUser[]; // hors capitaine
}

/** Équipe de `size` joueurs ; chacun reçoit un rôle du jeu, sauf si `withRoles` est faux. */
export function createTeam(tournamentId: number, size = 1, withRoles = true): TestTeam {
    const { teams, tournaments, games } = container.repositories;
    const gameId = tournaments.findById(tournamentId)!.game.id;
    const roleId = games.findById(gameId)!.roles[0]!.id;
    const captain = quickUser();
    const team = teams.create(tournamentId, gameId, `Equipe ${++seq}`, captain.id);
    const members: TestUser[] = [];
    for (let i = 1; i < size; i++) {
        const member = quickUser();
        teams.addMember(team.id, tournamentId, member.id);
        members.push(member);
    }
    if (withRoles) for (const user of [captain, ...members]) teams.setMemberRole(team.id, user.id, roleId);
    return { id: team.id, captain, members };
}

/** Tournoi avec 8 équipes, inscriptions closes (arbre généré). */
export async function closedTournament(teamSize = 5) {
    const tournament = createTournament();
    const teams = Array.from({ length: 8 }, () => createTeam(tournament.id, teamSize));
    const res = await request(app).post(`/api/tournaments/${tournament.id}/close`).set(...bearer(tournament.admin));
    if (res.status !== 200) throw new Error(`close a échoué : ${res.status} ${JSON.stringify(res.body)}`);
    return { ...tournament, teams };
}

/** Tournoi lancé, toutes les équipes complètes (aucun forfait automatique). */
export async function startedTournament() {
    const tournament = await closedTournament();
    const res = await request(app).post(`/api/tournaments/${tournament.id}/start`).set(...bearer(tournament.admin));
    if (res.status !== 200) throw new Error(`start a échoué : ${res.status} ${JSON.stringify(res.body)}`);
    return tournament;
}

export function matchesOf(tournamentId: number) {
    return db
        .prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY round, position')
        .all(tournamentId) as {
        id: number;
        round: number;
        position: number;
        team_a_id: number | null;
        team_b_id: number | null;
        winner_id: number | null;
        status: string;
    }[];
}

/** Fixe dans une heure l'horaire de tous les matchs du tournoi : les paris s'y ouvrent. */
export function scheduleMatches(tournamentId: number): void {
    db.prepare('UPDATE matches SET scheduled_at = ? WHERE tournament_id = ?').run(new Date(Date.now() + 3_600_000).toISOString(), tournamentId);
}
