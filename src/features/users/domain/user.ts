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

// shortcut: courte liste des mots de passe les plus fréquents dans les fuites,
// à remplacer par une liste publique complète (ou l'API Pwned Passwords) en production
const COMMON_PASSWORDS = new Set([
    '12345678', '123456789', '1234567890', 'password', 'password1', 'password123', 'motdepasse',
    'azertyuiop', 'qwertyuiop', 'azerty123', 'qwerty123', '11111111', '00000000', 'iloveyou',
    'sunshine', 'princess', 'football', 'baseball', 'welcome1', 'abcd1234', 'letmein1',
    'admin123', 'administrateur', 'soleil123', 'bonjour1', 'doudou123', 'chouchou',
]);

/** Politique du cours : la longueur prime, et les mots de passe connus sont refusés. */
export function assertAcceptablePassword(password: string): void {
    if (COMMON_PASSWORDS.has(password.toLowerCase())) {
        throw new RuleViolationError('PASSWORD_TOO_COMMON', 'Ce mot de passe apparaît dans les fuites connues, choisissez-en un autre');
    }
}
