import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError } from '../errors/AppError.js';
import * as userRepository from '../repositories/userRepository.js';
import { toPublicUser, type PublicUser } from '../types/user.js';
import type { LoginInput, RegisterInput } from '../validators/authSchemas.js';

const BCRYPT_COST = 12;

// Comparé quand l'email est inconnu, pour que le temps de réponse ne révèle pas
// si un compte existe
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);

export interface AuthResult {
    token: string;
    user: PublicUser;
}

export function signToken(userId: number): string {
    return jwt.sign({ sub: String(userId) }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

function isUniqueViolation(err: unknown): boolean {
    return err instanceof Error && 'code' in err && err.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

/**
 * Crée un compte. `isAdmin` n'est jamais exposé à la route register :
 * seul le script seed:admin le passe à true.
 */
export async function createUser(input: RegisterInput, isAdmin = false): Promise<PublicUser> {
    const existing = userRepository.findByEmailOrUsername(input.email, input.username);
    if (existing.some((u) => u.email === input.email)) {
        throw new AppError(409, 'EMAIL_TAKEN', 'Cet email est déjà utilisé');
    }
    if (existing.length > 0) {
        throw new AppError(409, 'USERNAME_TAKEN', 'Ce nom d\'utilisateur est déjà utilisé');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

    try {
        const row = userRepository.create({
            username: input.username,
            email: input.email,
            passwordHash,
            isAdmin,
        });
        return toPublicUser(row);
    } catch (err) {
        // Deux inscriptions simultanées peuvent passer la vérification ci-dessus
        if (isUniqueViolation(err)) {
            throw new AppError(409, 'USER_ALREADY_EXISTS', 'Cet email ou ce nom d\'utilisateur est déjà utilisé');
        }
        throw err;
    }
}

export async function register(input: RegisterInput): Promise<AuthResult> {
    const user = await createUser(input);
    return { token: signToken(user.id), user };
}

export async function login(input: LoginInput): Promise<AuthResult> {
    const row = userRepository.findByEmail(input.email);
    const passwordOk = await bcrypt.compare(input.password, row?.password_hash ?? DUMMY_HASH);

    if (!row || !passwordOk) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Email ou mot de passe incorrect');
    }

    return { token: signToken(row.id), user: toPublicUser(row) };
}

/**
 * Vérifie le token puis recharge l'utilisateur depuis la base : un compte supprimé
 * ou un admin rétrogradé est pris en compte immédiatement.
 */
export function getUserFromToken(token: string): PublicUser {
    let payload: string | jwt.JwtPayload;
    try {
        payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    } catch (err) {
        if (err instanceof jwt.TokenExpiredError) {
            throw new AppError(401, 'TOKEN_EXPIRED', 'Session expirée, veuillez vous reconnecter');
        }
        throw new AppError(401, 'INVALID_TOKEN', 'Token invalide');
    }

    const userId = typeof payload === 'object' ? Number(payload.sub) : NaN;
    if (!Number.isInteger(userId)) {
        throw new AppError(401, 'INVALID_TOKEN', 'Token invalide');
    }

    const row = userRepository.findById(userId);
    if (!row) {
        throw new AppError(401, 'INVALID_TOKEN', 'Token invalide');
    }
    return toPublicUser(row);
}
