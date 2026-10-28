import type { Page, Paginated } from '../../../shared/application/ports.js';
import type { Message } from '../domain/message.js';

export interface MessageRepository {
    /** Les plus récents d'abord. */
    findByTeam(teamId: number, page: Page): Paginated<Message>;
    create(teamId: number, authorId: number, content: string): Message;
}
