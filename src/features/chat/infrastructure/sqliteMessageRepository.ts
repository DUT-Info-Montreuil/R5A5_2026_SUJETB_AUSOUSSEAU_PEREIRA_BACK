import type { Page, Paginated } from '../../../shared/application/ports.js';
import type { Database } from '../../../shared/infrastructure/database.js';
import type { MessageRepository, UnreadCount } from '../application/ports.js';
import type { Message } from '../domain/message.js';

interface MessageRow {
    id: number;
    team_id: number;
    author_id: number | null;
    author_username: string | null;
    content: string;
    created_at: string;
}

function toMessage(row: MessageRow): Message {
    return {
        id: row.id,
        teamId: row.team_id,
        // Auteur supprimé : le message reste, sans auteur (ON DELETE SET NULL)
        author: row.author_id === null ? null : { id: row.author_id, username: row.author_username! },
        content: row.content,
        createdAt: row.created_at,
    };
}

const SELECT_MESSAGES = `
    SELECT m.id, m.team_id, m.author_id, u.username AS author_username, m.content, m.created_at
    FROM messages m
    LEFT JOIN users u ON u.id = m.author_id`;

export class SqliteMessageRepository implements MessageRepository {
    private readonly db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    findByTeam(teamId: number, page: Page): Paginated<Message> {
        const rows = this.db
            .prepare<[number, number, number], MessageRow>(
                `${SELECT_MESSAGES} WHERE m.team_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`,
            )
            .all(teamId, page.limit, page.offset);
        const total = this.db.prepare<[number], { n: number }>('SELECT COUNT(*) AS n FROM messages WHERE team_id = ?').get(teamId)!.n;
        return { items: rows.map(toMessage), total };
    }

    create(teamId: number, authorId: number, content: string): Message {
        const { id } = this.db
            .prepare<[number, number, string], { id: number }>('INSERT INTO messages (team_id, author_id, content) VALUES (?, ?, ?) RETURNING id')
            .get(teamId, authorId, content)!;
        return toMessage(this.db.prepare<[number], MessageRow>(`${SELECT_MESSAGES} WHERE m.id = ?`).get(id)!);
    }

    findById(id: number): Message | undefined {
        const row = this.db.prepare<[number], MessageRow>(`${SELECT_MESSAGES} WHERE m.id = ?`).get(id);
        return row && toMessage(row);
    }

    markRead(teamId: number, userId: number, messageId: number): void {
        this.db
            .prepare<[number, number, number]>(`
                INSERT INTO message_reads (team_id, user_id, last_read_message_id) VALUES (?, ?, ?)
                ON CONFLICT (team_id, user_id) DO UPDATE
                SET last_read_message_id = max(last_read_message_id, excluded.last_read_message_id)`)
            .run(teamId, userId, messageId);
    }

    unreadOf(userId: number): UnreadCount[] {
        return this.db
            .prepare<{ userId: number }, { team_id: number; unread: number; last_read_message_id: number | null }>(`
                SELECT tm.team_id, mr.last_read_message_id,
                       (SELECT COUNT(*) FROM messages m
                        WHERE m.team_id = tm.team_id
                          AND m.id > coalesce(mr.last_read_message_id, 0)
                          AND m.author_id IS NOT @userId) AS unread
                FROM team_members tm
                JOIN teams t ON t.id = tm.team_id AND t.is_eliminated = 0
                JOIN tournaments tr ON tr.id = t.tournament_id AND tr.status <> 'finished'
                LEFT JOIN message_reads mr ON mr.team_id = tm.team_id AND mr.user_id = tm.user_id
                WHERE tm.user_id = @userId
                ORDER BY tm.team_id`)
            .all({ userId })
            .map((row) => ({ teamId: row.team_id, unread: row.unread, lastReadMessageId: row.last_read_message_id }));
    }
}
