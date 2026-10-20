import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import { AppError } from '../errors/AppError.js';
import * as refreshTokenRepository from '../repositories/refreshTokenRepository.js';
import * as userRepository from '../repositories/userRepository.js';
import { hashPassword, needsRehash, verifyPassword } from '../security/password.js';
import { securityLog } from '../security/securityLog.js';
import { assertLoginAllowed, recordLoginFailure, resetLoginFailures } from './loginThrottle.js';
import { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } from '../security/tokens.js';
import { roleOf, toPublicUser, type AuthUser, type PublicUser, type UserRow } from '../types/user.js';
import { newPassword, type LoginInput, type RegisterInput } from '../validators/authSchemas.js';

// Vérifié quand l'email est inconnu, pour que le temps de réponse ne révèle pas
// si un compte existe
const dummyHash = hashPassword('dummy-password-for-timing');

// Ce que reçoit le contrôleur : le refresh token part en cookie HttpOnly, jamais dans le corps
export interface Session {
    accessToken: string;
    expiresIn: number;
    refreshToken: string;
    user: PublicUser;
}

function isUniqueViolation(err: unknown): boolean {
    return err instanceof Error && 'code' in err && err.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

/** Émet un access token et un refresh token ; le jti du refresh est enregistré en base. */
function issueSession(row: UserRow, familyId: string = randomUUID(), jti: string = randomUUID()): Session {
    refreshTokenRepository.create({
        jti,
        userId: row.id,
        familyId,
        expiresAt: new Date(Date.now() + config.refreshTokenTtlSeconds * 1000),
    });
    const subject = { publicId: row.public_id, tokenVersion: row.token_version };
    return {
        accessToken: signAccessToken({ ...subject, role: roleOf(row) }),
        expiresIn: config.accessTokenTtlSeconds,
        refreshToken: signRefreshToken(subject, jti),
        user: toPublicUser(row),
    };
}

/**
 * Crée un compte. `isAdmin` n'est jamais exposé à la route register :
 * seul le script seed:admin le passe à true.
 */
export async function createUser(input: RegisterInput, isAdmin = false): Promise<PublicUser> {
    return toPublicUser(await createUserRow(input, isAdmin));
}

async function createUserRow(input: RegisterInput, isAdmin: boolean): Promise<UserRow> {
    const existing = userRepository.findByEmailOrUsername(input.email, input.username);
    if (existing.some((u) => u.email === input.email)) {
        throw new AppError(409, 'EMAIL_TAKEN', 'Cet email est déjà utilisé');
    }
    if (existing.length > 0) {
        throw new AppError(409, 'USERNAME_TAKEN', 'Ce nom d\'utilisateur est déjà utilisé');
    }

    const passwordHash = await hashPassword(input.password);

    try {
        return userRepository.create({
            username: input.username,
            email: input.email,
            passwordHash,
            isAdmin,
        });
    } catch (err) {
        // Deux inscriptions simultanées peuvent passer la vérification ci-dessus
        if (isUniqueViolation(err)) {
            throw new AppError(409, 'USER_ALREADY_EXISTS', 'Cet email ou ce nom d\'utilisateur est déjà utilisé');
        }
        throw err;
    }
}

export async function register(input: RegisterInput): Promise<Session> {
    return issueSession(await createUserRow(input, false));
}

export async function login(input: LoginInput, req?: Request): Promise<Session> {
    try {
        assertLoginAllowed(input.email);
    } catch (err) {
        securityLog('login_delayed', req);
        throw err;
    }

    const row = userRepository.findByEmail(input.email);
    const passwordOk = await verifyPassword(row?.password_hash ?? (await dummyHash), input.password);

    if (!row || !passwordOk) {
        recordLoginFailure(input.email);
        securityLog('login_failed', req);
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Identifiants invalides');
    }

    // Ancienne empreinte (bcrypt) : on profite du mot de passe en clair, vérifié, pour la remplacer
    if (needsRehash(row.password_hash)) {
        userRepository.updatePasswordHash(row.id, await hashPassword(input.password));
    }

    resetLoginFailures(input.email);
    refreshTokenRepository.deleteExpired();
    return issueSession(row);
}

/**
 * Rotation : le refresh présenté est révoqué et remplacé par un nouveau de la même famille.
 * Présenter un refresh déjà révoqué signale un vol : toutes les sessions de l'utilisateur
 * sont révoquées et ses access tokens invalidés (token_version).
 */
export function refresh(refreshToken: string | undefined, req?: Request): Session {
    if (!refreshToken) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentification requise');
    }

    let claims;
    try {
        // Refuse un access token : seul un jeton de type `refresh` est accepté
        claims = verifyRefreshToken(refreshToken);
    } catch (err) {
        securityLog('refresh_rejected', req, { reason: err instanceof AppError ? err.code : 'unknown' });
        throw err;
    }

    const stored = refreshTokenRepository.findByJti(claims.jti);
    const row = userRepository.findByPublicId(claims.sub);
    if (!stored || !row || stored.user_id !== row.id) {
        securityLog('refresh_rejected', req, { reason: 'unknown_jti' });
        throw new AppError(401, 'INVALID_TOKEN', 'Token invalide');
    }

    // Pas d'exception dans la transaction : elle annulerait la révocation des sessions
    const outcome = db.transaction((): 'reused' | 'stale' | Session => {
        const newJti = randomUUID();
        if (!refreshTokenRepository.revoke(stored.jti, newJti)) {
            refreshTokenRepository.revokeAllForUser(row.id);
            userRepository.incrementTokenVersion(row.id);
            return 'reused';
        }
        if (claims.ver !== row.token_version) return 'stale';
        return issueSession(row, stored.family_id, newJti);
    })();

    if (outcome === 'reused') {
        securityLog('refresh_reuse_detected', req, { userId: row.public_id, familyId: stored.family_id });
        throw new AppError(401, 'TOKEN_REVOKED', 'Session révoquée, veuillez vous reconnecter');
    }
    if (outcome === 'stale') {
        securityLog('refresh_rejected', req, { reason: 'token_version' });
        throw new AppError(401, 'TOKEN_REVOKED', 'Session révoquée, veuillez vous reconnecter');
    }
    return outcome;
}

