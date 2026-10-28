import type { Page, Paginated } from '../../../shared/application/ports.js';
import type { RealtimeNotifier } from '../../../shared/application/realtimeNotifier.js';
import type { TournamentReader } from '../../tournaments/application/tournamentReader.js';
import { assertCanPost, assertCanReadChat, type Message } from '../domain/message.js';
import type { MessageRepository } from './ports.js';

export class ChatService {
    private readonly messages: MessageRepository;
    private readonly reader: TournamentReader;
    private readonly notifier: RealtimeNotifier;

    constructor(deps: { messages: MessageRepository; reader: TournamentReader; notifier: RealtimeNotifier }) {
        this.messages = deps.messages;
        this.reader = deps.reader;
        this.notifier = deps.notifier;
    }

    /** Même règle pour l'historique HTTP et pour l'entrée dans le salon temps réel. */
    assertCanRead(teamId: number, reader: { id: number; isAdmin: boolean }): void {
        assertCanReadChat(this.reader.requireTeam(teamId).team, reader);
    }

    list(teamId: number, reader: { id: number; isAdmin: boolean }, page: Page): Paginated<Message> {
        this.assertCanRead(teamId, reader);
        return this.messages.findByTeam(teamId, page);
    }

    /** B-16 : le message est enregistré puis poussé aux membres connectés. */
    post(teamId: number, authorId: number, content: string): Message {
        assertCanPost(this.reader.requireTeam(teamId).team, authorId);
        const message = this.messages.create(teamId, authorId, content);
        this.notifier.messagePosted(message);
        return message;
    }
}
