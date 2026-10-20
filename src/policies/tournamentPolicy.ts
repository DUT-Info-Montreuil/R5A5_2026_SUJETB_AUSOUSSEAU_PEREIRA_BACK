import { AccessDenied } from '../errors/AccessDenied.js';
import type { AuthUser } from '../types/user.js';

/**
 * Deuxième vérification, dans le use case : il a la ressource ET le demandeur.
 * Un tournoi ne se modifie ou ne se supprime que par son organisateur (created_by)
 * ou par un admin. Pour l'instant seuls les admins créent des tournois.
 */
export function assertCanManageTournament(actor: AuthUser, tournament: { created_by: number }): void {
    if (actor.role === 'admin' || tournament.created_by === actor.id) return;
    throw new AccessDenied('Seul l\'organisateur du tournoi peut le modifier');
}
