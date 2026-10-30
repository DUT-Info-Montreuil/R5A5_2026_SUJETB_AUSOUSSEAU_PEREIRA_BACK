import type { Page, Paginated } from '../../../shared/application/ports.js';
import { ConflictError } from '../../../shared/domain/errors.js';
import { isUniqueViolation, SQL_NOW, type Database } from '../../../shared/infrastructure/database.js';
import type { JoinRequestRepository, TeamRepository } from '../application/ports.js';
import type { JoinRequest, JoinRequestStatus, Team, TeamMember, TeamVisibility } from '../domain/team.js';

interface TeamRow {
    id: number;
    tournament_id: number | null;
    game_id: number;
    game_name: string;
    name: string;
    is_eliminated: 0 | 1;
    visibility: TeamVisibility;
    created_at: string;
}

interface MemberRow {
    team_id: number;
    user_id: number;
    username: string;
    role_id: number | null;
    role_name: string | null;
    is_captain: 0 | 1;
    joined_at: string;
}

interface JoinRequestRow {
    id: number;
    team_id: number;
    team_name: string;
    tournament_id: number | null;
    user_id: number;
    username: string;
    status: JoinRequestStatus;
    created_at: string;
    decided_at: string | null;
}

function toMember(row: MemberRow): TeamMember {
    return {
        userId: row.user_id,
        username: row.username,
        role: row.role_id === null ? null : { id: row.role_id, name: row.role_name! },
        isCaptain: row.is_captain === 1,
        joinedAt: row.joined_at,
    };
}

function toTeam(row: TeamRow, members: MemberRow[]): Team {
    return {
        id: row.id,
        tournamentId: row.tournament_id,
        game: { id: row.game_id, name: row.game_name },
        name: row.name,
        isEliminated: row.is_eliminated === 1,
        visibility: row.visibility,
        createdAt: row.created_at,
        members: members.filter((m) => m.team_id === row.id).map(toMember),
    };
}

function toJoinRequest(row: JoinRequestRow): JoinRequest {
    return {
        id: row.id,
        teamId: row.team_id,
        teamName: row.team_name,
        tournamentId: row.tournament_id,
        user: { id: row.user_id, username: row.username },
        status: row.status,
        createdAt: row.created_at,
        decidedAt: row.decided_at,
    };
}

// Pseudo et rôle des membres : jamais l'email
const SELECT_MEMBERS = `
    SELECT tm.team_id, tm.user_id, u.username, tm.role_id, r.name AS role_name, tm.is_captain, tm.joined_at
    FROM team_members tm
    JOIN users u ON u.id = tm.user_id
    LEFT JOIN game_roles r ON r.id = tm.role_id`;

const SELECT_TEAMS = 'SELECT t.*, g.name AS game_name FROM teams t JOIN games g ON g.id = t.game_id';

function nameTaken(err: unknown): never {
    if (isUniqueViolation(err)) throw new ConflictError('TEAM_NAME_TAKEN', 'Ce nom d\'équipe est déjà pris dans ce tournoi');
    throw err;
}

export class SqliteTeamRepository implements TeamRepository {
    private readonly db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    findById(id: number): Team | undefined {
        const row = this.db.prepare<[number], TeamRow>(`${SELECT_TEAMS} WHERE t.id = ?`).get(id);
        if (!row) return undefined;
        const members = this.db
            .prepare<[number], MemberRow>(`${SELECT_MEMBERS} WHERE tm.team_id = ? ORDER BY tm.joined_at, tm.user_id`)
            .all(id);
        return toTeam(row, members);
    }

    findByTournament(tournamentId: number, search?: string): Team[] {
        const rows = this.db
            .prepare<{ tournamentId: number; search: string | null }, TeamRow>(`
                ${SELECT_TEAMS}
                WHERE t.tournament_id = @tournamentId AND (@search IS NULL OR instr(lower(t.name), lower(@search)) > 0)
                ORDER BY t.created_at, t.id`)
            .all({ tournamentId, search: search ?? null });
        const members = this.db
            .prepare<[number], MemberRow>(`${SELECT_MEMBERS} WHERE tm.tournament_id = ? ORDER BY tm.joined_at, tm.user_id`)
            .all(tournamentId);
        return rows.map((row) => toTeam(row, members));
    }

