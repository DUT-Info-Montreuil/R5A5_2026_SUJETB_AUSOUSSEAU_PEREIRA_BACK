// Un use case testé avec de faux repositories : l'inversion de dépendance rend la base inutile
import { describe, expect, it } from 'vitest';
import { ChatService } from '../../src/features/chat/application/chatService.js';
import type { MessageRepository } from '../../src/features/chat/application/ports.js';
import type { Message } from '../../src/features/chat/domain/message.js';
import type { Team } from '../../src/features/teams/domain/team.js';
import type { TournamentReader } from '../../src/features/tournaments/application/tournamentReader.js';
import type { RealtimeNotifier } from '../../src/shared/application/realtimeNotifier.js';
import { AccessDeniedError, ConflictError } from '../../src/shared/domain/errors.js';

const team: Team = {
    id: 1,
    tournamentId: 1,
    name: 'Les Bleus',
    isEliminated: false,
    createdAt: '',
    members: [{ userId: 7, username: 'alice', role: null, isCaptain: true, joinedAt: '' }],
};

function setup(current: Team) {
    const stored: Message[] = [];
    const pushed: Message[] = [];
    const messages: MessageRepository = {
        findByTeam: () => ({ items: stored, total: stored.length }),
        create: (teamId, authorId, content) => {
            const message = { id: stored.length + 1, teamId, author: { id: authorId, username: 'alice' }, content, createdAt: '' };
            stored.push(message);
            return message;
        },
    };
    const reader = { requireTeam: () => ({ team: current }) } as unknown as TournamentReader;
    const notifier = { messagePosted: (m: Message) => pushed.push(m) } as unknown as RealtimeNotifier;
    return { chat: new ChatService({ messages, reader, notifier }), stored, pushed };
}

describe('ChatService', () => {
    it('enregistre le message d\'un membre puis le pousse en temps réel', () => {
        const { chat, stored, pushed } = setup(team);
        chat.post(1, 7, 'salut');
        expect(stored).toHaveLength(1);
        expect(pushed).toEqual(stored);
    });

    it('refuse un non-membre, et n\'enregistre ni ne pousse rien', () => {
        const { chat, stored, pushed } = setup(team);
        expect(() => chat.post(1, 99, 'intrus')).toThrow(AccessDeniedError);
        expect(stored).toEqual([]);
        expect(pushed).toEqual([]);
    });

    it('ferme l\'espace d\'une équipe éliminée aux membres, pas à l\'admin', () => {
        const { chat } = setup({ ...team, isEliminated: true });
        expect(() => chat.list(1, { id: 7, isAdmin: false }, { limit: 20, offset: 0 })).toThrow(ConflictError);
        expect(() => chat.list(1, { id: 99, isAdmin: true }, { limit: 20, offset: 0 })).not.toThrow();
    });
});
