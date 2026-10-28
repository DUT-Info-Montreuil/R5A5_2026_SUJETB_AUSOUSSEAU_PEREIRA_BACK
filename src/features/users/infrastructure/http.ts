import { z } from 'zod';
import { route, type AnyRoute } from '../../../shared/infrastructure/http/routing.js';
import type { AuthService } from '../application/authService.js';
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, type User } from '../domain/user.js';

// --- DTO d'entrée : les champs inconnus (is_admin, role...) sont refusés ---

const email = z.string().trim().toLowerCase().pipe(z.email('Email invalide'));

export const registerBody = z.strictObject({
    username: z
        .string()
        .trim()
        .min(3, 'Le nom d\'utilisateur doit faire au moins 3 caractères')
        .max(32, 'Le nom d\'utilisateur doit faire au plus 32 caractères'),
    email,
    password: z
        .string()
        .min(PASSWORD_MIN_LENGTH, `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères`)
        .refine((p) => Buffer.byteLength(p, 'utf8') <= PASSWORD_MAX_BYTES, `Le mot de passe est trop long (${PASSWORD_MAX_BYTES} octets maximum)`),
});

export const loginBody = z.strictObject({
    email,
    password: z.string().min(1, 'Mot de passe requis'),
});

// --- DTO de sortie et mapper : jamais l'empreinte du mot de passe ---

export const userResponse = z.object({
    id: z.number().int(),
    username: z.string(),
    email: z.string(),
    isAdmin: z.boolean(),
    createdAt: z.string(),
});

export function toUserResponse(user: User): z.infer<typeof userResponse> {
    return { id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin, createdAt: user.createdAt };
}

const sessionResponse = z.object({ token: z.string(), user: userResponse });

export function userRoutes(auth: AuthService): AnyRoute[] {
    return [
        route({
            method: 'post',
            path: '/api/auth/register',
            tag: 'Authentification',
            summary: 'Créer un compte joueur et recevoir un jeton',
            access: 'public',
            strictRateLimit: true,
            body: registerBody,
            status: 201,
            response: sessionResponse,
            errors: {
                409: 'Email ou pseudo déjà pris (EMAIL_TAKEN, USERNAME_TAKEN)',
                422: 'Mot de passe présent dans les fuites connues (PASSWORD_TOO_COMMON)',
            },
            handle: async ({ body }) => {
                const session = await auth.register(body);
                return { token: session.token, user: toUserResponse(session.user) };
            },
        }),
        route({
            method: 'post',
            path: '/api/auth/login',
            tag: 'Authentification',
            summary: 'Se connecter, renvoie un jeton',
            access: 'public',
            strictRateLimit: true,
            body: loginBody,
            response: sessionResponse,
            errors: {
                401: 'Email ou mot de passe incorrect (INVALID_CREDENTIALS)',
                429: 'Trop d\'échecs sur ce compte, délai qui double à chaque échec (TOO_MANY_ATTEMPTS, header Retry-After)',
            },
            handle: async ({ body }) => {
                const session = await auth.login(body);
                return { token: session.token, user: toUserResponse(session.user) };
            },
        }),
        route({
            method: 'get',
            path: '/api/auth/me',
            tag: 'Authentification',
            summary: 'Utilisateur connecté',
            access: 'authenticated',
            response: z.object({ user: userResponse }),
            handle: ({ user }) => ({ user: toUserResponse(user) }),
        }),
    ];
}