    findByUser(userId: number, page: Page): Paginated<Team> {
        const rows = this.db
            .prepare<[number, number, number], TeamRow>(`
                ${SELECT_TEAMS}
                JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = ?
                ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`)
            .all(userId, page.limit, page.offset);
        const total = this.db
            .prepare<[number], { n: number }>('SELECT COUNT(*) AS n FROM team_members WHERE user_id = ?')
            .get(userId)!.n;
        const members = this.db
            .prepare<[number], MemberRow>(
                `${SELECT_MEMBERS} WHERE tm.team_id IN (SELECT team_id FROM team_members WHERE user_id = ?) ORDER BY tm.joined_at, tm.user_id`,
            )
            .all(userId);
        return { items: rows.map((row) => toTeam(row, members)), total };
    }

    search(filter: { free?: boolean; search?: string }, page: Page): Paginated<Team> {
        const params = { free: filter.free === undefined ? null : Number(filter.free), search: filter.search ?? null };
        const where = `WHERE (@free IS NULL OR (t.tournament_id IS NULL) = @free)
            AND (@search IS NULL OR instr(lower(t.name), lower(@search)) > 0)`;
        const rows = this.db
            .prepare<typeof params & Page, TeamRow>(`${SELECT_TEAMS} ${where} ORDER BY t.created_at DESC, t.id DESC LIMIT @limit OFFSET @offset`)
            .all({ ...params, ...page });
        const total = this.db.prepare<typeof params, { n: number }>(`SELECT COUNT(*) AS n FROM teams t ${where}`).get(params)!.n;
        const members = this.db
            .prepare<[string], MemberRow>(`${SELECT_MEMBERS} WHERE tm.team_id IN (SELECT value FROM json_each(?)) ORDER BY tm.joined_at, tm.user_id`)
            .all(JSON.stringify(rows.map((r) => r.id)));
        return { items: rows.map((row) => toTeam(row, members)), total };
    }

    countByTournament(tournamentId: number): number {
        return this.db.prepare<[number], { n: number }>('SELECT COUNT(*) AS n FROM teams WHERE tournament_id = ?').get(tournamentId)!.n;
    }

    findTeamIdOfUser(tournamentId: number, userId: number): number | undefined {
        return this.db
            .prepare<[number, number], { team_id: number }>('SELECT team_id FROM team_members WHERE tournament_id = ? AND user_id = ?')
            .get(tournamentId, userId)?.team_id;
    }

    create(tournamentId: number | null, gameId: number, name: string, captainId: number): Team {
        let id: number;
        try {
            id = this.db.transaction(() => {
                const team = this.db
                    .prepare<[number | null, number, string], { id: number }>('INSERT INTO teams (tournament_id, game_id, name) VALUES (?, ?, ?) RETURNING id')
                    .get(tournamentId, gameId, name)!;
                this.db
                    .prepare<[number, number, number | null]>('INSERT INTO team_members (team_id, user_id, tournament_id, is_captain) VALUES (?, ?, ?, 1)')
                    .run(team.id, captainId, tournamentId);
                return team.id;
            })();
        } catch (err) {
            nameTaken(err);
        }
        return this.findById(id)!;
    }

    // L'équipe d'abord : les membres la référencent par (id, tournament_id)
    register(id: number, tournamentId: number): void {
        this.db.transaction(() => {
            try {
                this.db.prepare<[number, number]>('UPDATE teams SET tournament_id = ? WHERE id = ?').run(tournamentId, id);
            } catch (err) {
                nameTaken(err);
            }
            this.db.prepare<[number, number]>('UPDATE team_members SET tournament_id = ? WHERE team_id = ?').run(tournamentId, id);
        })();
    }

    rename(id: number, name: string): void {
        try {
            this.db.prepare<[string, number]>('UPDATE teams SET name = ? WHERE id = ?').run(name, id);
        } catch (err) {
            nameTaken(err);
        }
    }

    setVisibility(id: number, visibility: TeamVisibility): void {
        this.db.prepare<[string, number]>('UPDATE teams SET visibility = ? WHERE id = ?').run(visibility, id);
    }

    // Membres d'abord : hors tournoi (tournament_id NULL), SQLite ignore leur clé étrangère composite, donc pas de cascade
    remove(id: number): void {
        this.db.transaction(() => {
            this.db.prepare<[number]>('DELETE FROM team_members WHERE team_id = ?').run(id);
            this.db.prepare<[number]>('DELETE FROM teams WHERE id = ?').run(id);
        })();
    }

    setEliminated(id: number): void {
        this.db.prepare<[number]>('UPDATE teams SET is_eliminated = 1 WHERE id = ?').run(id);
    }

    addMember(teamId: number, tournamentId: number | null, userId: number): void {
        this.db
            .prepare<[number, number, number | null]>('INSERT INTO team_members (team_id, user_id, tournament_id) VALUES (?, ?, ?)')
            .run(teamId, userId, tournamentId);
    }

