import { RuleViolationError } from '../../../shared/domain/errors.js';

export interface GameRole {
    id: number;
    name: string;
}

export interface Game {
    id: number;
    name: string;
    roles: GameRole[];
}

/** Deux rôles d'un même jeu ne peuvent pas porter le même nom, casse comprise. */
export function assertRolesUnique(roles: string[]): void {
    if (new Set(roles.map((r) => r.toLowerCase())).size !== roles.length) {
        throw new RuleViolationError('DUPLICATE_ROLES', 'Deux rôles portent le même nom');
    }
}
