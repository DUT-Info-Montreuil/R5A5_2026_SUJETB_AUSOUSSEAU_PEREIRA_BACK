import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { AppError } from '../errors/AppError.js';
import type { Role } from '../types/user.js';

// Une seule application émet et vérifie ses jetons : HS256, fixé ici et jamais lu dans le
// header du jeton. jsonwebtoken refuse alors `none` et tout autre algorithme annoncé
const ALGORITHM = 'HS256';

export type TokenType = 'access' | 'refresh';

// Payload court et lisible par tous (JWT signé, pas chiffré) : aucune donnée personnelle.
// `ver` recopie users.token_version au moment de l'émission
const baseClaims = {
    sub: z.uuid(),
    jti: z.uuid(),
    iat: z.number().int(),
    nbf: z.number().int(),
    exp: z.number().int(),
    ver: z.number().int().nonnegative(),
};

const accessClaimsSchema = z.strictObject({
    ...baseClaims,
    type: z.literal('access'),
    role: z.enum(['user', 'admin']),
});

const refreshClaimsSchema = z.strictObject({
    ...baseClaims,
    type: z.literal('refresh'),
});

export type AccessClaims = z.infer<typeof accessClaimsSchema>;
export type RefreshClaims = z.infer<typeof refreshClaimsSchema>;

export interface TokenSubject {
    publicId: string;
    tokenVersion: number;
}

function sign(type: TokenType, subject: TokenSubject, extra: Record<string, unknown>, ttlSeconds: number, jti: string): string {
    return jwt.sign({ type, ver: subject.tokenVersion, ...extra }, config.jwtSecret, {
        algorithm: ALGORITHM,
        expiresIn: ttlSeconds,
        notBefore: 0,
        subject: subject.publicId,
        jwtid: jti,
    });
}

export function signAccessToken(subject: TokenSubject & { role: Role }): string {
    return sign('access', subject, { role: subject.role }, config.accessTokenTtlSeconds, randomUUID());
}

export function signRefreshToken(subject: TokenSubject, jti: string): string {
    return sign('refresh', subject, {}, config.refreshTokenTtlSeconds, jti);
}

/** Vérifie signature, algorithme, exp et nbf, puis la forme exacte du payload. Lève une 401. */
function verify(token: string): unknown {
    try {
        return jwt.verify(token, config.jwtSecret, {
            algorithms: [ALGORITHM],
            ignoreExpiration: false,
            ignoreNotBefore: false,
        });
    } catch (err) {
        if (err instanceof jwt.TokenExpiredError) {
            throw new AppError(401, 'TOKEN_EXPIRED', 'Session expirée, veuillez vous reconnecter');
        }
        throw new AppError(401, 'INVALID_TOKEN', 'Token invalide');
    }
}

export function verifyAccessToken(token: string): AccessClaims {
    const parsed = accessClaimsSchema.safeParse(verify(token));
    // Un refresh token présenté comme access token (ou l'inverse) est refusé ici
    if (!parsed.success) throw new AppError(401, 'INVALID_TOKEN', 'Token invalide');
    return parsed.data;
}

export function verifyRefreshToken(token: string): RefreshClaims {
    const parsed = refreshClaimsSchema.safeParse(verify(token));
    if (!parsed.success) throw new AppError(401, 'INVALID_TOKEN', 'Token invalide');
    return parsed.data;
}