    removeMember(teamId: number, userId: number): void {
        this.db.prepare<[number, number]>('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(teamId, userId);
    }

    setMemberRole(teamId: number, userId: number, roleId: number | null): void {
        this.db
            .prepare<[number | null, number, number]>('UPDATE team_members SET role_id = ? WHERE team_id = ? AND user_id = ?')
            .run(roleId, teamId, userId);
    }

    // Deux UPDATE dans cet ordre : l'index unique interdit deux capitaines en même temps
    setCaptain(teamId: number, userId: number): void {
        this.db.transaction(() => {
            this.db.prepare<[number]>('UPDATE team_members SET is_captain = 0 WHERE team_id = ?').run(teamId);
            this.db.prepare<[number, number]>('UPDATE team_members SET is_captain = 1 WHERE team_id = ? AND user_id = ?').run(teamId, userId);
        })();
    }
}

const SELECT_REQUESTS = `
    SELECT jr.*, u.username, t.name AS team_name, t.tournament_id
    FROM join_requests jr
    JOIN users u ON u.id = jr.user_id
    JOIN teams t ON t.id = jr.team_id`;

export class SqliteJoinRequestRepository implements JoinRequestRepository {
    private readonly db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    findById(id: number): JoinRequest | undefined {
        const row = this.db.prepare<[number], JoinRequestRow>(`${SELECT_REQUESTS} WHERE jr.id = ?`).get(id);
        return row && toJoinRequest(row);
    }

    findPendingByTeam(teamId: number, page: Page): Paginated<JoinRequest> {
        const rows = this.db
            .prepare<[number, number, number], JoinRequestRow>(
                `${SELECT_REQUESTS} WHERE jr.team_id = ? AND jr.status = 'pending' ORDER BY jr.created_at, jr.id LIMIT ? OFFSET ?`,
            )
            .all(teamId, page.limit, page.offset);
        const total = this.db
            .prepare<[number], { n: number }>("SELECT COUNT(*) AS n FROM join_requests WHERE team_id = ? AND status = 'pending'")
            .get(teamId)!.n;
        return { items: rows.map(toJoinRequest), total };
    }

    findByUser(userId: number, status: JoinRequestStatus | undefined, page: Page): Paginated<JoinRequest> {
        const params = { userId, status: status ?? null };
        const filter = 'WHERE jr.user_id = @userId AND (@status IS NULL OR jr.status = @status)';
        const rows = this.db
            .prepare<typeof params & Page, JoinRequestRow>(
                `${SELECT_REQUESTS} ${filter} ORDER BY jr.created_at DESC, jr.id DESC LIMIT @limit OFFSET @offset`,
            )
            .all({ ...params, ...page });
        const total = this.db.prepare<typeof params, { n: number }>(`SELECT COUNT(*) AS n FROM join_requests jr ${filter}`).get(params)!.n;
        return { items: rows.map(toJoinRequest), total };
    }

    create(teamId: number, userId: number): JoinRequest {
        try {
            const { id } = this.db
                .prepare<[number, number], { id: number }>('INSERT INTO join_requests (team_id, user_id) VALUES (?, ?) RETURNING id')
                .get(teamId, userId)!;
            return this.findById(id)!;
        } catch (err) {
            if (isUniqueViolation(err)) {
                throw new ConflictError('REQUEST_ALREADY_PENDING', 'Vous avez déjà une demande en attente pour cette équipe');
            }
            throw err;
        }
    }

    setStatus(id: number, status: Exclude<JoinRequestStatus, 'pending'>): void {
        this.db.prepare<[string, number]>(`UPDATE join_requests SET status = ?, decided_at = ${SQL_NOW} WHERE id = ?`).run(status, id);
    }

    cancelPendingOfUserInTournament(userId: number, tournamentId: number): JoinRequest[] {
        const ids = this.db
            .prepare<[number, number], { id: number }>(`
                UPDATE join_requests SET status = 'cancelled', decided_at = ${SQL_NOW}
                WHERE user_id = ? AND status = 'pending' AND team_id IN (SELECT id FROM teams WHERE tournament_id = ?)
                RETURNING id`)
            .all(userId, tournamentId);
        return ids.map(({ id }) => this.findById(id)!);
    }

    rejectPendingInTournament(tournamentId: number): JoinRequest[] {
        const ids = this.db
            .prepare<[number], { id: number }>(`
                UPDATE join_requests SET status = 'rejected', decided_at = ${SQL_NOW}
                WHERE status = 'pending' AND team_id IN (SELECT id FROM teams WHERE tournament_id = ?)
                RETURNING id`)
            .all(tournamentId);
        return ids.map(({ id }) => this.findById(id)!);
    }
}
