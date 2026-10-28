import { z } from 'zod';
import { route, type AnyRoute } from '../../../shared/infrastructure/http/routing.js';
import { idParams, idSchema, paginationQuery, paginationSchema, toPagination } from '../../../shared/infrastructure/http/schemas.js';
import type { ChatService } from '../application/chatService.js';
import type { Message } from '../domain/message.js';

const messageBody = z.strictObject({
    content: z.string().trim().min(1, 'Message vide').max(2000),
});

const markReadBody = z.strictObject({ messageId: idSchema });

export const messageResponse = z.object({
    id: z.number().int(),
    teamId: z.number().int(),
    author: z.object({ id: z.number().int(), username: z.string() }).nullable(),
    content: z.string(),
    createdAt: z.string(),
});

export function toMessageResponse(message: Message): z.infer<typeof messageResponse> {
    return {
        id: message.id,
        teamId: message.teamId,
        author: message.author && { id: message.author.id, username: message.author.username },
        content: message.content,
        createdAt: message.createdAt,
    };
}

export function chatRoutes(chat: ChatService): AnyRoute[] {
    return [
        route({
            method: 'get',
            path: '/api/teams/:id/messages',
            tag: 'Chat d\'équipe',
            summary: 'Historique, du plus récent au plus ancien : membres d\'une équipe en lice, ou admin (B-16, B-18)',
            access: 'authenticated',
            params: idParams,
            query: paginationQuery,
            response: z.object({ messages: z.array(messageResponse), pagination: paginationSchema }),
            errors: {
                403: 'Pas membre de l\'équipe (NOT_TEAM_MEMBER)',
                404: 'Équipe introuvable (TEAM_NOT_FOUND)',
                409: 'Équipe éliminée : espace fermé (TEAM_CHAT_CLOSED)',
            },
            handle: ({ params, query, user }) => {
                const page = chat.list(params.id, user, query);
                return { messages: page.items.map(toMessageResponse), pagination: toPagination(query, page.total) };
            },
        }),
        route({
            method: 'post',
            path: '/api/teams/:id/messages',
            tag: 'Chat d\'équipe',
            summary: 'Envoyer un message, poussé en temps réel aux membres (B-16)',
            access: 'authenticated',
            params: idParams,
            body: messageBody,
            status: 201,
            response: z.object({ message: messageResponse }),
            errors: {
                403: 'Pas membre de l\'équipe (NOT_TEAM_MEMBER)',
                404: 'Équipe introuvable (TEAM_NOT_FOUND)',
                409: 'Équipe éliminée : espace fermé (TEAM_CHAT_CLOSED)',
            },
            handle: ({ params, body, user }) => ({ message: toMessageResponse(chat.post(params.id, user.id, body.content)) }),
        }),
        route({
            method: 'post',
            path: '/api/teams/:id/messages/read',
            tag: 'Chat d\'équipe',
            summary: 'Marquer les messages lus jusqu\'à messageId inclus (le repère ne recule jamais)',
            access: 'authenticated',
            params: idParams,
            body: markReadBody,
            status: 204,
            errors: {
                403: 'Pas membre de l\'équipe (NOT_TEAM_MEMBER)',
                404: 'Équipe introuvable, ou message absent de cette équipe (TEAM_NOT_FOUND, MESSAGE_NOT_FOUND)',
            },
            handle: ({ params, body, user }) => chat.markRead(params.id, user.id, body.messageId),
        }),
        route({
            method: 'get',
            path: '/api/me/unread',
            tag: 'Chat d\'équipe',
            summary: 'Messages non lus par équipe, pour les équipes encore en lice (non éliminées, tournoi pas terminé)',
            access: 'authenticated',
            response: z.object({
                teams: z.array(z.object({ teamId: z.number().int(), unread: z.number().int(), lastReadMessageId: z.number().int().nullable() })),
            }),
            handle: ({ user }) => ({ teams: chat.unread(user.id) }),
        }),
    ];
}
