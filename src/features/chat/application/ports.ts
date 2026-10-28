import type { Page, Paginated } from '../../../shared/application/ports.js';
import type { Message } from '../domain/message.js';

export interface MessageRepository {
    /** Les plus récents d'abord. */
    findByTeam(teamId: number, page: Page): Paginated<Message>;
    create(teamId: number, authorId: number, content: string): Message;
    findById(id: number): Message | undefined;
    /** Le repère ne recule jamais : relire un ancien message ne rend pas les suivants non lus. */
    markRead(teamId: number, userId: number, messageId: number): void;
    /**
     * Pour chaque équipe du joueur encore en lice (non éliminée, tournoi pas terminé) : les messages
     * des autres plus récents que son repère de lecture.
     */
    unreadOf(userId: number): UnreadCount[];
}

export interface UnreadCount {
    teamId: number;
    unread: number;
    lastReadMessageId: number | null;
}