/** Révoque le refresh token présenté. Toujours silencieux : un jeton invalide n'a rien à révoquer. */
export function logout(refreshToken: string | undefined): void {
    if (!refreshToken) return;
    try {
        refreshTokenRepository.revoke(verifyRefreshToken(refreshToken).jti);
    } catch {
        // jeton expiré ou falsifié : rien à révoquer, le cookie est supprimé quand même
    }
}

/**
 * Vérifie l'access token puis compare son `ver` à token_version (la ligne est chargée de
 * toute façon) : un compte supprimé, un mot de passe ou un rôle changé coupent les jetons émis.
 */
export function authenticateAccessToken(token: string): AuthUser {
    const claims = verifyAccessToken(token);
    const row = userRepository.findByPublicId(claims.sub);
    if (!row) {
        throw new AppError(401, 'INVALID_TOKEN', 'Token invalide');
    }
    if (row.token_version !== claims.ver) {
        throw new AppError(401, 'TOKEN_REVOKED', 'Session révoquée, veuillez vous reconnecter');
    }
    return { id: row.id, publicId: row.public_id, role: claims.role };
}

export function getProfile(userId: number): PublicUser {
    const row = userRepository.findById(userId);
    if (!row) throw new AppError(401, 'INVALID_TOKEN', 'Token invalide');
    return toPublicUser(row);
}

/** Changement de rôle : invalide tous les jetons et toutes les sessions de l'utilisateur. */
export function setAdmin(userId: number, isAdmin: boolean): void {
    db.transaction(() => {
        userRepository.setAdmin(userId, isAdmin);
        refreshTokenRepository.revokeAllForUser(userId);
    })();
}

/** Changement de mot de passe : même politique qu'à l'inscription, puis invalidation de tous les jetons. */
export async function changePassword(userId: number, password: string): Promise<void> {
    const passwordHash = await hashPassword(newPassword.parse(password));
    db.transaction(() => {
        userRepository.changePasswordHash(userId, passwordHash);
        refreshTokenRepository.revokeAllForUser(userId);
    })();
}
