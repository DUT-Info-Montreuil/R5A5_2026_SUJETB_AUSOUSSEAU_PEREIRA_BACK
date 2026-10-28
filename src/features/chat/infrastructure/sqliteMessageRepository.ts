import type { Page, Paginated } from '../../../shared/application/ports.js';
import type { Database } from '../../../shared/infrastructure/database.js';
import type { MessageRepository } from '../application/ports.js';
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
}
