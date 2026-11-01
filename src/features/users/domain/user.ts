import { RuleViolationError } from '../../../shared/domain/errors.js';

export interface User {
    id: number;
    username: string;
    email: string;
    passwordHash: string;
    isAdmin: boolean;
    createdAt: string;
}

export type NewUser = Omit<User, 'id' | 'createdAt'>;

export const PASSWORD_MIN_LENGTH = 8;

// bcrypt ignore tout ce qui dépasse 72 octets : limite de l'algorithme, pas du stockage
export const PASSWORD_MAX_BYTES = 72;

/** Politique du cours : la longueur prime, et les mots de passe connus (en minuscules) sont refusés. */
export function assertAcceptablePassword(password: string, knownPasswords: ReadonlySet<string>): void {
    if (knownPasswords.has(password.toLowerCase())) {
        throw new RuleViolationError('PASSWORD_TOO_COMMON', 'Ce mot de passe apparaît dans les fuites connues, choisissez-en un autre');
    }
}
