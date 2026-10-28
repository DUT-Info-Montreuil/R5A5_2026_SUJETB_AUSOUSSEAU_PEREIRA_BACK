import type { NewUser, User } from '../domain/user.js';

export interface UserRepository {
    findById(id: number): User | undefined;
    findByEmail(email: string): User | undefined;
    findByEmailOrUsername(email: string, username: string): User[];
    /** Lève ConflictError si l'email ou le pseudo est pris entre-temps. */
    create(user: NewUser): User;
}

export interface PasswordHasher {
    hash(password: string): Promise<string>;
    verify(password: string, hash: string): Promise<boolean>;
}

export interface TokenService {
    sign(userId: number): string;
    /** Lève UnauthenticatedError (INVALID_TOKEN, TOKEN_EXPIRED). */
    verify(token: string): { userId: number; expiresAt: Date };
}

/** Freine la force brute sur un compte : délai qui double après chaque échec. */
export interface LoginThrottle {
    /** Lève TooManyAttemptsError si le compte doit encore attendre. */
    assertAllowed(accountKey: string): void;
    recordFailure(accountKey: string): void;
    reset(accountKey: string): void;
}
