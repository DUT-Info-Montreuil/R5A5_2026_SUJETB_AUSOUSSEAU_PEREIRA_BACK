import { assertChatOpen, assertMember, type Team } from '../../teams/domain/team.js';

export interface Message {
    id: number;
    teamId: number;
    author: { id: number; username: string } | null;
    content: string;
    createdAt: string;
}

/**
 * B-16 / B-17 / B-18 : lecture réservée aux membres actuels d'une équipe encore en lice.
 * L'administrateur garde la lecture, même après élimination.
 */
export function assertCanReadChat(team: Team, reader: { id: number; isAdmin: boolean }): void {
    if (reader.isAdmin) return;
    assertMember(team, reader.id);
    assertChatOpen(team);
}

/** Écriture : membres uniquement (l'admin seulement s'il est membre), équipe non éliminée. */
export function assertCanPost(team: Team, authorId: number): void {
    assertMember(team, authorId);
    assertChatOpen(team);
}
